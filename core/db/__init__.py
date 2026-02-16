"""
Database access layer for StemTube.

Submodules:
    connection  – DB path constants, _conn(), path resolution helpers
    schema      – Table creation and migrations
    downloads   – Global/user download CRUD
    extractions – Extraction tracking and status
    admin       – Admin-facing queries and bulk operations
    cleanup     – Startup integrity checks
    user_views  – Per-user view management (remove from list)
"""

from core.db.connection import (
    DB_PATH, APP_ROOT, DOWNLOADS_ROOT,
    _conn, resolve_file_path, _resolve_paths_in_record,
)
from core.db.schema import init_table
from core.db.downloads import (
    add_or_update, update_download_analysis, update_download_lyrics,
    update_download_structure, find_global_download, add_user_access,
    list_for, get_download_by_id, get_user_download_id_by_video_id,
    delete_from,
)
from core.db.extractions import (
    find_global_extraction, find_any_global_extraction,
    find_or_reserve_extraction, find_global_extraction_in_progress,
    set_extraction_in_progress, clear_extraction_in_progress,
    mark_extraction_complete, add_user_extraction_access,
    set_user_extraction_in_progress, list_extractions_for,
)
from core.db.admin import (
    get_all_downloads_for_admin, get_user_ids_for_video,
    delete_download_completely, reset_extraction_status,
    reset_extraction_status_by_video_id, get_storage_usage_stats,
)
from core.db.cleanup import (
    cleanup_stuck_extractions, cleanup_duplicate_user_downloads,
    cleanup_orphaned_records, comprehensive_cleanup,
)
from core.db.user_views import (
    clear_user_session_data, force_remove_all_user_access,
    remove_user_download_access, remove_user_extraction_access,
)
