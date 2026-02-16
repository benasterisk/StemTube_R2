# StemTube Utilities Quick Reference

## 📁 Organized Structure

All development, testing, and maintenance scripts have been organized into the `utils/` directory:

```
utils/
├── database/      # Database management and cleanup
├── testing/       # Testing and debugging scripts
├── analysis/      # Audio reanalysis utilities
├── deployment/    # Production deployment scripts
├── setup/         # Installation and setup utilities
└── README.txt     # Comprehensive guide to all utilities
```

Documentation files moved to `docs/`:
```
docs/
├── MADMOM_SETUP.md
├── FASTER_WHISPER_SETUP.md
├── MIGRATION_GUIDE.md
├── SERVICE_COMMANDS.md
└── ... (and more)
```

## 🚀 Quick Access

**Essential utilities kept in root directory:**
- `setup_dependencies.py` - Install all dependencies
- `patch_madmom.py` - Fix madmom numpy compatibility
- `check_config.py` - Verify security configuration (NEW)
- `reset_admin_password.py` - Reset admin password
- `app.py` - Main application

## 📖 Finding the Right Tool

### Database Tasks
```bash
# View database contents
python utils/database/debug_db.py

# Clean up orphaned files
python utils/database/cleanup_orphaned_files.py

# Reset database (DESTRUCTIVE!)
python utils/database/clear_database.py
```

### Testing
```bash
# Test YouTube integration
python utils/testing/test_aiotube_debug.py

# Test lyrics transcription
python utils/testing/test_lyrics_cpu.py <audio_file>

# Test chord detection
python utils/testing/test_madmom_tempo_key.py <audio_file>
```

### Reanalysis
```bash
# Re-run chord detection on all songs
python utils/analysis/reanalyze_all_chords.py

# Re-run structure analysis on all songs
python utils/analysis/reanalyze_all_structure.py
```

### Deployment
```bash
# Start as systemd service
./utils/deployment/start_service.sh

# Stop service
./utils/deployment/stop_service.sh
```

## 📚 Complete Documentation

**For detailed information on every utility, see:**
- **`utils/README.txt`** - Comprehensive guide with usage examples
- **`CLAUDE.md`** - Main project documentation
- **`docs/`** - Additional setup and migration guides

## 🔍 Common Workflows

### Initial Setup
```bash
# 1. Install dependencies
python setup_dependencies.py

# 2. Configure security (MANDATORY)
cp .env.example .env
python -c "import secrets; print('FLASK_SECRET_KEY=' + secrets.token_hex(32))" >> .env
chmod 600 .env

# 3. Verify configuration
python check_config.py

# 4. Fix madmom compatibility
python patch_madmom.py

# 5. Start application
python app.py
```

**⚠️ Note:** The application will refuse to start without .env configuration. See [SECURITY_NOTICE.md](SECURITY_NOTICE.md) for details.

### Database Cleanup
```bash
python utils/database/debug_db.py              # Check state
python utils/database/cleanup_downloads.py     # Remove orphans
python utils/database/cleanup_orphaned_files.py # Delete files
```

### Testing Analysis Features
```bash
python utils/testing/test_madmom_tempo_key.py song.mp3
python utils/analysis/reanalyze_neil_young.py
```

---

**💡 Tip:** The `utils/README.txt` file contains exhaustive documentation for every script, including:
- What each script does
- When to use it
- Safety warnings
- Example usage
- Common workflows
