#!/usr/bin/env python3
"""
Test madmom's tempo and key detection capabilities
"""

import sys
import numpy as np

# Monkey-patch numpy for madmom compatibility
if not hasattr(np, 'int'):
    np.int = np.int64
if not hasattr(np, 'float'):
    np.float = np.float64
if not hasattr(np, 'bool'):
    np.bool = np.bool_

import madmom
import madmom.features.tempo as tempo_features
import madmom.features.key as key_features
import madmom.features.beats as beats_features


def test_tempo_detection(audio_file):
    """Test madmom tempo detection"""
    print("=" * 70)
    print("MADMOM TEMPO DETECTION TEST")
    print("=" * 70)

    print(f"\n🎵 Analyzing: {audio_file}")

    # Create tempo processor
    print("\n📊 Initializing tempo processor...")
    proc = tempo_features.TempoEstimationProcessor(fps=100)

    # Create activation function processor
    print("📊 Computing beat activations...")
    act_proc = beats_features.RNNBeatProcessor()
    activations = act_proc(audio_file)

    # Estimate tempo
    print("📊 Estimating tempo...")
    tempo_result = proc(activations)

    print(f"\n   Raw result: {tempo_result}")
    print(f"   Result type: {type(tempo_result)}")
    print(f"   Result shape: {tempo_result.shape if hasattr(tempo_result, 'shape') else 'N/A'}")

    # Extract BPM value (madmom returns array with [BPM, confidence] pairs)
    if isinstance(tempo_result, np.ndarray) and tempo_result.ndim == 2:
        # Result is matrix with shape (N, 2) where each row is [BPM, confidence]
        bpm = float(tempo_result[0, 0])  # First row, first column
        confidence = float(tempo_result[0, 1])  # First row, second column
        print(f"\n✅ DETECTED TEMPO: {bpm:.1f} BPM (confidence: {confidence:.1%})")

        # Show alternative tempos if available
        if len(tempo_result) > 1:
            print("   Alternative tempos:")
            for i in range(1, min(3, len(tempo_result))):
                alt_bpm = float(tempo_result[i, 0])
                alt_conf = float(tempo_result[i, 1])
                print(f"     - {alt_bpm:.1f} BPM (confidence: {alt_conf:.1%})")
    else:
        bpm = float(tempo_result)
        print(f"\n✅ DETECTED TEMPO: {bpm:.1f} BPM")

    return bpm


def test_key_detection(audio_file):
    """Test madmom key detection"""
    print("\n" + "=" * 70)
    print("MADMOM KEY DETECTION TEST")
    print("=" * 70)

    print(f"\n🎹 Analyzing: {audio_file}")

    # Create key recognition processor
    print("\n📊 Initializing CNN key recognition processor...")
    proc = key_features.CNNKeyRecognitionProcessor()

    # Detect key
    print("📊 Detecting key with CNN...")
    key_result = proc(audio_file)

    print(f"\n   Raw result: {key_result}")
    print(f"   Result type: {type(key_result)}")
    print(f"   Result shape: {key_result.shape if hasattr(key_result, 'shape') else 'N/A'}")

    # Madmom returns array of probabilities for 24 keys (12 major + 12 minor)
    # Order: C major, C minor, C# major, C# minor, D major, D minor, ...
    key_names = [
        'C major', 'C minor', 'C# major', 'C# minor', 'D major', 'D minor',
        'D# major', 'D# minor', 'E major', 'E minor', 'F major', 'F minor',
        'F# major', 'F# minor', 'G major', 'G minor', 'G# major', 'G# minor',
        'A major', 'A minor', 'A# major', 'A# minor', 'B major', 'B minor'
    ]

    if isinstance(key_result, np.ndarray):
        # Flatten if needed
        probs = key_result.flatten()

        # Find most probable key
        max_idx = np.argmax(probs)
        max_prob = probs[max_idx]
        detected_key = key_names[max_idx]

        print(f"\n✅ DETECTED KEY: {detected_key} (confidence: {max_prob:.1%})")

        # Show top 3 alternatives
        top_indices = np.argsort(probs)[-3:][::-1]
        print("   Alternative keys:")
        for idx in top_indices[1:]:
            print(f"     - {key_names[idx]} (confidence: {probs[idx]:.1%})")
    else:
        detected_key = str(key_result)
        print(f"\n✅ DETECTED KEY: {detected_key}")

    return detected_key


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_madmom_tempo_key.py <audio_file>")
        sys.exit(1)

    audio_file = sys.argv[1]

    try:
        # Test tempo
        bpm = test_tempo_detection(audio_file)

        # Test key
        key = test_key_detection(audio_file)

        print("\n" + "=" * 70)
        print("SUMMARY")
        print("=" * 70)
        print(f"BPM: {bpm:.1f}")
        print(f"Key: {key}")
        print("=" * 70)

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
