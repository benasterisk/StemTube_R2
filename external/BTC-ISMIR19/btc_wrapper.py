#!/usr/bin/env python3
"""
BTC Chord Detection Wrapper for Stemtube Integration

Simple Python API for calling BTC chord recognition from external applications.
"""

import os
import sys
import torch
import numpy as np
from pathlib import Path

# Add BTC modules to path
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from btc_model import BTC_model
from utils.hparams import HParams
from utils.mir_eval_modules import audio_file_to_features, idx2voca_chord


class BTCChordDetector:
    """
    Wrapper class for BTC chord detection

    Usage:
        detector = BTCChordDetector()
        chords = detector.detect("song.mp3")

        for start, end, chord in chords:
            print(f"{start:.2f}s - {end:.2f}s: {chord}")
    """

    def __init__(self, model_path=None, use_large_vocab=True, device=None):
        """
        Initialize BTC chord detector

        Args:
            model_path: Path to model file (default: auto-detect)
            use_large_vocab: True for 170 chords, False for 24 chords (default: True)
            device: torch.device or None (default: auto-detect CPU/GPU)
        """
        self.use_large_vocab = use_large_vocab
        self.device = device or torch.device("cpu")

        # Load configuration
        config_path = SCRIPT_DIR / "run_config.yaml"
        self.config = HParams.load(str(config_path))

        # Set vocabulary mode
        if use_large_vocab:
            self.config.feature['large_voca'] = True
            self.config.model['num_chords'] = 170
            default_model = SCRIPT_DIR / "test" / "btc_model_large_voca.pt"
            self.idx_to_chord = idx2voca_chord()
        else:
            self.config.feature['large_voca'] = False
            self.config.model['num_chords'] = 25
            default_model = SCRIPT_DIR / "test" / "btc_model.pt"
            from utils.mir_eval_modules import idx2chord
            self.idx_to_chord = idx2chord

        # Model path
        self.model_path = Path(model_path) if model_path else default_model

        if not self.model_path.exists():
            raise FileNotFoundError(f"Model not found: {self.model_path}")

        # Load model
        self._load_model()

    def _load_model(self):
        """Load BTC model and weights"""
        print(f"Loading BTC model from: {self.model_path}")

        # Initialize model
        self.model = BTC_model(config=self.config.model).to(self.device)

        # Load pre-trained weights
        checkpoint = torch.load(str(self.model_path), weights_only=False, map_location=self.device)
        self.model.load_state_dict(checkpoint['model'])
        self.mean = checkpoint['mean']
        self.std = checkpoint['std']

        # Set to evaluation mode
        self.model.eval()

        vocab_size = 170 if self.use_large_vocab else 24
        print(f"✓ Model loaded: {vocab_size} chord vocabulary")

    def detect(self, audio_path, return_format='tuples'):
        """
        Detect chords in audio file

        Args:
            audio_path: Path to MP3/WAV file
            return_format: 'tuples' or 'dict' or 'lab'

        Returns:
            If 'tuples': [(start, end, chord), ...]
            If 'dict': [{'start': 0.0, 'end': 1.5, 'chord': 'C'}, ...]
            If 'lab': String in .lab file format
        """
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        print(f"Analyzing: {audio_path.name}")

        # Extract features
        feature, fps, duration = audio_file_to_features(str(audio_path), self.config)

        # Normalize
        feature = feature.T
        feature = (feature - self.mean) / self.std

        # Prepare for model (pad to timestep multiple)
        n_timestep = self.config.model['timestep']
        num_pad = n_timestep - (feature.shape[0] % n_timestep)
        feature = np.pad(feature, ((0, num_pad), (0, 0)), mode="constant", constant_values=0)
        num_instance = feature.shape[0] // n_timestep

        # Run inference
        predictions = []
        with torch.no_grad():
            feature_tensor = torch.tensor(feature, dtype=torch.float32).unsqueeze(0).to(self.device)

            for t in range(num_instance):
                chunk = feature_tensor[:, n_timestep * t:n_timestep * (t + 1), :]
                self_attn_output, _ = self.model.self_attn_layers(chunk)
                prediction, _ = self.model.output_layer(self_attn_output)
                preds = prediction.squeeze().cpu().numpy()

                # Handle both single and batch predictions
                if preds.ndim == 0:
                    predictions.append(int(preds))
                else:
                    predictions.extend(preds.astype(int))

        # Convert predictions to time segments
        # fps is actually the time per frame (seconds per feature frame)
        time_unit = fps
        segments = []

        if len(predictions) == 0:
            return segments

        prev_chord = predictions[0]
        start_time = 0.0

        for i, pred in enumerate(predictions[1:], start=1):
            if pred != prev_chord:
                chord_name = self.idx_to_chord[prev_chord]
                end_time = time_unit * i
                segments.append((start_time, end_time, chord_name))
                start_time = end_time
                prev_chord = pred

        # Final segment
        chord_name = self.idx_to_chord[prev_chord]
        end_time = min(duration, time_unit * len(predictions))
        segments.append((start_time, end_time, chord_name))

        # Format output
        if return_format == 'tuples':
            return segments
        elif return_format == 'dict':
            return [{'start': s, 'end': e, 'chord': c} for s, e, c in segments]
        elif return_format == 'lab':
            return '\n'.join([f"{s:.3f} {e:.3f} {c}" for s, e, c in segments])
        else:
            raise ValueError(f"Unknown format: {return_format}")

    def detect_and_save(self, audio_path, output_path=None):
        """
        Detect chords and save to .lab file

        Args:
            audio_path: Path to audio file
            output_path: Path to output .lab file (default: same name as audio)

        Returns:
            Path to saved .lab file
        """
        audio_path = Path(audio_path)

        if output_path is None:
            output_path = audio_path.with_suffix('.lab')
        else:
            output_path = Path(output_path)

        # Detect chords
        segments = self.detect(audio_path, return_format='tuples')

        # Write .lab file
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w') as f:
            for start, end, chord in segments:
                f.write(f"{start:.3f} {end:.3f} {chord}\n")

        print(f"✓ Saved: {output_path}")
        return str(output_path)


# Convenience functions for quick usage

def detect_chords(audio_path, large_vocab=True):
    """
    Quick function to detect chords

    Args:
        audio_path: Path to audio file
        large_vocab: Use 170 chord vocabulary (True) or 24 (False)

    Returns:
        [(start, end, chord), ...]
    """
    detector = BTCChordDetector(use_large_vocab=large_vocab)
    return detector.detect(audio_path)


def detect_and_save(audio_path, output_path=None, large_vocab=True):
    """
    Quick function to detect chords and save to .lab file

    Args:
        audio_path: Path to audio file
        output_path: Output .lab file path
        large_vocab: Use 170 chord vocabulary (True) or 24 (False)

    Returns:
        Path to saved .lab file
    """
    detector = BTCChordDetector(use_large_vocab=large_vocab)
    return detector.detect_and_save(audio_path, output_path)


# CLI Interface

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="BTC Chord Detection Wrapper")
    parser.add_argument('audio_file', help='Path to audio file (MP3/WAV)')
    parser.add_argument('--output', '-o', help='Output .lab file path (optional)')
    parser.add_argument('--vocab', choices=['large', 'small'], default='large',
                        help='Vocabulary size: large (170 chords) or small (24 chords)')
    parser.add_argument('--format', choices=['tuples', 'dict', 'lab'], default='tuples',
                        help='Output format for printing')

    args = parser.parse_args()

    # Create detector
    use_large = (args.vocab == 'large')
    detector = BTCChordDetector(use_large_vocab=use_large)

    # Detect chords
    if args.output:
        # Save to file
        detector.detect_and_save(args.audio_file, args.output)
    else:
        # Print to console
        result = detector.detect(args.audio_file, return_format=args.format)

        if args.format == 'lab':
            print(result)
        elif args.format == 'dict':
            for seg in result:
                print(f"{seg['start']:.2f}s - {seg['end']:.2f}s: {seg['chord']}")
        else:  # tuples
            for start, end, chord in result:
                print(f"{start:.2f}s - {end:.2f}s: {chord}")
