"""
User model and authentication utilities for StemTube Web.
Provides Flask-Login integration.
"""
from flask_login import UserMixin

class User(UserMixin):
    """User class for Flask-Login integration."""
    
    def __init__(self, user_data):
        """Initialize a user from database data."""
        self.id = user_data['id']
        self.username = user_data['username']
        self.email = user_data.get('email')
        self.is_admin = bool(user_data.get('is_admin', 0))
        self.youtube_enabled = bool(user_data.get('youtube_enabled', 0))
        self.created_at = user_data.get('created_at')
        
    def get_id(self):
        """Return the user ID as a string, required for Flask-Login."""
        return str(self.id)
    
    @property
    def is_authenticated(self):
        """Return True if the user is authenticated."""
        return True
    
    @property
    def is_active(self):
        """Return True if the user is active."""
        return True
    
    @property
    def is_anonymous(self):
        """Return False as anonymous users aren't supported."""
        return False
    
    def has_admin_access(self):
        """Check if the user has admin access."""
        return self.is_admin
