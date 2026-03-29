"""
Database connection management and path resolution utilities.

SQLAlchemy ORM replaces raw sqlite3 — sessions come from core.models.db.
Path resolution helpers remain for migrating stored file paths.

NOTE: _conn() is kept as a deprecated shim for unconverted modules
(extractions.py, cleanup.py, admin.py, routes/*). Remove once those
are migrated to SQLAlchemy.
"""
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "stemtubes.db"
APP_ROOT = Path(__file__).parent.parent.parent
DOWNLOADS_ROOT = APP_ROOT / "core" / "downloads"


def get_session():
    """Return the current SQLAlchemy scoped session (db.session)."""
    from core.models import db
    return db.session


def _conn():
    """DEPRECATED: raw sqlite3 connection for unconverted modules.

    New code should use get_session() or db.session from core.models.
    This exists only so that unconverted files (extractions.py, cleanup.py,
    admin.py, routes/*) keep working until they are migrated.
    """
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def resolve_file_path(stored_path):
    """
    Convert stored file paths to absolute paths based on current application directory.

    Handles migration from old absolute paths (e.g., /opt/stemtube/StemTube-dev/...,
    /home/.../stemtube_v1.0/..., /home/.../stemtube_dev_v1.1/...) to the current
    installation by extracting the relative downloads path and rebasing it on
    the current app root.

    Args:
        stored_path: Path string from database (can be absolute with old prefix or relative)

    Returns:
        Absolute path string resolved from current application directory, or None if invalid
    """
    if not stored_path:
        return None

    path_str = str(stored_path)
    normalized = path_str.replace('\\', '/')
    downloads_root_str = str(DOWNLOADS_ROOT).replace('\\', '/')
    anchor = "core/downloads/"
    normalized_lower = normalized.lower()

    # If path already points inside the current downloads directory, keep it
    if normalized.startswith(downloads_root_str):
        return str(Path(path_str))

    # Rebase any path that contains the downloads anchor (covers all previous installs)
    anchor_idx = normalized_lower.find(anchor)
    if anchor_idx != -1:
        relative_part = normalized[anchor_idx + len(anchor):]
        resolved = DOWNLOADS_ROOT / relative_part
        return str(resolved)

    # If it's an absolute path that exists, use it as-is
    path_obj = Path(path_str)
    if path_obj.is_absolute() and path_obj.exists():
        return str(path_obj)

    # Last resort: try treating it as relative to app root
    resolved = APP_ROOT / path_str
    if resolved.exists():
        return str(resolved)

    # Return the original path if nothing worked (will fail later with clear error)
    return path_str


def _resolve_paths_in_record(record):
    """
    Helper function to resolve file paths in a database record dictionary.

    Modifies the record in-place to replace stored paths with resolved paths.
    """
    if not record:
        return record

    # Resolve simple file paths
    if record.get('file_path'):
        record['file_path'] = resolve_file_path(record['file_path'])

    if record.get('stems_zip_path'):
        record['stems_zip_path'] = resolve_file_path(record['stems_zip_path'])

    # Resolve individual stem paths in JSON
    # With PostgreSQL JSONB, stems_paths may already be a dict (not a JSON string)
    if record.get('stems_paths'):
        stems = record['stems_paths']
        try:
            if isinstance(stems, str):
                stems_dict = json.loads(stems)
            else:
                stems_dict = stems
            resolved_stems = {k: resolve_file_path(v) for k, v in stems_dict.items()}
            # Return as JSON string for backward compatibility with callers
            record['stems_paths'] = json.dumps(resolved_stems)
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass  # Leave as-is if not valid JSON/dict

    return record
