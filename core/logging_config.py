"""
Comprehensive logging configuration for StemTube Web application.
Provides structured logging with file output, rotation, and multiple loggers.
"""

import logging
import logging.handlers
import os
import sys
from pathlib import Path
from datetime import datetime
import json

class JSONFormatter(logging.Formatter):
    """Custom JSON formatter for structured logging."""
    
    def format(self, record):
        log_obj = {
            'timestamp': datetime.fromtimestamp(record.created).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno,
        }
        
        # Add extra fields if present
        if hasattr(record, 'user_id'):
            log_obj['user_id'] = record.user_id
        if hasattr(record, 'video_id'):
            log_obj['video_id'] = record.video_id
        if hasattr(record, 'request_id'):
            log_obj['request_id'] = record.request_id
        if hasattr(record, 'ip_address'):
            log_obj['ip_address'] = record.ip_address
        if hasattr(record, 'duration'):
            log_obj['duration_ms'] = record.duration
            
        # Add exception info if present
        if record.exc_info:
            log_obj['exception'] = self.formatException(record.exc_info)
            
        return json.dumps(log_obj, ensure_ascii=False)

class ColoredConsoleFormatter(logging.Formatter):
    """Colored console formatter for better readability."""
    
    COLORS = {
        'DEBUG': '\033[36m',     # Cyan
        'INFO': '\033[32m',      # Green
        'WARNING': '\033[33m',   # Yellow
        'ERROR': '\033[31m',     # Red
        'CRITICAL': '\033[35m',  # Magenta
    }
    RESET = '\033[0m'
    
    def format(self, record):
        # Add color to level name
        level_color = self.COLORS.get(record.levelname, '')
        record.levelname = f"{level_color}{record.levelname}{self.RESET}"
        
        # Format timestamp
        timestamp = datetime.fromtimestamp(record.created).strftime('%H:%M:%S')
        
        # Build the message
        message = f"[{timestamp}] {record.levelname:<15} {record.name:<20} {record.getMessage()}"
        
        # Add context if available
        context_parts = []
        if hasattr(record, 'user_id'):
            context_parts.append(f"user={record.user_id}")
        if hasattr(record, 'video_id'):
            context_parts.append(f"video={record.video_id}")
        if hasattr(record, 'request_id'):
            context_parts.append(f"req={record.request_id[:8]}")
            
        if context_parts:
            message += f" [{' '.join(context_parts)}]"
            
        return message

def setup_logging(app_name="stemtube", log_level="INFO", log_dir="logs"):
    """
    Setup comprehensive logging configuration.
    
    Args:
        app_name: Name of the application for log files
        log_level: Minimum log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_dir: Directory to store log files (relative to app root)
    """
    
    # Create logs directory
    log_path = Path(__file__).parent.parent / log_dir
    log_path.mkdir(exist_ok=True)
    
    # Convert log level string to logging constant
    numeric_level = getattr(logging, log_level.upper(), logging.INFO)
    
    # Remove existing handlers to avoid duplicates
    root_logger = logging.getLogger()
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)
    
    # Configure root logger
    root_logger.setLevel(logging.DEBUG)  # Capture everything, filter at handler level
    
    # 1. Console Handler (colored, human-readable)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(numeric_level)
    console_formatter = ColoredConsoleFormatter()
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)
    
    # 2. Main Application Log (JSON format, rotating)
    app_log_file = log_path / f"{app_name}.log"
    app_handler = logging.handlers.RotatingFileHandler(
        app_log_file,
        maxBytes=10*1024*1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )
    app_handler.setLevel(logging.DEBUG)
    app_formatter = JSONFormatter()
    app_handler.setFormatter(app_formatter)
    root_logger.addHandler(app_handler)
    
    # 3. Error Log (Warnings and above only)
    error_log_file = log_path / f"{app_name}_errors.log"
    error_handler = logging.handlers.RotatingFileHandler(
        error_log_file,
        maxBytes=5*1024*1024,   # 5MB
        backupCount=3,
        encoding='utf-8'
    )
    error_handler.setLevel(logging.WARNING)
    error_handler.setFormatter(app_formatter)
    root_logger.addHandler(error_handler)
    
    # 4. Access Log (HTTP requests)
    access_log_file = log_path / f"{app_name}_access.log"
    access_handler = logging.handlers.RotatingFileHandler(
        access_log_file,
        maxBytes=20*1024*1024,  # 20MB
        backupCount=7,
        encoding='utf-8'
    )
    access_handler.setLevel(logging.INFO)
    access_handler.setFormatter(app_formatter)
    
    # Create access logger
    access_logger = logging.getLogger('access')
    access_logger.setLevel(logging.INFO)
    access_logger.addHandler(access_handler)
    access_logger.propagate = False  # Don't propagate to root logger
    
    # 5. Database Log (Database operations)
    db_log_file = log_path / f"{app_name}_database.log"
    db_handler = logging.handlers.RotatingFileHandler(
        db_log_file,
        maxBytes=10*1024*1024,  # 10MB
        backupCount=3,
        encoding='utf-8'
    )
    db_handler.setLevel(logging.DEBUG)
    db_handler.setFormatter(app_formatter)
    
    # Create database logger (INFO level by default - less verbose)
    db_logger = logging.getLogger('database')
    db_logger.setLevel(logging.INFO)
    db_logger.addHandler(db_handler)
    db_logger.propagate = False
    
    # 6. Download/Extraction Log (Processing operations)
    processing_log_file = log_path / f"{app_name}_processing.log"
    processing_handler = logging.handlers.RotatingFileHandler(
        processing_log_file,
        maxBytes=15*1024*1024,  # 15MB
        backupCount=5,
        encoding='utf-8'
    )
    processing_handler.setLevel(logging.DEBUG)
    processing_handler.setFormatter(app_formatter)
    
    # Create processing logger (INFO level by default - less verbose)
    processing_logger = logging.getLogger('processing')
    processing_logger.setLevel(logging.INFO)
    processing_logger.addHandler(processing_handler)
    processing_logger.propagate = False
    
    print(f"[OK] Logging configured - Files: {log_path}")
    print(f"   Main log: {app_log_file}")
    print(f"   Error log: {error_log_file}")
    print(f"   Access log: {access_log_file}")
    print(f"   Database log: {db_log_file}")
    print(f"   Processing log: {processing_log_file}")
    
    return {
        'main': root_logger,
        'access': access_logger,
        'database': db_logger,
        'processing': processing_logger,
        'log_dir': log_path
    }

def get_logger(name=None):
    """Get a logger instance."""
    return logging.getLogger(name)

def get_access_logger():
    """Get the access logger for HTTP requests."""
    return logging.getLogger('access')

def get_database_logger():
    """Get the database logger for DB operations."""
    return logging.getLogger('database')

def get_processing_logger():
    """Get the processing logger for downloads/extractions."""
    return logging.getLogger('processing')

class LogContext:
    """Context manager for adding extra fields to log records."""
    
    def __init__(self, logger, **kwargs):
        self.logger = logger
        self.old_factory = logging.getLogRecordFactory()
        self.extra = kwargs
    
    def __enter__(self):
        def record_factory(*args, **factory_kwargs):
            record = self.old_factory(*args, **factory_kwargs)
            for key, value in self.extra.items():
                setattr(record, key, value)
            return record
        
        logging.setLogRecordFactory(record_factory)
        return self.logger
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        logging.setLogRecordFactory(self.old_factory)

def log_with_context(logger, **context):
    """Create a context manager that adds extra fields to log records."""
    return LogContext(logger, **context)

# Convenience functions for common logging patterns
def log_request(method, path, status_code, duration_ms, user_id=None, ip_address=None):
    """Log HTTP request with standardized format."""
    access_logger = get_access_logger()
    with log_with_context(access_logger, user_id=user_id, ip_address=ip_address, duration=duration_ms):
        access_logger.info(f"{method} {path} -> {status_code}")

def log_user_action(action, user_id, video_id=None, details=None):
    """Log user action with context."""
    logger = get_logger('user_actions')
    with log_with_context(logger, user_id=user_id, video_id=video_id):
        message = f"User action: {action}"
        if details:
            message += f" - {details}"
        logger.info(message)

def log_database_operation(operation, table, user_id=None, video_id=None, affected_rows=None):
    """Log database operation with context."""
    db_logger = get_database_logger()
    with log_with_context(db_logger, user_id=user_id, video_id=video_id):
        message = f"DB {operation}: {table}"
        if affected_rows is not None:
            message += f" (affected: {affected_rows} rows)"
        db_logger.debug(message)

def log_processing_event(event_type, video_id, user_id=None, progress=None, details=None):
    """Log download/extraction processing events."""
    processing_logger = get_processing_logger()
    with log_with_context(processing_logger, user_id=user_id, video_id=video_id):
        message = f"Processing {event_type}"
        if progress is not None:
            message += f" ({progress}%)"
        if details:
            message += f" - {details}"
        processing_logger.info(message)