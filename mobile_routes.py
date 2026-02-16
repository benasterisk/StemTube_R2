"""
Mobile Routes Blueprint
Provides optimized mobile interface and API endpoints
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from core.config import get_setting

mobile_bp = Blueprint('mobile', __name__)


@mobile_bp.route('/api/mobile/config')
@login_required
def mobile_config():
    """
    Get mobile-specific configuration
    """
    return jsonify({
        'mobile_optimized_mode': get_setting('mobile_optimized_mode', True),
        'mobile_force_single_audio': get_setting('mobile_force_single_audio', True),
        'mobile_hide_waveforms': get_setting('mobile_hide_waveforms', False),
        'mobile_simplified_mixer': get_setting('mobile_simplified_mixer', True)
    })


@mobile_bp.route('/api/mobile/toggle', methods=['POST'])
@login_required
def toggle_mobile_mode():
    """
    Admin endpoint to toggle mobile optimized mode
    """
    if not current_user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    from core.config import update_setting, save_config, load_config

    data = request.get_json()
    enabled = data.get('enabled', True)

    # Update config
    config = load_config()
    config['mobile_optimized_mode'] = enabled

    if save_config(config):
        return jsonify({
            'success': True,
            'mobile_optimized_mode': enabled
        })
    else:
        return jsonify({'error': 'Failed to update configuration'}), 500


def register_mobile_routes(app):
    """
    Register mobile blueprint with Flask app

    Usage in app.py:
        from mobile_routes import register_mobile_routes
        register_mobile_routes(app)
    """
    app.register_blueprint(mobile_bp)
    print("[Mobile] Routes registered successfully")
