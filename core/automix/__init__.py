"""Auto remix of separated stems: cleaning, balance and a mixing style."""
from .engine import remix
from .styles import DEFAULT_STYLE, STYLES

__all__ = ["remix", "STYLES", "DEFAULT_STYLE"]
