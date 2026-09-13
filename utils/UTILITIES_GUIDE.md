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
├── setup-guides/MADMOM-SETUP.md
├── setup-guides/FASTER-WHISPER-SETUP.md
├── admin-guides/SERVICE_COMMANDS.md
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

# Test madmom tempo/key/beat detection (madmom is not used for chords)
python utils/testing/test_madmom_tempo_key.py <audio_file>

# Test the MVSep Mega fine-stem pipeline (CUDA GPU required)
python utils/testing/test_mvsep_mega.py <audio_file> [--analyse]
```

### Reanalysis
```bash
# Re-run chord detection (BTC Transformer) on all songs
python utils/analysis/reanalyze_all_chords.py

# Fill in missing madmom beat grids (songs with beat_times = NULL)
python utils/analysis/regenerate_beat_times.py
```

**⚠️ Chord reanalysis side effect:** `reanalyze_all_chords.py` (and `reanalyze_with_madmom.py`) write
`beat_offset = 0` and reset Skip Intro (`music_start_time`) to 0. Despite its name,
`reanalyze_with_madmom.py` runs BTC too - chords are BTC-only and the `use_madmom` flag is ignored.

**❌ Structure reanalysis is non-functional:**
- `utils/analysis/reanalyze_all_structure.py` imports `core/structure_detector.py`, which needs
  `msaf`; msaf cannot be imported with modern SciPy (`from scipy import inf`), so the script fails.
- `utils/analysis/reanalyze_all_structure_advanced.py` imports `core.advanced_structure_detector`,
  a module that no longer exists.

See [STRUCTURE_ANALYSIS_IMPLEMENTATION.md](../docs/feature-guides/STRUCTURE_ANALYSIS_IMPLEMENTATION.md).

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
#    (also creates .env with a generated FLASK_SECRET_KEY, chmod 600)

# 2. Verify configuration
python check_config.py

# 3. Fix madmom compatibility (madmom handles beat/downbeat detection)
python patch_madmom.py

# 4. Start application
python app.py
```

**⚠️ Note:** The application will refuse to start without .env configuration. See [SECURITY_SETUP.md](../docs/admin-guides/SECURITY_SETUP.md) for details.

### Database Cleanup
```bash
python utils/database/debug_db.py              # Check state
python utils/database/cleanup_downloads.py     # Remove orphans
python utils/database/cleanup_orphaned_files.py # Delete files
```

### Testing Analysis Features
```bash
python utils/testing/test_madmom_tempo_key.py song.mp3
python utils/testing/test_lyrics_cpu.py vocals.mp3
```

---

**💡 Tip:** The `utils/README.txt` file contains exhaustive documentation for every script, including:
- What each script does
- When to use it
- Safety warnings
- Example usage
- Common workflows
