"""
Request logging middleware for Flask applications.
Logs all HTTP requests and responses with timing and context.
"""

import time
import uuid
from flask import request, g, jsonify
from functools import wraps
from core.logging_config import log_request, get_logger, log_with_context

logger = get_logger(__name__)

def setup_request_logging(app):
    """Setup request logging middleware for Flask app."""
    
    @app.before_request
    def log_request_start():
        """Log the start of each request and set up request context."""
        g.request_start_time = time.time()
        g.request_id = str(uuid.uuid4())
        
        # Get client IP (handle proxies)
        if request.headers.get('X-Forwarded-For'):
            ip = request.headers.get('X-Forwarded-For').split(',')[0].strip()
        else:
            ip = request.remote_addr
        g.client_ip = ip
        
        # Log request start (only for non-static files)
        if not request.path.startswith('/static/'):
            user_id = getattr(request, 'user_id', None)
            if hasattr(g, 'current_user') and g.current_user:
                user_id = g.current_user.id
            
            with log_with_context(logger, request_id=g.request_id, user_id=user_id, ip_address=g.client_ip):
                logger.debug(f"Request started: {request.method} {request.path}")
    
    @app.after_request
    def log_request_end(response):
        """Log the end of each request with timing and response info (minimal by default)."""
        if hasattr(g, 'request_start_time') and not request.path.startswith('/static/'):
            duration_ms = round((time.time() - g.request_start_time) * 1000, 2)

            # Get user ID if available
            user_id = None
            try:
                from flask_login import current_user
                if current_user.is_authenticated:
                    user_id = current_user.id
            except:
                pass

            # Minimal logging by default: only log errors and slow requests
            # Skip logging successful requests (200-399) to reduce log volume
            is_error = response.status_code >= 400
            is_slow = duration_ms > 5000  # 5 seconds

            # Only log if error OR slow request
            if is_error or is_slow:
                # Log the request
                log_request(
                    method=request.method,
                    path=request.path,
                    status_code=response.status_code,
                    duration_ms=duration_ms,
                    user_id=user_id,
                    ip_address=g.client_ip
                )

                # Log slow requests as warnings
                if is_slow:
                    with log_with_context(logger, request_id=g.request_id, user_id=user_id, duration=duration_ms):
                        logger.warning(f"Slow request: {request.method} {request.path} took {duration_ms}ms")

                # Log errors
                if is_error:
                    with log_with_context(logger, request_id=g.request_id, user_id=user_id):
                        logger.warning(f"Request error: {request.method} {request.path} -> {response.status_code}")

        return response
    
    @app.errorhandler(404)
    def log_404_error(error):
        """Log 404 errors."""
        user_id = None
        try:
            from flask_login import current_user
            if current_user.is_authenticated:
                user_id = current_user.id
        except:
            pass
        
        with log_with_context(logger, user_id=user_id, ip_address=getattr(g, 'client_ip', None)):
            logger.warning(f"404 Not Found: {request.method} {request.path}")
        
        return jsonify({'error': 'Not found'}), 404
    
    @app.errorhandler(500)
    def log_500_error(error):
        """Log 500 errors."""
        user_id = None
        try:
            from flask_login import current_user
            if current_user.is_authenticated:
                user_id = current_user.id
        except:
            pass
        
        with log_with_context(logger, user_id=user_id, ip_address=getattr(g, 'client_ip', None)):
            logger.error(f"500 Internal Server Error: {request.method} {request.path}", exc_info=True)
        
        return jsonify({'error': 'Internal server error'}), 500
    
    logger.info("Request logging middleware setup complete")

def require_request_logging(f):
    """Decorator to ensure request logging for specific routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not hasattr(g, 'request_id'):
            g.request_id = str(uuid.uuid4())
            g.request_start_time = time.time()
        
        try:
            result = f(*args, **kwargs)
            return result
        except Exception as e:
            # Log the exception with context
            user_id = None
            try:
                from flask_login import current_user
                if current_user.is_authenticated:
                    user_id = current_user.id
            except:
                pass
            
            with log_with_context(logger, request_id=g.request_id, user_id=user_id):
                logger.error(f"Exception in {f.__name__}: {str(e)}", exc_info=True)
            raise
    
    return decorated_function

def log_api_call(endpoint_name, user_id=None, **kwargs):
    """Helper function to log API calls with context."""
    with log_with_context(logger, user_id=user_id, **kwargs):
        logger.info(f"API call: {endpoint_name}")

def log_user_session_event(event_type, user_id, details=None):
    """Log user session events like login, logout, etc."""
    with log_with_context(logger, user_id=user_id):
        message = f"Session event: {event_type}"
        if details:
            message += f" - {details}"
        logger.info(message)