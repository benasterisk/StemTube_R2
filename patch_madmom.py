#!/usr/bin/env python3
"""
Patch madmom library for numpy 1.20+ and Python 3.10+ compatibility.
Replaces deprecated np.float/np.int/np.complex/np.bool aliases and the
pre-3.10 'from collections import MutableSequence' import.

Run with the venv's Python interpreter (setup_dependencies.py does this):
the madmom location is derived from the running interpreter, which works
on both Linux (venv/lib/python3.x/site-packages) and Windows
(venv\\Lib\\site-packages) layouts.
"""
import os
import re
import sys
import sysconfig


def patch_file(filepath):
    """Patch a single file for numpy and collections compatibility."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        original = content

        # Replace np.float (but not np.float32, np.float64, etc.)
        content = re.sub(r'\bnp\.float\b(?!\d)', 'np.float64', content)

        # Replace np.int (but not np.int32, np.int64, etc.)
        content = re.sub(r'\bnp\.int\b(?!\d)', 'np.int64', content)

        # Replace np.complex (but not np.complex64, np.complex128, etc.)
        content = re.sub(r'\bnp\.complex\b(?!\d)', 'np.complex128', content)

        # Replace np.bool (but not np.bool_, etc.)
        content = re.sub(r'\bnp\.bool\b(?!_)', 'np.bool_', content)

        # Fix collections.MutableSequence -> collections.abc.MutableSequence (Python 3.10+)
        content = re.sub(r'from collections import (.*?)MutableSequence',
                        r'from collections.abc import \1MutableSequence', content)

        if content != original:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"Error patching {filepath}: {e}")
        return False


def find_madmom_path():
    """Locate the madmom package for the interpreter running this script."""
    # Primary: ask the running interpreter where site-packages is.
    # Handles both POSIX (venv/lib/python3.x/site-packages) and Windows
    # (venv\Lib\site-packages) venv layouts.
    candidates = []
    purelib = sysconfig.get_paths().get('purelib')
    if purelib:
        candidates.append(os.path.join(purelib, 'madmom'))

    # Fallback: glob the repo-local venv with both layouts, in case the
    # script is run with a system Python instead of the venv one.
    import glob
    venv_path = os.path.join(os.path.dirname(__file__), 'venv')
    for pattern in (
        os.path.join(venv_path, 'lib', 'python3.*', 'site-packages'),
        os.path.join(venv_path, 'Lib', 'site-packages'),
    ):
        for lib_dir in glob.glob(pattern):
            candidates.append(os.path.join(lib_dir, 'madmom'))

    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    return None


def main():
    """Find and patch all madmom Python files."""
    madmom_path = find_madmom_path()

    if not madmom_path:
        print("[ERROR] Madmom not found (checked the running interpreter's "
              "site-packages and the repo-local venv)")
        sys.exit(1)

    print(f"Patching madmom at {madmom_path}...")

    patched_count = 0
    for root, dirs, files in os.walk(madmom_path):
        for filename in files:
            if filename.endswith('.py'):
                filepath = os.path.join(root, filename)
                if patch_file(filepath):
                    rel_path = os.path.relpath(filepath, madmom_path)
                    print(f"  [PATCHED] {rel_path}")
                    patched_count += 1

    print(f"\n[OK] Patched {patched_count} files")

    # Test import
    print("\nTesting madmom import...")
    try:
        import madmom
        print("[OK] Madmom imports successfully!")
        return 0
    except Exception as e:
        print(f"[ERROR] Import failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
