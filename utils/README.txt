================================================================================
                    STEMTUBE UTILITY SCRIPTS DIRECTORY
================================================================================

This directory contains development, testing, and maintenance utilities for
StemTube Web. These scripts are NOT part of the core application runtime and
are used for administrative tasks, testing, and development purposes.

================================================================================
                              DIRECTORY STRUCTURE
================================================================================

utils/
├── database/          Database management and maintenance scripts
├── testing/           Testing and debugging scripts
├── analysis/          Audio reanalysis utilities
├── deployment/        Production deployment scripts
├── setup/            Installation and setup utilities
└── README.txt        This file

================================================================================
                          DATABASE MANAGEMENT SCRIPTS
                              (utils/database/)
================================================================================

These scripts help manage the SQLite database, clean up orphaned records, and
perform maintenance tasks.

--------------------------------------------------------------------------------
SCHEMA MIGRATION SCRIPTS
--------------------------------------------------------------------------------

add_lyrics_column.py
  PURPOSE: Add lyrics_data column to database tables
  USAGE: python utils/database/add_lyrics_column.py
  WHEN: Run once when upgrading to version with lyrics support
  WARNING: Backs up database before migration

add_structure_column.py
  PURPOSE: Add structure_data column to database tables
  USAGE: python utils/database/add_structure_column.py
  WHEN: Run once when upgrading to version with structure analysis
  WARNING: Backs up database before migration

--------------------------------------------------------------------------------
DATABASE CLEANUP & MAINTENANCE
--------------------------------------------------------------------------------

clear_database.py
  PURPOSE: COMPLETELY RESET database (deletes all downloads/extractions)
  USAGE: python utils/database/clear_database.py
  WHEN: Starting fresh during development or testing
  WARNING: DESTRUCTIVE - Deletes all user data, downloads, and extractions
  NOTE: Keep database schema intact, only clears records

cleanup_database_paths.py
  PURPOSE: Fix incorrect file paths in database records
  USAGE: python utils/database/cleanup_database_paths.py
  WHEN: After moving files or fixing path issues
  EFFECT: Updates database paths to match actual file locations

cleanup_downloads.py
  PURPOSE: Clean up orphaned download records and files
  USAGE: python utils/database/cleanup_downloads.py
  WHEN: Database and filesystem are out of sync
  EFFECT: Removes records with missing files, optionally deletes orphaned files

cleanup_orphaned_files.py
  PURPOSE: Find and delete files without database records
  USAGE: python utils/database/cleanup_orphaned_files.py
  WHEN: Files exist on disk but not in database
  EFFECT: Scans downloads/ directory and removes orphaned files

fix_missing_extractions.py
  PURPOSE: Fix database records for extractions that exist on disk
  USAGE: python utils/database/fix_missing_extractions.py
  WHEN: Stem files exist but extraction records are missing/incomplete
  EFFECT: Scans filesystem and updates database to match reality

--------------------------------------------------------------------------------
DATABASE INSPECTION & DEBUGGING
--------------------------------------------------------------------------------

debug_db.py
  PURPOSE: Inspect database state and view records
  USAGE: python utils/database/debug_db.py
  WHEN: Need to view current downloads, extractions, users
  OUTPUT: Prints table contents to console

debug_db_complete.py
  PURPOSE: Comprehensive database inspection with detailed info
  USAGE: python utils/database/debug_db_complete.py
  WHEN: Deep debugging of database state
  OUTPUT: Full dump of all tables with relationships

================================================================================
                          TESTING & DEBUGGING SCRIPTS
                              (utils/testing/)
================================================================================

These scripts test specific components and help debug issues.

--------------------------------------------------------------------------------
COMPONENT TESTING
--------------------------------------------------------------------------------

test_aiotube_debug.py
  PURPOSE: Test YouTube API integration (aiotube library)
  USAGE: python utils/testing/test_aiotube_debug.py
  TESTS: Video search, metadata extraction, URL resolution
  OUTPUT: Prints search results and video metadata

test_logging_system.py
  PURPOSE: Test application logging system
  USAGE: python utils/testing/test_logging_system.py
  TESTS: File logging, console output, log rotation
  OUTPUT: Writes test messages to logs

test_lyrics_cpu.py
  PURPOSE: Test lyrics transcription with faster-whisper (CPU mode)
  USAGE: python utils/testing/test_lyrics_cpu.py <audio_file>
  EXAMPLE: python utils/testing/test_lyrics_cpu.py core/downloads/Song/audio/song.mp3
  TESTS: CPU-based transcription (no GPU required)
  OUTPUT: Prints detected lyrics with timestamps

test_madmom_tempo_key.py
  PURPOSE: Test madmom library for BPM and key detection
  USAGE: python utils/testing/test_madmom_tempo_key.py <audio_file>
  EXAMPLE: python utils/testing/test_madmom_tempo_key.py core/downloads/Song/audio/song.mp3
  TESTS: Beat tracking, tempo detection, key detection
  OUTPUT: Prints BPM and musical key

test_removal_fix.py
  PURPOSE: Test user access removal logic
  USAGE: python utils/testing/test_removal_fix.py
  TESTS: Download/extraction access removal, database updates
  OUTPUT: Test results for removal operations

--------------------------------------------------------------------------------
DEBUGGING SPECIFIC ISSUES
--------------------------------------------------------------------------------

debug_stems_loading.py
  PURPOSE: Debug stem file loading in mixer
  USAGE: python utils/testing/debug_stems_loading.py
  WHEN: Stems not loading in mixer interface
  OUTPUT: Prints stem file paths and availability

debug_deep_purple.py
  PURPOSE: Debug specific song analysis (template for debugging)
  USAGE: python utils/testing/debug_deep_purple.py
  WHEN: Troubleshooting analysis on specific track
  NOTE: Can be modified to debug any specific video_id
  OUTPUT: Full analysis results for the song

================================================================================
                          AUDIO REANALYSIS UTILITIES
                              (utils/analysis/)
================================================================================

These scripts re-run audio analysis on existing downloads. Useful after:
- Upgrading analysis algorithms
- Adding new features (chords, structure, lyrics)
- Fixing bugs in analysis code

--------------------------------------------------------------------------------
BULK REANALYSIS
--------------------------------------------------------------------------------

reanalyze_all_chords.py
  PURPOSE: Re-run chord detection on ALL downloads
  USAGE: python utils/analysis/reanalyze_all_chords.py
  WHEN: Chord detection algorithm improved
  EFFECT: Updates chords_data in database for all tracks
  TIME: ~30-60 seconds per song with madmom
  NOTE: Shows progress and skips songs with existing chords (use --force to override)

reanalyze_all_structure.py
  PURPOSE: Re-run structure analysis on ALL downloads
  USAGE: python utils/analysis/reanalyze_all_structure.py
  WHEN: Structure detection algorithm improved
  EFFECT: Updates structure_data in database for all tracks
  TIME: ~5-10 seconds per song

reanalyze_all_structure_advanced.py
  PURPOSE: Re-run advanced structure analysis (LLM-based)
  USAGE: python utils/analysis/reanalyze_all_structure_advanced.py
  WHEN: Using LLM structure analyzer instead of basic detector
  EFFECT: Updates structure_data with LLM-detected sections
  NOTE: Requires LLM API access if enabled

--------------------------------------------------------------------------------
SINGLE SONG REANALYSIS
--------------------------------------------------------------------------------

reanalyze_neil_young.py
  PURPOSE: Re-analyze specific song (template script)
  USAGE: python utils/analysis/reanalyze_neil_young.py
  WHEN: Testing analysis on known track
  NOTE: Edit video_id in script to analyze different song
  OUTPUT: Prints updated analysis results

reanalyze_with_madmom.py
  PURPOSE: Re-run chord detection with madmom on specific song
  USAGE: python utils/analysis/reanalyze_with_madmom.py
  WHEN: Testing madmom chord detector improvements
  NOTE: Edit video_id in script to analyze different song
  OUTPUT: Prints detected chords with timestamps

================================================================================
                          DEPLOYMENT SCRIPTS
                              (utils/deployment/)
================================================================================

These scripts manage production deployments and systemd services.

--------------------------------------------------------------------------------
SERVICE MANAGEMENT
--------------------------------------------------------------------------------

start.sh
  PURPOSE: Simple development server start
  USAGE: ./utils/deployment/start.sh
  WHEN: Local development
  EFFECT: Runs `python app.py` directly

start_service.sh
  PURPOSE: Start StemTube as systemd service
  USAGE: ./utils/deployment/start_service.sh
  WHEN: Production deployment
  EFFECT: Starts stemtube.service, enables auto-restart
  REQUIRES: stemtube.service installed in /etc/systemd/system/

stop_service.sh
  PURPOSE: Stop StemTube systemd service
  USAGE: ./utils/deployment/stop_service.sh
  WHEN: Stopping production server
  EFFECT: Gracefully stops stemtube.service

stemtube.service
  PURPOSE: systemd service unit file
  USAGE: sudo cp utils/deployment/stemtube.service /etc/systemd/system/
         sudo systemctl daemon-reload
         sudo systemctl enable stemtube
         sudo systemctl start stemtube
  WHEN: Production deployment on Linux with systemd
  EFFECT: Runs StemTube as system service with auto-restart

--------------------------------------------------------------------------------
MIGRATION SCRIPTS
--------------------------------------------------------------------------------

migrate_from_old_prod.sh
  PURPOSE: Migrate data from old production instance
  USAGE: ./utils/deployment/migrate_from_old_prod.sh
  WHEN: Upgrading from previous version
  EFFECT: Copies database, downloads, and config from old location
  WARNING: Review script before running, may need path adjustments

verify_migration.sh
  PURPOSE: Verify migration completed successfully
  USAGE: ./utils/deployment/verify_migration.sh
  WHEN: After running migrate_from_old_prod.sh
  EFFECT: Checks file counts, database integrity, config validity
  OUTPUT: Prints verification results

================================================================================
                          SETUP & INSTALLATION UTILITIES
                              (utils/setup/)
================================================================================

These scripts help with library installation and configuration.

--------------------------------------------------------------------------------
LIBRARY FIXES
--------------------------------------------------------------------------------

patch_madmom.py
  PURPOSE: Fix numpy compatibility in madmom library
  USAGE: python patch_madmom.py
         OR: python utils/setup/patch_madmom.py (same file, convenience copy)
  WHEN: After installing madmom for the first time
        After upgrading numpy to 1.20+
  EFFECT: Patches madmom to use np.float64 instead of deprecated np.float
  REQUIREMENT: Run BEFORE using chord detection features
  NOTE: Also available in root directory for convenience
  OUTPUT: Prints number of files patched

rebuild_madmom.sh
  PURPOSE: Completely reinstall madmom library
  USAGE: ./utils/setup/rebuild_madmom.sh
  WHEN: Madmom installation is corrupted or build failed
  EFFECT: Uninstalls madmom, reinstalls with Cython dependencies
  REQUIRES: Virtual environment activated (venv/)
  OUTPUT: Prints installation progress

================================================================================
                          FREQUENTLY USED UTILITIES
================================================================================

Some utilities are kept in BOTH the root directory AND utils/ for convenience:

ROOT DIRECTORY (for easy access):
  - patch_madmom.py          Fix numpy compatibility (run after madmom install)
  - reset_admin_password.py  Reset admin password (important admin tool)
  - setup_dependencies.py    Main installation script (primary setup)

UTILS DIRECTORY (organized storage):
  - utils/setup/patch_madmom.py         Same as root version
  - utils/database/clear_database.py    Reset database for testing

TIP: You can run scripts from either location. The root copies are for
     convenience during initial setup and common admin tasks.

================================================================================
                          COMMON WORKFLOWS
================================================================================

INITIAL SETUP:
  1. python setup_dependencies.py           # Install all dependencies
  2. python patch_madmom.py                  # Fix madmom compatibility
  3. python app.py                           # Start application

TESTING NEW ANALYSIS ALGORITHM:
  1. python utils/testing/test_madmom_tempo_key.py <audio_file>
  2. python utils/analysis/reanalyze_neil_young.py
  3. python utils/analysis/reanalyze_all_chords.py

DATABASE CLEANUP:
  1. python utils/database/debug_db.py              # Check current state
  2. python utils/database/cleanup_downloads.py     # Remove orphans
  3. python utils/database/cleanup_orphaned_files.py # Delete files

PRODUCTION DEPLOYMENT:
  1. sudo cp utils/deployment/stemtube.service /etc/systemd/system/
  2. sudo systemctl daemon-reload
  3. ./utils/deployment/start_service.sh

MIGRATION FROM OLD VERSION:
  1. ./utils/deployment/migrate_from_old_prod.sh
  2. ./utils/deployment/verify_migration.sh
  3. python utils/database/add_lyrics_column.py      # If needed
  4. python utils/database/add_structure_column.py   # If needed

RECOVERING FROM ISSUES:
  - Database corrupted: python utils/database/clear_database.py
  - Missing extractions: python utils/database/fix_missing_extractions.py
  - Orphaned files: python utils/database/cleanup_orphaned_files.py
  - Admin locked out: python reset_admin_password.py

================================================================================
                          IMPORTANT NOTES
================================================================================

VIRTUAL ENVIRONMENT:
  - Most scripts require the virtual environment to be activated
  - Run: source venv/bin/activate (Linux/Mac) or venv\Scripts\activate (Windows)
  - Exception: setup_dependencies.py creates venv automatically

DATABASE BACKUPS:
  - Many database scripts create automatic backups before modification
  - Backups are named: stemtubes.db.backup-YYYYMMDD-HHMMSS
  - Keep recent backups in case of issues

DESTRUCTIVE OPERATIONS:
  - Scripts marked with WARNING are destructive and cannot be undone
  - Always backup stemtubes.db before running cleanup scripts
  - Use utils/database/debug_db.py to inspect state before cleanup

FILE LOCATIONS:
  - Working directory: <project_root> (where app.py is located)
  - Database: stemtubes.db (root directory)
  - Downloads: core/downloads/
  - Logs: logs/ or app.log (root directory)

TESTING vs PRODUCTION:
  - Testing scripts are safe and read-only
  - Database cleanup scripts can modify/delete data
  - Deployment scripts are for production servers only

================================================================================
                          GETTING HELP
================================================================================

For more information:
  - Main documentation: CLAUDE.md (root directory)
  - Installation guide: install.md (root directory)
  - Specific topics: docs/ directory (additional documentation)

For issues or bugs:
  - Check logs in logs/ directory
  - Run debug scripts to inspect state
  - Review CLAUDE.md for troubleshooting section

================================================================================
                          SCRIPT SAFETY LEVELS
================================================================================

SAFE (Read-only, no modifications):
  ✓ debug_db.py
  ✓ debug_db_complete.py
  ✓ All test_*.py scripts
  ✓ debug_stems_loading.py
  ✓ verify_migration.sh

MODERATE (Modifies database but backs up first):
  ⚠ add_lyrics_column.py
  ⚠ add_structure_column.py
  ⚠ cleanup_database_paths.py
  ⚠ fix_missing_extractions.py
  ⚠ All reanalyze_*.py scripts

DESTRUCTIVE (Can delete data, use with caution):
  ⛔ clear_database.py
  ⛔ cleanup_downloads.py (with --delete flag)
  ⛔ cleanup_orphaned_files.py
  ⛔ migrate_from_old_prod.sh (overwrites data)

================================================================================
                          VERSION INFORMATION
================================================================================

Last Updated: November 3, 2025
Compatible with: StemTube Web v2.0+
Directory Structure Version: 1.0

================================================================================
