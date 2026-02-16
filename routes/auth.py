"""
Authentication routes: login, logout.
"""

from datetime import datetime
from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_user, logout_user, login_required, current_user

from core.auth_db import authenticate_user
from core.auth_models import User

auth_bp = Blueprint('auth', __name__)


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
    return render_template('login.html', error=error, current_year=datetime.now().year)


@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('auth.login'))
