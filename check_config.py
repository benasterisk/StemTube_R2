#!/usr/bin/env python3
"""
StemTube Configuration Verification Script

Verifies that all required security configuration is present before starting the application.
Run this script to ensure your .env file is properly configured.
"""

import os
import sys
from pathlib import Path

# ANSI color codes
RED = '\033[91m'
GREEN = '\033[92m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
BOLD = '\033[1m'
RESET = '\033[0m'

def print_header(text):
    """Print formatted header"""
    print(f"\n{BOLD}{BLUE}{'=' * 80}{RESET}")
    print(f"{BOLD}{BLUE}{text.center(80)}{RESET}")
    print(f"{BOLD}{BLUE}{'=' * 80}{RESET}\n")

def print_success(text):
    """Print success message"""
    print(f"{GREEN}✓{RESET} {text}")

def print_error(text):
    """Print error message"""
    print(f"{RED}✗{RESET} {text}")

def print_warning(text):
    """Print warning message"""
    print(f"{YELLOW}⚠{RESET} {text}")

def print_info(text):
    """Print info message"""
    print(f"{BLUE}ℹ{RESET} {text}")

def check_env_file():
    """Check if .env file exists"""
    env_path = Path('.env')
    if not env_path.exists():
        print_error(".env file not found!")
        print()
        print_info("Quick setup:")
        print("  1. cp .env.example .env")
        print("  2. python -c \"import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))\" >> .env")
        print("  3. chmod 600 .env")
        print()
        return False

    print_success(".env file exists")

    # Check file permissions (Unix-like systems)
    if hasattr(os, 'stat'):
        import stat
        mode = env_path.stat().st_mode
        perms = stat.filemode(mode)
        if mode & (stat.S_IRWXG | stat.S_IRWXO):
            print_warning(f".env permissions are too open: {perms}")
            print_info("  Recommended: chmod 600 .env")
        else:
            print_success(f".env permissions are secure: {perms}")

    return True

def load_env_file():
    """Load environment variables from .env file"""
    env_vars = {}
    try:
        with open('.env', 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    if '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()
    except Exception as e:
        print_error(f"Failed to read .env file: {e}")
        return None

    return env_vars

def check_flask_secret_key(env_vars):
    """Check Flask secret key configuration"""
    secret_key = env_vars.get('FLASK_SECRET_KEY') or os.environ.get('FLASK_SECRET_KEY')

    if not secret_key:
        print_error("FLASK_SECRET_KEY is not set!")
        print()
        print_info("Generate and add a secure key:")
        print("  python -c \"import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))\" >> .env")
        print()
        return False

    # Check key strength
    if len(secret_key) < 32:
        print_warning(f"FLASK_SECRET_KEY is too short ({len(secret_key)} chars)")
        print_info("  Recommended: At least 64 characters")
        print_info("  Generate new key: python -c \"import secrets; print(secrets.token_hex(32))\"")
    else:
        print_success(f"FLASK_SECRET_KEY is set ({len(secret_key)} characters)")

    # Check if key is the default/example key
    if 'example' in secret_key.lower() or 'change' in secret_key.lower() or secret_key == 'your-super-secret-random-key-here-change-this':
        print_error("FLASK_SECRET_KEY appears to be a placeholder/example value!")
        print_info("  Generate a real key: python -c \"import secrets; print(secrets.token_hex(32))\"")
        return False

    return True

def check_ngrok_url(env_vars):
    """Check ngrok URL configuration"""
    ngrok_url = env_vars.get('NGROK_URL') or os.environ.get('NGROK_URL')

    if not ngrok_url:
        print_warning("NGROK_URL is not set (will use random URL)")
        print_info("  To set a custom URL: echo 'NGROK_URL=your-subdomain.ngrok-free.app' >> .env")
        return True  # Not an error, just a warning

    # Validate URL format
    if not ngrok_url.endswith('.ngrok-free.app') and not ngrok_url.endswith('.ngrok.app') and not ngrok_url.endswith('.ngrok.io'):
        print_warning(f"NGROK_URL format might be incorrect: {ngrok_url}")
        print_info("  Expected format: your-subdomain.ngrok-free.app")
    else:
        print_success(f"NGROK_URL is set: {ngrok_url}")

    return True

def check_optional_config(env_vars):
    """Check optional configuration"""
    optional_vars = {
        'FLASK_ENV': 'Application environment',
        'FLASK_DEBUG': 'Debug mode',
        'USE_GPU': 'GPU acceleration',
        'DATABASE_PATH': 'Database location',
    }

    print()
    print(f"{BOLD}Optional Configuration:{RESET}")

    for var, description in optional_vars.items():
        value = env_vars.get(var) or os.environ.get(var)
        if value:
            print_info(f"{var}: {value} ({description})")
        else:
            print(f"  {var}: Not set (using default)")

def check_gitignore():
    """Verify .env is in .gitignore"""
    gitignore_path = Path('.gitignore')
    if not gitignore_path.exists():
        print_warning(".gitignore file not found")
        return False

    with open('.gitignore', 'r') as f:
        content = f.read()
        if '.env' in content or '*.env' in content:
            print_success(".env is in .gitignore")
            return True
        else:
            print_error(".env is NOT in .gitignore!")
            print_info("  Add this line to .gitignore: .env")
            return False

def main():
    """Main verification function"""
    print_header("StemTube Security Configuration Check")

    print(f"{BOLD}Checking required configuration...{RESET}\n")

    errors = 0
    warnings = 0

    # Check .env file exists
    if not check_env_file():
        errors += 1
        print_header("Configuration Check Failed")
        print_error(f"Found {errors} error(s)")
        print()
        print("Please create and configure .env file before starting the application.")
        print("See SECURITY_NOTICE.md for setup instructions.")
        return 1

    # Load .env file
    env_vars = load_env_file()
    if env_vars is None:
        errors += 1
    else:
        print_success(f"Loaded {len(env_vars)} variable(s) from .env")

    print()

    # Check required variables
    if not check_flask_secret_key(env_vars):
        errors += 1

    if not check_ngrok_url(env_vars):
        warnings += 1

    print()

    # Check gitignore
    if not check_gitignore():
        warnings += 1

    # Check optional configuration
    check_optional_config(env_vars)

    # Summary
    print_header("Configuration Check Summary")

    if errors > 0:
        print_error(f"Found {errors} error(s) - Application will NOT start")
        print()
        print("Please fix the errors above before starting StemTube.")
        print("See SECURITY_NOTICE.md for detailed setup instructions.")
        return 1

    if warnings > 0:
        print_warning(f"Found {warnings} warning(s) - Application can start but review recommended")

    print_success("All required configuration is present!")
    print()
    print(f"{GREEN}✓ Ready to start StemTube{RESET}")
    print()
    print_info("Start the application:")
    print("  python app.py")
    print("  OR")
    print("  ./utils/deployment/start_service.sh")

    return 0

if __name__ == '__main__':
    sys.exit(main())
