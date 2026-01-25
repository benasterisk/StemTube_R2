#!/usr/bin/env python3
"""
Patch madmom library for numpy 1.20+ compatibility.
Replaces deprecated np.float and np.int with np.float64 and np.int64.
"""
import os
import re
import sys

def patch_file(filepath):
    """Patch a single file for numpy and collections compatibility."""
    try:
        with open(filepath, 'r') as f:
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
            with open(filepath, 'w') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"Error patching {filepath}: {e}")
        return False

def main():
    """Find and patch all madmom Python files."""
    # Auto-detect Python version
    import glob
    venv_path = os.path.join(os.path.dirname(__file__), 'venv')
    python_lib_dirs = glob.glob(os.path.join(venv_path, 'lib', 'python3.*'))

    madmom_path = None
    for lib_dir in python_lib_dirs:
        candidate = os.path.join(lib_dir, 'site-packages', 'madmom')
        if os.path.exists(candidate):
            madmom_path = candidate
            break

    if not madmom_path:
        print(f"❌ Madmom not found in {venv_path}")
        sys.exit(1)

    print(f"Patching madmom at {madmom_path}...")

    patched_count = 0
    for root, dirs, files in os.walk(madmom_path):
        for filename in files:
            if filename.endswith('.py'):
                filepath = os.path.join(root, filename)
                if patch_file(filepath):
                    rel_path = os.path.relpath(filepath, madmom_path)
                    print(f"  ✓ Patched {rel_path}")
                    patched_count += 1

    print(f"\n✅ Patched {patched_count} files")

    # Test import
    print("\nTesting madmom import...")
    try:
        import madmom
        print("✅ Madmom imports successfully!")
        return 0
    except Exception as e:
        print(f"❌ Import failed: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
