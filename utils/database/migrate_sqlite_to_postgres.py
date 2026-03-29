#!/usr/bin/env python3
"""
One-time data migration: SQLite → PostgreSQL.

Reads all data from stemtubes.db, converts JSON TEXT → Python dicts
for JSONB columns, and inserts into PostgreSQL via SQLAlchemy.

Run from project root with env loaded:
    source .env
    source venv/bin/activate
    python utils/database/migrate_sqlite_to_postgres.py
"""
import json
import os
import sys
import sqlite3

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from flask import Flask
from core.models import db, User, GlobalDownload, UserDownload, Album, Playlist, Recording


SQLITE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'stemtubes.db')

# JSON columns that need TEXT→dict conversion
JSONB_COLUMNS = {
    'global_downloads': ['stems_paths', 'chords_data', 'structure_data', 'lyrics_data', 'beat_times', 'beat_positions'],
    'user_downloads': ['stems_paths', 'chords_data', 'structure_data', 'lyrics_data', 'beat_times', 'beat_positions'],
    'playlists': ['tracks_json'],
}


def parse_json_field(value):
    """Convert JSON TEXT to Python dict/list. Returns None for invalid/empty."""
    if value is None or value == '' or value == 'null':
        return None
    if isinstance(value, (dict, list)):
        return value  # Already parsed
    try:
        parsed = json.loads(value)
        return parsed if parsed is not None else None
    except (json.JSONDecodeError, TypeError):
        return None


def read_sqlite_table(conn, table_name):
    """Read all rows from a SQLite table as list of dicts."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table_name}")
    columns = [desc[0] for desc in cursor.description]
    rows = []
    for row in cursor.fetchall():
        d = dict(zip(columns, row))
        # Convert JSON TEXT columns to Python objects
        if table_name in JSONB_COLUMNS:
            for col in JSONB_COLUMNS[table_name]:
                if col in d:
                    d[col] = parse_json_field(d[col])
        rows.append(d)
    return rows, columns


def migrate_table(pg_session, model_class, rows, table_name):
    """Insert rows into PostgreSQL using SQLAlchemy."""
    if not rows:
        print(f"  {table_name}: 0 rows (skipped)")
        return 0

    # Get valid column names for this model
    valid_cols = {c.name for c in model_class.__table__.columns}

    inserted = 0
    for row in rows:
        # Filter to valid columns only
        filtered = {k: v for k, v in row.items() if k in valid_cols}
        try:
            obj = model_class(**filtered)
            pg_session.merge(obj)  # merge preserves existing IDs
            inserted += 1
        except Exception as e:
            print(f"  WARNING: Failed to insert {table_name} row id={row.get('id')}: {e}")

    pg_session.flush()
    print(f"  {table_name}: {inserted}/{len(rows)} rows inserted")
    return inserted


def reset_sequences(pg_session):
    """Reset PostgreSQL auto-increment sequences to max(id) + 1."""
    tables = [
        ('users', 'users_id_seq'),
        ('global_downloads', 'global_downloads_id_seq'),
        ('user_downloads', 'user_downloads_id_seq'),
        ('albums', 'albums_id_seq'),
        ('playlists', 'playlists_id_seq'),
    ]
    for table, seq in tables:
        try:
            result = pg_session.execute(db.text(f"SELECT MAX(id) FROM {table}")).scalar()
            if result:
                pg_session.execute(db.text(f"SELECT setval('{seq}', {result})"))
                print(f"  Sequence {seq} → {result}")
        except Exception as e:
            print(f"  WARNING: Could not reset sequence {seq}: {e}")


def main():
    if not os.path.exists(SQLITE_PATH):
        print(f"ERROR: SQLite database not found: {SQLITE_PATH}")
        sys.exit(1)

    # Create minimal Flask app for SQLAlchemy context
    app = Flask(__name__)
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'migration')

    if not app.config['SQLALCHEMY_DATABASE_URI']:
        print("ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)

    db.init_app(app)

    # Open SQLite
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row

    print(f"=== SQLite → PostgreSQL Migration ===")
    print(f"Source: {SQLITE_PATH}")
    print(f"Target: {app.config['SQLALCHEMY_DATABASE_URI'][:50]}...")
    print()

    # Read SQLite counts
    sqlite_counts = {}
    for table in ['users', 'albums', 'global_downloads', 'user_downloads', 'playlists', 'recordings']:
        try:
            count = sqlite_conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            sqlite_counts[table] = count
            print(f"  SQLite {table}: {count} rows")
        except Exception:
            sqlite_counts[table] = 0
            print(f"  SQLite {table}: table not found (0 rows)")

    print()

    with app.app_context():
        # Ensure tables exist
        db.create_all()

        # Migration order (respects foreign keys)
        migration_order = [
            ('users', User),
            ('albums', Album),
            ('global_downloads', GlobalDownload),
            ('user_downloads', UserDownload),
            ('playlists', Playlist),
            ('recordings', Recording),
        ]

        print("Migrating data...")
        for table_name, model_class in migration_order:
            rows, _ = read_sqlite_table(sqlite_conn, table_name)
            migrate_table(db.session, model_class, rows, table_name)

        # Reset sequences
        print("\nResetting sequences...")
        reset_sequences(db.session)

        # Commit all
        db.session.commit()
        print("\nCommitted to PostgreSQL.")

        # Verify
        print("\nVerification:")
        pg_counts = {}
        for table_name, model_class in migration_order:
            pg_count = db.session.execute(db.text(f"SELECT COUNT(*) FROM {table_name}")).scalar()
            pg_counts[table_name] = pg_count
            sqlite_count = sqlite_counts.get(table_name, 0)
            status = "✓" if pg_count == sqlite_count else "✗ MISMATCH"
            print(f"  {table_name}: SQLite={sqlite_count}, PostgreSQL={pg_count} {status}")

        # Spot-check JSONB
        print("\nJSONB spot-check:")
        gd = db.session.execute(db.text(
            "SELECT video_id, stems_paths, chords_data FROM global_downloads WHERE stems_paths IS NOT NULL LIMIT 1"
        )).first()
        if gd:
            print(f"  video_id: {gd[0]}")
            print(f"  stems_paths type: {type(gd[1]).__name__} (should be dict)")
            print(f"  chords_data type: {type(gd[2]).__name__} (should be list or None)")
        else:
            print("  No rows with stems_paths found")

    sqlite_conn.close()
    print("\n=== Migration complete ===")


if __name__ == '__main__':
    main()
