#!/usr/bin/env python3
"""
Script pour corriger les extractions manquantes dans la base de données
"""

import os
import sqlite3
import json
from pathlib import Path

def find_missing_extractions():
    """Trouver les extractions qui existent sur disque mais pas en base"""
    print("=== RECHERCHE DES EXTRACTIONS MANQUANTES ===\n")
    
    # Connexion à la base de données
    conn = sqlite3.connect("stemtubes.db")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get toutes les entrées user_downloads non extraites
    cursor.execute("""
        SELECT * FROM user_downloads 
        WHERE extracted = 0 OR extracted IS NULL
        ORDER BY created_at DESC
    """)
    non_extracted = cursor.fetchall()
    
    print(f"📋 Entrées non-extraites foundes: {len(non_extracted)}\n")
    
    fixes_needed = []
    
    for entry in non_extracted:
        title = entry['title']
        video_id = entry['video_id']
        user_id = entry['user_id']
        download_id = entry['id']
        
        print(f"🔍 Vérification: {title}")
        print(f"   Video ID: {video_id}")
        print(f"   Download ID: {download_id}")
        
        # Chercher le dossier correspondant
        base_path = Path("core/downloads")
        potential_folders = []
        
        # Chercher par titre
        for folder in base_path.iterdir():
            if folder.is_dir():
                folder_name = folder.name
                # Clean up les noms pour comparaison
                clean_title = title.replace("'", "_").replace('"', '').replace(':', '').replace('?', '').replace('!', '').replace('…', '_').replace('#', '_').replace('&', '_')
                clean_folder = folder_name.replace("'", "_").replace('"', '').replace(':', '').replace('?', '').replace('!', '').replace('…', '_').replace('#', '_').replace('&', '_')
                
                if clean_title.lower() in clean_folder.lower() or clean_folder.lower() in clean_title.lower():
                    potential_folders.append(folder)
        
        stems_found = None
        for folder in potential_folders:
            stems_dir = folder / "audio" / "stems"
            if stems_dir.exists():
                # Vérifier s'il y a des fichiers MP3
                mp3_files = list(stems_dir.glob("*.mp3"))
                if mp3_files:
                    print(f"   ✅ Stems founds: {stems_dir}")
                    print(f"   📁 Fichiers: {[f.name for f in mp3_files]}")
                    
                    # Créer le dictionnaire des stems
                    stems_paths = {}
                    for mp3_file in mp3_files:
                        stem_name = mp3_file.stem  # nom sans extension
                        stems_paths[stem_name] = str(mp3_file.absolute())
                    
                    # Chercher le fichier ZIP
                    zip_files = list(stems_dir.glob("*_stems.zip"))
                    zip_path = str(zip_files[0].absolute()) if zip_files else None
                    
                    stems_found = {
                        'stems_paths': json.dumps(stems_paths),
                        'stems_zip_path': zip_path,
                        'extraction_model': 'htdemucs'  # Supposer htdemucs par défaut
                    }
                    break
        
        if stems_found:
            fixes_needed.append({
                'download_id': download_id,
                'user_id': user_id,
                'video_id': video_id,
                'title': title,
                'stems_data': stems_found
            })
            print(f"   🔧 Correction nécessaire")
        else:
            print(f"   ❌ No stems found")
        
        print()
    
    conn.close()
    return fixes_needed

def apply_fixes(fixes):
    """Appliquer les corrections à la base de données"""
    print("=== APPLICATION DES CORRECTIONS ===\n")
    
    if not fixes:
        print("✅ Noe correction nécessaire")
        return
    
    conn = sqlite3.connect("stemtubes.db")
    cursor = conn.cursor()
    
    for fix in fixes:
        print(f"🔧 Correction: {fix['title']}")
        
        try:
            # Update user_downloads
            cursor.execute("""
                UPDATE user_downloads 
                SET extracted = 1,
                    extraction_model = ?,
                    stems_paths = ?,
                    stems_zip_path = ?,
                    extracted_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (
                fix['stems_data']['extraction_model'],
                fix['stems_data']['stems_paths'],
                fix['stems_data']['stems_zip_path'],
                fix['download_id']
            ))
            
            # Update global_downloads aussi
            cursor.execute("""
                UPDATE global_downloads 
                SET extracted = 1,
                    extraction_model = ?,
                    stems_paths = ?,
                    stems_zip_path = ?,
                    extracted_at = CURRENT_TIMESTAMP
                WHERE video_id = ?
            """, (
                fix['stems_data']['extraction_model'],
                fix['stems_data']['stems_paths'],
                fix['stems_data']['stems_zip_path'],
                fix['video_id']
            ))
            
            print(f"   ✅ Correction appliquée")
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    conn.commit()
    conn.close()
    
    print(f"\n🎉 {len(fixes)} corrections appliquées!")

def main():
    """Fonction principale"""
    print("🔧 RÉPARATION DES EXTRACTIONS MANQUANTES\n")
    
    # Trouver les problèmes
    fixes_needed = find_missing_extractions()
    
    if fixes_needed:
        print(f"💾 {len(fixes_needed)} corrections identifiées:")
        for fix in fixes_needed:
            print(f"  - {fix['title']}")
        
        # Appliquer automatiquement les corrections
        print(f"\n🔧 Application automatique des corrections...")
        apply_fixes(fixes_needed)
    else:
        print("✅ Noe correction nécessaire")

if __name__ == "__main__":
    main()