"""
Authentication routes: login, logout.
"""

from datetime import datetime
from flask import Blueprint, render_template, request, redirect, url_for, flash, g
from flask_login import login_user, logout_user, login_required, current_user

from core.auth_db import authenticate_user
from core.auth_models import User
from core.logging_config import get_logger

logger = get_logger(__name__)

auth_bp = Blueprint('auth', __name__)


def _client_ip():
    """Real client IP, honouring X-Forwarded-For when behind a reverse proxy."""
    ip = getattr(g, 'client_ip', None)
    if ip:
        return ip
    xff = request.headers.get('X-Forwarded-For')
    if xff:
        return xff.split(',')[0].strip()
    return request.remote_addr


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('pages.index'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        remember = 'remember' in request.form
        if not username or not password:
            error = 'Username and password are required.'
            # Logged for fail2ban (brute-force protection). Format is stable.
            logger.warning(f"Failed login attempt for '{username or ''}' from {_client_ip()}")
        else:
            user_data = authenticate_user(username, password)
            if user_data:
                login_user(User(user_data), remember=remember)
                next_page = request.args.get('next') or url_for('pages.index')
                if not next_page.startswith('/'):
                    next_page = url_for('pages.index')
                return redirect(next_page)
            else:
                error = 'Invalid username or password.'
                # Logged for fail2ban (brute-force protection). Format is stable.
                logger.warning(f"Failed login attempt for '{username}' from {_client_ip()}")
    return render_template('login.html', error=error, current_year=datetime.now().year)


@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('auth.login'))
