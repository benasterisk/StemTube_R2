"""
Database module for authentication in StemTube Web.
Handles user management and authentication via SQLAlchemy ORM.
"""
import time
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import string
from sqlalchemy.exc import IntegrityError

from core.models import db, User, model_to_dict


def init_db():
    """Initialize the database tables via SQLAlchemy."""
    db.create_all()

    # Check if admin user exists, create if not
    admin = User.query.filter_by(username='administrator').first()
    if not admin:
        password = generate_secure_password()
        create_user('administrator', password, is_admin=True)
        print("\n" + "=" * 50)
        print("INITIAL ADMIN USER CREATED")
        print("Username: administrator")
        print(f"Password: {password}")
        print("Please change this password after first login")
        print("=" * 50 + "\n")


def generate_secure_password(length=12):
    """Generate a secure random password."""
    alphabet = string.ascii_letters + string.digits + string.punctuation
    password = ''.join(secrets.choice(alphabet) for _ in range(length))
    return password


def create_user(username, password, email=None, is_admin=False):
    """Create a new user in the database."""
    try:
        password_hash = generate_password_hash(password)
        user = User(
            username=username,
            password_hash=password_hash,
            email=email,
            is_admin=is_admin,
        )
        db.session.add(user)
        db.session.commit()
        return True
    except IntegrityError:
        db.session.rollback()
        return False


def get_user_by_id(user_id):
    """Get a user by ID."""
    user = User.query.get(user_id)
    return model_to_dict(user)


def get_user_by_username(username):
    """Get a user by username."""
    user = User.query.filter_by(username=username).first()
    return model_to_dict(user)


def authenticate_user(username, password):
    """Authenticate a user by username and password."""
    user = get_user_by_username(username)
    if user and check_password_hash(user['password_hash'], password):
        return user
    return None


def update_user(user_id, username=None, email=None, is_admin=None, youtube_enabled=None):
    """Update user information."""
    user = User.query.get(user_id)
    if not user:
        return False, "User not found"

    try:
        # Check if username is taken by another user
        if username and username != user.username:
            existing = User.query.filter(
                User.username == username, User.id != user_id
            ).first()
            if existing:
                return False, "Username already exists"

        if username is not None:
            user.username = username
        if email is not None:
            user.email = email
        if is_admin is not None:
            user.is_admin = is_admin
        if youtube_enabled is not None:
            user.youtube_enabled = youtube_enabled

        db.session.commit()
        return True, "User updated successfully"
    except IntegrityError:
        db.session.rollback()
        return False, "Username already exists"
    except Exception as e:
        db.session.rollback()
        print(f"Error updating user: {e}")
        return False, f"Error updating user: {str(e)}"


def change_password(user_id, new_password):
    """Change a user's password."""
    user = User.query.get(user_id)
    if not user:
        return False
    user.password_hash = generate_password_hash(new_password)
    db.session.commit()
    return True


def delete_user(user_id):
    """Delete a user from the database."""
    user = User.query.get(user_id)
    if not user:
        return False, "User not found"

    # Don't allow deletion of the last admin
    if user.is_admin:
        admin_count = User.query.filter_by(is_admin=True).count()
        if admin_count <= 1:
            return False, "Cannot delete the last administrator"

    try:
        db.session.delete(user)
        db.session.commit()
        return True, "User deleted successfully"
    except Exception as e:
        db.session.rollback()
        print(f"Error deleting user: {e}")
        return False, f"Error deleting user: {str(e)}"


def get_all_users():
    """Get all users from the database."""
    users = User.query.all()
    return [
        {
            'id': u.id,
            'username': u.username,
            'email': u.email,
            'is_admin': u.is_admin,
            'youtube_enabled': u.youtube_enabled,
            'created_at': u.created_at,
        }
        for u in users
    ]


def add_user(username, password, email=None, is_admin=False, youtube_enabled=False):
    """Add a new user to the database."""
    # Check if username already exists
    if get_user_by_username(username):
        return False, "Username already exists"

    try:
        password_hash = generate_password_hash(password)
        user = User(
            username=username,
            password_hash=password_hash,
            email=email,
            is_admin=is_admin,
            youtube_enabled=youtube_enabled,
        )
        db.session.add(user)
        db.session.commit()
        return True, "User created successfully"
    except Exception as e:
        db.session.rollback()
        print(f"Error adding user: {e}")
        return False, f"Error creating user: {str(e)}"


def reset_user_password(user_id, new_password):
    """Reset a user's password."""
    user = User.query.get(user_id)
    if not user:
        return False, "User not found"
    try:
        user.password_hash = generate_password_hash(new_password)
        db.session.commit()
        return True, "Password reset successfully"
    except Exception as e:
        db.session.rollback()
        print(f"Error resetting password: {e}")
        return False, f"Error resetting password: {str(e)}"


def set_user_youtube_access(user_id, enabled):
    """Set YouTube access for a specific user."""
    user = User.query.get(user_id)
    if not user:
        return False, "User not found"

    try:
        user.youtube_enabled = bool(enabled)
        db.session.commit()
        return True, "YouTube access updated successfully"
    except Exception as e:
        db.session.rollback()
        print(f"Error updating YouTube access: {e}")
        return False, f"Error updating YouTube access: {str(e)}"


def get_user_disclaimer_status(user_id):
    """Check if user has accepted the disclaimer."""
    user = User.query.get(user_id)
    if user:
        return bool(user.disclaimer_accepted)
    return False


def accept_disclaimer(user_id):
    """Record that user has accepted the disclaimer."""
    user = User.query.get(user_id)
    if not user:
        return False
    try:
        user.disclaimer_accepted = True
        user.disclaimer_accepted_at = datetime.utcnow()
        db.session.commit()
        return True
    except Exception as e:
        db.session.rollback()
        print(f"Error accepting disclaimer: {e}")
        return False


def get_user_jam_code(user_id):
    """Get the persistent jam code for a user, or None if not set."""
    user = User.query.get(user_id)
    return user.jam_code if user and user.jam_code else None


def set_user_jam_code(user_id, jam_code):
    """Store a persistent jam code for a user."""
    user = User.query.get(user_id)
    if not user:
        return False
    user.jam_code = jam_code
    db.session.commit()
    return True


def delete_user_jam_code(user_id):
    """Delete the jam code for a user (allows regeneration)."""
    user = User.query.get(user_id)
    if not user:
        return False
    user.jam_code = None
    db.session.commit()
    return True


def find_user_by_jam_code(jam_code):
    """Look up a user by their jam code. Returns user dict or None."""
    user = User.query.filter_by(jam_code=jam_code).first()
    if user:
        return {'id': user.id, 'username': user.username}
    return None
