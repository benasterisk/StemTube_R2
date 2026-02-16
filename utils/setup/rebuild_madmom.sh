#!/bin/bash
# Rebuild madmom from source with numpy compatibility fixes

set -e

echo "=================================================="
echo "REBUILDING MADMOM FROM SOURCE"
echo "=================================================="

# Clean up
echo "Cleaning up old files..."
rm -rf /tmp/madmom-build
mkdir -p /tmp/madmom-build
cd /tmp/madmom-build

# Clone source
echo "Cloning madmom source..."
git clone --depth 1 https://github.com/CPJKU/madmom.git
cd madmom

# Patch all Python and Cython files
echo "Patching source files for numpy 1.20+ compatibility..."
find . -type f \( -name "*.py" -o -name "*.pyx" \) -exec sed -i \
    -e 's/\bnp\.float\b/np.float64/g' \
    -e 's/\bnp\.int\b/np.int64/g' \
    -e 's/\bnp\.complex\b/np.complex128/g' \
    -e 's/\bnp\.bool\b/np.bool_/g' \
    {} +

echo "Patched files:"
git diff --name-only | head -20

# Uninstall existing madmom
echo "Uninstalling existing madmom..."
/opt/stemtube/StemTube-dev/venv/bin/pip uninstall -y madmom || true

# Install from patched source
echo "Installing patched madmom..."
/opt/stemtube/StemTube-dev/venv/bin/pip install --no-build-isolation .

echo "=================================================="
echo "✅ MADMOM REBUILD COMPLETE"
echo "=================================================="

# Test import
echo "Testing import..."
/opt/stemtube/StemTube-dev/venv/bin/python -c "
from madmom.features.beats import RNNBeatProcessor, DBNBeatTrackingProcessor
print('✓ Import successful!')
"

echo "✅ All done!"
