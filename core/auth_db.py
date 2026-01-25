"""
Database module for authentication in StemTube Web.
Handles user management and authentication.
"""
import os
import sqlite3
import time
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import string

# Path to the database file
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'stemtubes.db')

def get_db_connection():
    """Get a connection to the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize the database with the users table if it doesn't exist."""
    conn = get_db_connection()
    try:
        # Create users table if it doesn't exist
        conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            is_admin BOOLEAN DEFAULT 0,
            disclaimer_accepted BOOLEAN DEFAULT 0,
            disclaimer_accepted_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        # Add disclaimer fields to existing users table if they don't exist
        try:
            conn.execute('ALTER TABLE users ADD COLUMN disclaimer_accepted BOOLEAN DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # Column already exists
        
        try:
            conn.execute('ALTER TABLE users ADD COLUMN disclaimer_accepted_at TIMESTAMP')
        except sqlite3.OperationalError:
            pass  # Column already exists

        # Add youtube_enabled column for per-user YouTube access control
        try:
            conn.execute('ALTER TABLE users ADD COLUMN youtube_enabled BOOLEAN DEFAULT 0')
        except sqlite3.OperationalError:
            pass  # Column already exists

        conn.commit()
        
        # Check if admin user exists, create if not
        admin_exists = conn.execute('SELECT COUNT(*) FROM users WHERE username = ?', ('administrator',)).fetchone()[0]
        if admin_exists == 0:
            # Generate a secure random password
            password = generate_secure_password()
            create_user('administrator', password, is_admin=True)
            print("\n" + "="*50)
            print("INITIAL ADMIN USER CREATED")
            print("Username: administrator")
            print(f"Password: {password}")
            print("Please change this password after first login")
            print("="*50 + "\n")
    finally:
        conn.close()

def generate_secure_password(length=12):
    """Generate a secure random password."""
    alphabet = string.ascii_letters + string.digits + string.punctuation
    password = ''.join(secrets.choice(alphabet) for _ in range(length))
    return password

def create_user(username, password, email=None, is_admin=False):
    """Create a new user in the database."""
    conn = get_db_connection()
    try:
        password_hash = generate_password_hash(password)
        conn.execute(
            'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
            (username, password_hash, email, is_admin)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        # Username already exists
        return False
    finally:
        conn.close()

def get_user_by_id(user_id):
    """Get a user by ID."""
    conn = get_db_connection()
    try:
        user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        return dict(user) if user else None
    finally:
        conn.close()

def get_user_by_username(username):
    """Get a user by username."""
    conn = get_db_connection()
    try:
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        return dict(user) if user else None
    finally:
        conn.close()

def authenticate_user(username, password):
    """Authenticate a user by username and password."""
    user = get_user_by_username(username)
    if user and check_password_hash(user['password_hash'], password):
        return user
    return None

def update_user(user_id, username=None, email=None, is_admin=None):
    """Update a user's information."""
    conn = get_db_connection()
    try:
        updates = []
        params = []
        
        if username is not None:
            updates.append('username = ?')
            params.append(username)
        
        if email is not None:
            updates.append('email = ?')
            params.append(email)
        
        if is_admin is not None:
            updates.append('is_admin = ?')
            params.append(is_admin)
        
        if not updates:
            return False
        
        query = f'UPDATE users SET {", ".join(updates)} WHERE id = ?'
        params.append(user_id)
        
        conn.execute(query, params)
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        # Username already exists
        return False
    finally:
        conn.close()

def change_password(user_id, new_password):
    """Change a user's password."""
    conn = get_db_connection()
    try:
        password_hash = generate_password_hash(new_password)
        conn.execute(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            (password_hash, user_id)
        )
        conn.commit()
        return True
    finally:
        conn.close()

def delete_user(user_id):
    """Delete a user from the database."""
    conn = get_db_connection()
    try:
        conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        return True
    finally:
        conn.close()

def get_all_users():
    """Get all users from the database."""
    conn = get_db_connection()
    try:
        users = conn.execute('SELECT id, username, email, is_admin, youtube_enabled, created_at FROM users').fetchall()
        return [dict(user) for user in users]
    finally:
        conn.close()

def add_user(username, password, email=None, is_admin=False, youtube_enabled=False):
    """Add a new user to the database."""
    # Check if username already exists
    if get_user_by_username(username):
        return False, "Username already exists"

    password_hash = generate_password_hash(password)
    conn = get_db_connection()
    try:
        conn.execute(
            'INSERT INTO users (username, password_hash, email, is_admin, youtube_enabled) VALUES (?, ?, ?, ?, ?)',
            (username, password_hash, email, is_admin, youtube_enabled)
        )
        conn.commit()
        return True, "User created successfully"
    except Exception as e:
        print(f"Error adding user: {e}")
        return False, f"Error creating user: {str(e)}"
    finally:
        conn.close()

def update_user(user_id, username=None, email=None, is_admin=None, youtube_enabled=None):
    """Update user information."""
    conn = get_db_connection()
    try:
        # Get current user data
        user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user:
            return False, "User not found"

        # Check if username is taken by another user
        if username and username != user['username']:
            existing = conn.execute('SELECT id FROM users WHERE username = ? AND id != ?', (username, user_id)).fetchone()
            if existing:
                return False, "Username already exists"

        # Build update query dynamically
        updates = []
        params = []

        if username is not None:
            updates.append('username = ?')
            params.append(username)
        if email is not None:
            updates.append('email = ?')
            params.append(email)
        if is_admin is not None:
            updates.append('is_admin = ?')
            params.append(is_admin)
        if youtube_enabled is not None:
            updates.append('youtube_enabled = ?')
            params.append(youtube_enabled)

        if updates:
            params.append(user_id)
            query = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
            conn.execute(query, params)
            conn.commit()

        return True, "User updated successfully"
    except Exception as e:
        print(f"Error updating user: {e}")
        return False, f"Error updating user: {str(e)}"
    finally:
        conn.close()

def reset_user_password(user_id, new_password):
    """Reset a user's password."""
    password_hash = generate_password_hash(new_password)
    conn = get_db_connection()
    try:
        cursor = conn.execute('UPDATE users SET password_hash = ? WHERE id = ?', (password_hash, user_id))
        if cursor.rowcount == 0:
            return False, "User not found"
        conn.commit()
        return True, "Password reset successfully"
    except Exception as e:
        print(f"Error resetting password: {e}")
        return False, f"Error resetting password: {str(e)}"
    finally:
        conn.close()

def delete_user(user_id):
    """Delete a user from the database."""
    conn = get_db_connection()
    try:
        # Check if user exists
        user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user:
            return False, "User not found"
        
        # Don't allow deletion of the last admin
        if user['is_admin']:
            admin_count = conn.execute('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').fetchone()['count']
            if admin_count <= 1:
                return False, "Cannot delete the last administrator"
        
        # Delete user
        cursor = conn.execute('DELETE FROM users WHERE id = ?', (user_id,))
        conn.commit()
        return True, "User deleted successfully"
    except Exception as e:
        print(f"Error deleting user: {e}")
        return False, f"Error deleting user: {str(e)}"
    finally:
        conn.close()

def set_user_youtube_access(user_id, enabled):
    """Set YouTube access for a specific user."""
    conn = get_db_connection()
    try:
        user = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        if not user:
            return False, "User not found"

        conn.execute(
            'UPDATE users SET youtube_enabled = ? WHERE id = ?',
            (1 if enabled else 0, user_id)
        )
        conn.commit()
        return True, "YouTube access updated successfully"
    except Exception as e:
        print(f"Error updating YouTube access: {e}")
        return False, f"Error updating YouTube access: {str(e)}"
    finally:
        conn.close()

def get_user_disclaimer_status(user_id):
    """Check if user has accepted the disclaimer."""
    conn = get_db_connection()
    try:
        user = conn.execute('SELECT disclaimer_accepted FROM users WHERE id = ?', (user_id,)).fetchone()
        if user:
            return bool(user['disclaimer_accepted'])
        return False
    finally:
        conn.close()

def accept_disclaimer(user_id):
    """Record that user has accepted the disclaimer."""
    conn = get_db_connection()
    try:
        conn.execute(
            'UPDATE users SET disclaimer_accepted = 1, disclaimer_accepted_at = CURRENT_TIMESTAMP WHERE id = ?',
            (user_id,)
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Error accepting disclaimer: {e}")
        return False
    finally:
        conn.close()
