#!/usr/bin/env python3
"""
Debug spécifique pour Deep Purple - Perfect Strangers
"""

import os
import sqlite3
import json
from pathlib import Path

def debug_deep_purple():
    """Débugger le problème Deep Purple"""
    print("=== DEBUG DEEP PURPLE - PERFECT STRANGERS ===\n")
    
    # Connexion à la base de données
    conn = sqlite3.connect("stemtubes.db")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Chercher dans global_downloads
    print("1. RECHERCHE DANS GLOBAL_DOWNLOADS:")
    cursor.execute("SELECT * FROM global_downloads WHERE title LIKE '%Deep Purple%' OR title LIKE '%Perfect Strangers%'")
    global_results = cursor.fetchall()
    
    for result in global_results:
        print(f"  ID: {result['id']}")
        print(f"  Video ID: {result['video_id']}")
        print(f"  Title: {result['title']}")
        print(f"  Extracted: {result['extracted']}")
        print(f"  Model: {result.get('extraction_model', 'N/A')}")
        print(f"  Stems paths: {result.get('stems_paths', 'N/A')}")
        print()
    
    # Chercher dans user_downloads
    print("2. RECHERCHE DANS USER_DOWNLOADS:")
    cursor.execute("SELECT * FROM user_downloads WHERE title LIKE '%Deep Purple%' OR title LIKE '%Perfect Strangers%'")
    user_results = cursor.fetchall()
    
    for result in user_results:
        print(f"  User ID: {result['user_id']}")
        print(f"  Download ID: {result['id']}")
        print(f"  Global Download ID: {result['global_download_id']}")
        print(f"  Video ID: {result['video_id']}")
        print(f"  Title: {result['title']}")
        print(f"  Extracted: {result['extracted']}")
        print(f"  Model: {result.get('extraction_model', 'N/A')}")
        print()
    
    # Vérifier sur le système de fichiers
    print("3. VÉRIFICATION SYSTÈME DE FICHIERS:")
    base_path = Path("core/downloads")
    
    for folder in base_path.iterdir():
        if folder.is_dir() and "Deep Purple" in folder.name:
            print(f"  Dossier found: {folder}")
            stems_dir = folder / "audio" / "stems"
            if stems_dir.exists():
                mp3_files = list(stems_dir.glob("*.mp3"))
                print(f"    Stems founds: {[f.name for f in mp3_files]}")
                
                # Vérifier les chemins absolus
                for mp3_file in mp3_files:
                    abs_path = str(mp3_file.absolute())
                    exists = mp3_file.exists()
                    print(f"    {mp3_file.name}: {abs_path} (exists: {exists})")
            else:
                print(f"    Pas de dossier stems dans {folder}")
    
    # Tester l'API de vérification
    print("4. TEST DE L'API DE VÉRIFICATION:")
    if global_results:
        for result in global_results:
            video_id = result['video_id']
            print(f"  Video ID à tester: {video_id}")
            
            # Simuler la logique de l'API
            from core.downloads_db import find_global_extraction, list_extractions_for
            
            global_extraction = find_global_extraction(video_id, 'htdemucs')
            print(f"  find_global_extraction result: {global_extraction}")
            
            # Vérifier pour chaque utilisateur
            for user_id in [1]:  # Administrator
                user_extractions = list_extractions_for(user_id)
                user_has_access = any(
                    ext['video_id'] == video_id and ext.get('extracted') == 1 
                    for ext in user_extractions
                )
                print(f"  User {user_id} has access: {user_has_access}")
                print(f"  User {user_id} extractions: {len(user_extractions)}")
                for ext in user_extractions:
                    if ext['video_id'] == video_id:
                        print(f"    Match: extracted={ext.get('extracted')}, video_id={ext['video_id']}")
    
    conn.close()

if __name__ == "__main__":
    debug_deep_purple()