#!/usr/bin/env python3
"""
Script de débogage pour tester le loadedment des stems dans le mixer
"""

import os
import json
from core.downloads_db import list_extractions_for, get_download_by_id
from core.auth_db import get_user_by_username

def debug_extractions():
    """Débugger les extractions disponibles"""
    print("=== DÉBOGAGE DES EXTRACTIONS ===\n")
    
    # Get l'utilisateur admin
    admin_user = get_user_by_username('administrator')
    if not admin_user:
        print("❌ Utilisateur administrator non found")
        return
        
    user_id = admin_user['id']
    print(f"✅ Utilisateur found: {admin_user['username']} (ID: {user_id})\n")
    
    # Get les extractions de l'utilisateur
    extractions = list_extractions_for(user_id)
    print(f"📊 Nombre d'extractions foundes: {len(extractions)}\n")
    
    if not extractions:
        print("⚠️  Noe extraction founde")
        return
    
    # Analyser chaque extraction
    for i, extraction in enumerate(extractions[-5:], 1):  # Les 5 dernières
        print(f"--- EXTRACTION {i} ---")
        print(f"ID: {extraction.get('id')}")
        print(f"Video ID: {extraction.get('video_id')}")
        print(f"Title: {extraction.get('title', 'N/A')}")
        print(f"Extracted: {extraction.get('extracted')}")
        print(f"Model: {extraction.get('extraction_model', 'N/A')}")
        print(f"Extracted at: {extraction.get('extracted_at', 'N/A')}")
        
        # Analyser les chemins de stems
        stems_paths = extraction.get('stems_paths')
        if stems_paths:
            try:
                stems_data = json.loads(stems_paths) if isinstance(stems_paths, str) else stems_paths
                print(f"Stems disponibles: {list(stems_data.keys())}")
                
                # Vérifier si les fichiers existent
                print("Vérification des fichiers:")
                for stem_name, stem_path in stems_data.items():
                    exists = os.path.exists(stem_path) if stem_path else False
                    status = "✅" if exists else "❌"
                    print(f"  {status} {stem_name}: {stem_path}")
                    
            except Exception as e:
                print(f"❌ Error lors du parsing des stems_paths: {e}")
        else:
            print("❌ No stems_paths found")
            
        # Analyser le chemin ZIP
        stems_zip_path = extraction.get('stems_zip_path')
        if stems_zip_path:
            zip_exists = os.path.exists(stems_zip_path)
            status = "✅" if zip_exists else "❌"
            print(f"ZIP stems: {status} {stems_zip_path}")
        else:
            print("❌ No ZIP stems found")
            
        print()

def test_api_urls():
    """Tester les URLs API pour les extractions récentes"""
    print("=== TEST DES URLS API ===\n")
    
    admin_user = get_user_by_username('administrator')
    if not admin_user:
        print("❌ Utilisateur administrator non found")
        return
        
    user_id = admin_user['id']
    extractions = list_extractions_for(user_id)
    
    if not extractions:
        print("⚠️  Noe extraction founde")
        return
        
    print("URLs à tester dans le mixer:\n")
    
    for extraction in extractions[-3:]:  # Les 3 dernières
        video_id = extraction.get('video_id')
        download_id = extraction.get('id')
        title = extraction.get('title', 'Unknown')
        
        print(f"📹 {title}")
        print(f"   Video ID: {video_id}")
        print(f"   Download ID: {download_id}")
        
        # Format extraction ID pour le mixer
        extraction_id = f"download_{download_id}"
        print(f"   Extraction ID pour mixer: {extraction_id}")
        
        # URLs API à tester
        standard_stems = ['vocals', 'drums', 'bass', 'other']
        
        stems_paths = extraction.get('stems_paths')
        if stems_paths:
            try:
                stems_data = json.loads(stems_paths) if isinstance(stems_paths, str) else stems_paths
                available_stems = list(stems_data.keys())
                print(f"   Stems disponibles: {available_stems}")
                
                for stem in available_stems:
                    url = f"/api/extracted_stems/{extraction_id}/{stem}"
                    print(f"   🔗 {url}")
                    
            except Exception as e:
                print(f"   ❌ Error parsing stems: {e}")
        else:
            print(f"   ⚠️  Pas de stems_paths, test with stems standards")
            for stem in standard_stems:
                url = f"/api/extracted_stems/{extraction_id}/{stem}"
                print(f"   🔗 {url}")
                
        print()

if __name__ == "__main__":
    debug_extractions()
    test_api_urls()