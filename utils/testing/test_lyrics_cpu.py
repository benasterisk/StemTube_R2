#!/usr/bin/env python
"""
Test lyrics detection without GPU
"""
import sys
import json
import logging
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)

from core.lyrics_detector import LyricsDetector

def test_lyrics_cpu(audio_path, model_size='base'):
    """Test lyrics detection using CPU only"""

    if not Path(audio_path).exists():
        print(f"❌ File not found: {audio_path}")
        return None

    print(f"🎤 Testing lyrics detection (CPU mode)")
    print(f"   Audio: {Path(audio_path).name}")
    print(f"   Model: {model_size}")
    print()

    # Initialize detector with CPU
    detector = LyricsDetector(
        model_size=model_size,
        device='cpu',
        compute_type='int8'
    )

    # Detect lyrics
    lyrics = detector.detect_lyrics(
        audio_path,
        language=None,  # Auto-detect
        word_timestamps=True
    )

    if not lyrics:
        print("❌ Failed to detect lyrics")
        return None

    # Display results
    print(f"✅ Detection successful!")
    print(f"   Segments: {len(lyrics)}")
    print()

    # Show first 5 segments
    print("First 5 segments:")
    print("=" * 70)
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

    # Save to JSON
    output_file = Path(audio_path).with_suffix('.lyrics.json')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(lyrics, f, ensure_ascii=False, indent=2)

    print(f"💾 Saved to: {output_file}")

    return lyrics


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_lyrics_cpu.py <audio_file> [model_size]")
        print()
        print("Examples:")
        print("  python test_lyrics_cpu.py song.mp3")
        print("  python test_lyrics_cpu.py song.mp3 base")
        print("  python test_lyrics_cpu.py song.mp3 medium")
        print()
        print("Available models: tiny, base, small, medium, large-v3, large-v3-int8")
        sys.exit(1)

    audio_file = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else 'base'

    test_lyrics_cpu(audio_file, model_size)
