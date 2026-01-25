"""
Script pour réinitialiser le mot de passe administrateur de StemTube Web.
"""
import os
import sys
import sqlite3
from core.auth_db import get_user_by_username, change_password, generate_secure_password

def reset_admin_password():
    """Réinitialise le mot de passe de l'utilisateur administrateur."""
    # Vérifier si l'utilisateur administrateur existe
    admin = get_user_by_username('administrator')
    
    if not admin:
        print("L'utilisateur administrateur n'existe pas encore.")
        print("Veuillez démarrer l'application principale pour créer l'utilisateur administrateur.")
        return
    
    # Générer un nouveau mot de passe
    new_password = generate_secure_password()
    
    # Changer le mot de passe
    success = change_password(admin['id'], new_password)
    
    if success:
        print("\n" + "="*50)
        print("MOT DE PASSE ADMINISTRATEUR RÉINITIALISÉ")
        print("Username: administrator")
        print(f"Password: {new_password}")
        print("Veuillez changer ce mot de passe après la connexion")
        print("="*50 + "\n")
    else:
        print("Error lors de la réinitialisation du mot de passe.")

if __name__ == "__main__":
    reset_admin_password()
