#!/usr/bin/env python
"""
Script that executes Demucs with FFmpeg environment correctly configured.
This is called directly by stems_extractor.py.
"""
import os
import sys
import subprocess
import argparse

def main():
    # Configure FFmpeg correctly from arguments
    ffmpeg_path = sys.argv[1]
    ffmpeg_dir = os.path.dirname(ffmpeg_path)

    # Modify the environment for Demucs
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
    os.environ["FFMPEG_PATH"] = ffmpeg_path

    # Execute Demucs with remaining arguments (without the first argument which is the FFmpeg path)
    demucs_args = sys.argv[2:]

    # Print diagnostic information
    print(f"wrap_demucs.py: FFmpeg path = {ffmpeg_path}")
    print(f"wrap_demucs.py: PATH = {os.environ['PATH']}")
    print(f"wrap_demucs.py: Running demucs with args: {demucs_args}")

    # Execute Demucs
    return_code = subprocess.call([sys.executable, "-m", "demucs.separate"] + demucs_args)

    # Return the same exit code
    sys.exit(return_code)

if __name__ == "__main__":
    main()
