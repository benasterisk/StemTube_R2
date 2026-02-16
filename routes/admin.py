"""
Admin page routes blueprint.

Handles HTML page routes for admin panel (user management, settings).
API routes are NOT included here.
"""

from flask import Blueprint, render_template, request, redirect, url_for, flash
from flask_login import login_required, current_user

from extensions import admin_required
from core.auth_db import get_all_users, add_user, update_user, reset_user_password, delete_user

admin_bp = Blueprint('admin', __name__)


@admin_bp.route('/admin')
@login_required
@admin_required
def admin_page():
    return render_template('admin.html', users=get_all_users())


@admin_bp.route('/admin/embedded')
@login_required
@admin_required
def admin_embedded():
    """Embedded admin interface for iframe usage."""
    return render_template('admin_embedded.html', users=get_all_users())


@admin_bp.route('/admin/add_user', methods=['POST'])
@login_required
@admin_required
def admin_add_user():
    username = request.form.get('username', '').strip()
    password = request.form.get('password', '').strip()
    email = request.form.get('email', '').strip() or None
    is_admin = 'is_admin' in request.form

    if not username or not password:
        flash('Username and password are required', 'error')
        return redirect(url_for('admin.admin_page'))

    success, message = add_user(username, password, email, is_admin)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin.admin_page'))


@admin_bp.route('/admin/edit_user', methods=['POST'])
@login_required
@admin_required
def admin_edit_user():
    user_id = request.form.get('user_id')
    username = request.form.get('username', '').strip()
    email = request.form.get('email', '').strip() or None
    is_admin = 'is_admin' in request.form

    if not user_id or not username:
        flash('User ID and username are required', 'error')
        return redirect(url_for('admin.admin_page'))

    success, message = update_user(user_id, username=username, email=email, is_admin=is_admin)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin.admin_page'))


@admin_bp.route('/admin/reset_password', methods=['POST'])
@login_required
@admin_required
def admin_reset_password():
    user_id = request.form.get('user_id')
    password = request.form.get('password', '').strip()

    if not user_id or not password:
        flash('User ID and password are required', 'error')
        return redirect(url_for('admin.admin_page'))

    success, message = reset_user_password(user_id, password)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin.admin_page'))


@admin_bp.route('/admin/delete_user', methods=['POST'])
@login_required
@admin_required
def admin_delete_user():
    user_id = request.form.get('user_id')

    if not user_id:
        flash('User ID is required', 'error')
        return redirect(url_for('admin.admin_page'))

    # Don't allow users to delete themselves
    if str(current_user.id) == str(user_id):
        flash('You cannot delete your own account', 'error')
        return redirect(url_for('admin.admin_page'))

    success, message = delete_user(user_id)
    flash(message, 'success' if success else 'error')
    return redirect(url_for('admin.admin_page'))


@admin_bp.route('/admin/mobile-settings')
@login_required
@admin_required
def admin_mobile_settings():
    """Mobile settings configuration page"""
    return render_template('admin-mobile-settings.html')
