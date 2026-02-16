#!/usr/bin/env python3
"""
Script pour ré-analyser la structure de tous les morceaux existing
Détecte les sections: intro, couplet, refrain, pont, solo, final
"""

import os
import sys
import sqlite3
import json
from pathlib import Path

# Ajouter le répertoire du projet au PYTHONPATH
sys.path.insert(0, str(Path(__file__).parent))

from core.structure_detector import detect_song_structure

DB_PATH = Path(__file__).parent / "stemtubes.db"


def get_all_downloads_with_audio():
    """Récupère tous les téléloadedments qui ont un fichier audio."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id, video_id, title, file_path, structure_data
        FROM global_downloads
        WHERE file_path IS NOT NULL AND file_path != ''
        ORDER BY created_at DESC
    """)

    downloads = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return downloads


def update_structure_data(video_id, structure_data):
    """Met à jour les données de structure dans la base de données."""
    conn = sqlite3.connect(DB_PATH)

    # Convertir en JSON
    structure_json = json.dumps(structure_data) if structure_data else None

    # Update global_downloads
    cursor = conn.execute("""
        UPDATE global_downloads
        SET structure_data = ?
        WHERE video_id = ?
    """, (structure_json, video_id))

    rows_updated = cursor.rowcount

    # Update user_downloads
    conn.execute("""
        UPDATE user_downloads
        SET structure_data = ?
        WHERE video_id = ?
    """, (structure_json, video_id))

    conn.commit()
    conn.close()

    return rows_updated


def main():
    print("=" * 80)
    print("RÉANALYSE DE LA STRUCTURE MUSICALE DE TOUS LES MORCEAUX")
    print("=" * 80)
    print()

    # Get tous les téléloadedments
    downloads = get_all_downloads_with_audio()

    if not downloads:
        print("❌ No téléloadedment found dans la base de données.")
        return

    print(f"📊 {len(downloads)} morceaux founds dans la base de données\n")

    # Statistiques
    total = len(downloads)
    analyzed = 0
    success = 0
    failed = 0
    skipped = 0

    # Demander confirmation
    print("⚠️  Cette opération va analyser la structure de tous les morceaux.")
    print("   Cela peut prendre plusieurs minutes selon le nombre de morceaux.")
    print()

    # Option --yes pour forcer l'exécution sans confirmation
    if "--yes" not in sys.argv:
        response = input("Continuer ? (y/N): ").strip().lower()
        if response != 'y':
            print("❌ Opération annulée.")
            return

    print()
    print("🚀 Démarrage de l'analyse de structure...\n")

    for i, download in enumerate(downloads, 1):
        video_id = download['video_id']
        title = download['title'] or video_id
        file_path = download['file_path']
        existing_structure = download['structure_data']

        print(f"[{i}/{total}] {title}")
        print(f"   Fichier: {file_path}")

        # Vérifier si le fichier existe
        if not os.path.exists(file_path):
            print(f"   ⚠️  Fichier introuvable, passage au suivant")
            skipped += 1
            print()
            continue

        # Vérifier si déjà analysé
        if existing_structure:
            print(f"   ℹ️  Structure déjà existante, ré-analyse...")

        try:
            # Analyser la structure
            structure_data = detect_song_structure(file_path, use_heuristics=True)

            if structure_data and len(structure_data) > 0:
                # Update la base de données
                rows = update_structure_data(video_id, structure_data)

                if rows > 0:
                    print(f"   ✅ Structure détectée: {len(structure_data)} sections")
                    for section in structure_data:
                        print(f"      - {section['label']}: {section['start']:.1f}s - {section['end']:.1f}s")
                    success += 1
                else:
                    print(f"   ⚠️  Noe ligne mise à jour (video_id introuvable)")
                    failed += 1
            else:
                print(f"   ⚠️  Failed de la détection de structure")
                failed += 1

            analyzed += 1

        except Exception as e:
            print(f"   ❌ Error: {e}")
            failed += 1

        print()

    # Show le résumé
    print("=" * 80)
    print("RÉSUMÉ")
    print("=" * 80)
    print(f"Total:         {total} morceaux")
    print(f"Analysés:      {analyzed} morceaux")
    print(f"Succès:        {success} morceaux")
    print(f"Faileds:        {failed} morceaux")
    print(f"Ignorés:       {skipped} morceaux (fichiers introuvables)")
    print()

    if success > 0:
        print(f"✅ {success} morceaux ont été analysés with succès!")
    if failed > 0:
        print(f"⚠️  {failed} morceaux n'ont pas pu être analysés.")
    if skipped > 0:
        print(f"ℹ️  {skipped} morceaux ont été ignorés (fichiers introuvables).")


if __name__ == "__main__":
    main()
