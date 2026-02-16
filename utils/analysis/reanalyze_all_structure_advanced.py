#!/usr/bin/env python3
"""
Script pour ré-analyser la structure musicale de tous les morceaux téléchargés
Utilise le détecteur avancé with analyse chroma et détection de répétitions
"""

import os
import sys
import json
import sqlite3
from pathlib import Path

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.advanced_structure_detector import detect_song_structure_advanced


def get_all_downloads():
    """Récupère tous les téléloadedments depuis la base de données"""
    db_path = "stemtubes.db"

    if not os.path.exists(db_path):
        print(f"❌ Base de données introuvable: {db_path}")
        return []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get tous les downloads with leur BPM détecté
    cursor.execute("""
        SELECT DISTINCT
            video_id,
            title,
            file_path,
            detected_bpm,
            structure_data
        FROM global_downloads
        WHERE file_path IS NOT NULL
        AND file_path != ''
        ORDER BY title
    """)

    downloads = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return downloads


def update_structure_in_db(video_id, structure_data):
    """Met à jour la structure dans la base de données"""
    db_path = "stemtubes.db"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    structure_json = json.dumps(structure_data) if structure_data else None

    # Update global_downloads
    cursor.execute("""
        UPDATE global_downloads
        SET structure_data = ?
        WHERE video_id = ?
    """, (structure_json, video_id))

    # Update user_downloads aussi
    cursor.execute("""
        UPDATE user_downloads
        SET structure_data = ?
        WHERE video_id = ?
    """, (structure_json, video_id))

    conn.commit()
    conn.close()


def reanalyze_all(force=False):
    """
    Ré-analyse tous les morceaux with le détecteur avancé

    Args:
        force: Si True, ré-analyse même si structure_data existe déjà
    """
    print("=" * 80)
    print("RÉANALYSE DE LA STRUCTURE MUSICALE (DÉTECTEUR AVANCÉ)")
    print("=" * 80)
    print()

    downloads = get_all_downloads()

    if not downloads:
        print("❌ No téléloadedment found dans la base de données")
        return

    print(f"📊 {len(downloads)} morceaux founds dans la base de données")
    print()

    if not force:
        print("⚠️  Cette opération va analyser la structure de tous les morceaux.")
        print("   Cela peut prendre plusieurs minutes selon le nombre de morceaux.")
        print()
        response = input("Continuer? (y/N): ")
        if response.lower() != 'y':
            print("❌ Annulé")
            return

    print()
    print("🚀 Démarrage de l'analyse de structure avancée...")
    print()

    success_count = 0
    error_count = 0
    skipped_count = 0

    for idx, download in enumerate(downloads, 1):
        video_id = download['video_id']
        title = download['title']
        file_path = download['file_path']
        detected_bpm = download['detected_bpm']
        has_structure = download['structure_data'] is not None

        print(f"[{idx}/{len(downloads)}] {title}")
        print(f"   Fichier: {file_path}")

        # Vérifier que le fichier existe
        if not os.path.exists(file_path):
            print(f"   ⚠️  Fichier introuvable, ignoré")
            skipped_count += 1
            print()
            continue

        # Informer si structure existe déjà
        if has_structure and not force:
            print(f"   ℹ️  Structure déjà existante, ré-analyse...")

        try:
            # Analyser la structure with le détecteur avancé
            structure_data = detect_song_structure_advanced(
                file_path,
                bpm=detected_bpm,
                use_msaf=True
            )

            if structure_data:
                # Sauvegarder dans la base de données
                update_structure_in_db(video_id, structure_data)

                print(f"   ✅ Structure détectée: {len(structure_data)} sections")

                # Show les sections
                for section in structure_data:
                    print(f"      - {section['label']}: {section['start']:.1f}s - {section['end']:.1f}s")

                success_count += 1
            else:
                print(f"   ⚠️  Noe detected structure")
                error_count += 1

        except Exception as e:
            print(f"   ❌ Error: {e}")
            error_count += 1

        print()

    # Résumé
    print("=" * 80)
    print("RÉSUMÉ")
    print("=" * 80)
    print(f"Total:         {len(downloads)} morceaux")
    print(f"Analysés:      {success_count + error_count} morceaux")
    print(f"Succès:        {success_count} morceaux")
    print(f"Faileds:        {error_count} morceaux")
    print(f"Ignorés:       {skipped_count} morceaux (fichiers introuvables)")
    print()

    if success_count > 0:
        print(f"✅ {success_count} morceaux ont été analysés with succès!")

    if error_count > 0:
        print(f"⚠️  {error_count} morceaux n'ont pas pu être analysés")


if __name__ == "__main__":
    # Vérifier si --yes ou -y est passé en argument
    force_yes = "--yes" in sys.argv or "-y" in sys.argv

    reanalyze_all(force=force_yes)
