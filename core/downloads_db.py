"""
Persistent per-user library (table: user_downloads)

Backwards-compatible re-export — all public functions are now in core.db submodules.
Import from here or from core.db directly.
"""
# Re-export everything for backwards compatibility
from core.db import *  # noqa: F401, F403
