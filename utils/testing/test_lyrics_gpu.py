#!/usr/bin/env python
"""Quick sanity check for faster-whisper on GPU."""
import sys
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

from core.lyrics_detector import LyricsDetector

def test_lyrics_gpu(audio_path, model_size='large-v3'):
    if not Path(audio_path).exists():
        print(f"❌ File not found: {audio_path}")
        return None

    print("🎤 Testing lyrics detection (GPU mode)")
    print(f"   Audio: {Path(audio_path).name}")
    print(f"   Model: {model_size}")
    print()

    detector = LyricsDetector(
        model_size=model_size,
        device='cuda',
        compute_type='float16'
    )

    lyrics = detector.detect_lyrics(
        audio_path,
        language=None,
        word_timestamps=True
    )

    if not lyrics:
        print("❌ Failed to detect lyrics")
        return None

    print("✅ GPU detection successful!")
    print(f"   Segments: {len(lyrics)}\n")

    for i, seg in enumerate(lyrics[:5], 1):
        start_min = int(seg['start'] // 60)
        start_sec = int(seg['start'] % 60)
        end_min = int(seg['end'] // 60)
        end_sec = int(seg['end'] % 60)
        print(f"[{i}] {start_min:02d}:{start_sec:02d} - {end_min:02d}:{end_sec:02d}")
        print(f"    {seg['text'][:60]}{'...' if len(seg['text']) > 60 else ''}")
        if 'words' in seg:
            print(f"    ({len(seg['words'])} words)")
        print()

    output_file = Path(audio_path).with_suffix('.lyrics.gpu.json')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(lyrics, f, ensure_ascii=False, indent=2)
    print(f"💾 Saved to: {output_file}")
    return lyrics

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_lyrics_gpu.py <audio_file> [model_size]")
        sys.exit(1)
    audio_file = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else 'large-v3'
    test_lyrics_gpu(audio_file, model_size)
