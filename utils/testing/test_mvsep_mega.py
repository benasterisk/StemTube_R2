"""Spike: measure the fine-stem pipeline (Demucs htdemucs_6s + MVSep Mega) on real tracks.

Default run: the production pipeline — reports peak VRAM, wall time, per-stem level,
a null test, and writes WAVs for A/B listening against the existing Demucs stems.

``--analyse`` additionally runs the raw Mega heads on the mixture and reports how the
overlapping heads nest (e.g. does ``keys`` contain piano + organ + synth?). That analysis
is what the grouping in ``core/msst/separate.py`` is based on.

Usage (from project root, venv active):
    python utils/testing/test_mvsep_mega.py <audio> [...] [--out DIR] [--analyse]
"""

import argparse
import os
import sys
import time

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from core.msst import separate as ms  # noqa: E402

ANALYSIS_HEADS = [
    'vocal', 'lead-vocal', 'back-vocal',
    'drums', 'kick', 'snare', 'toms', 'hh', 'percussion',
    'bass',
    'guitar', 'electric-guitar', 'acoustic-guitar',
    'keys', 'piano', 'digital-piano', 'organ', 'synth',
    'brass', 'trumpet', 'trombone', 'saxophone', 'wind', 'woodwind',
    'strings', 'bowed_strings', 'violin', 'cello',
]

# parent head -> candidate children. We check whether the parent ~= sum(children).
HIERARCHY = {
    'vocal': ['lead-vocal', 'back-vocal'],
    'drums': ['kick', 'snare', 'toms', 'hh'],
    'guitar': ['electric-guitar', 'acoustic-guitar'],
    'keys': ['piano', 'digital-piano', 'organ', 'synth'],
    'brass': ['trumpet', 'trombone'],
    'wind': ['brass', 'woodwind'],
    'woodwind': ['saxophone'],
    'strings': ['bowed_strings'],
    'bowed_strings': ['violin', 'cello'],
}
SIBLINGS = [['piano', 'digital-piano', 'keys', 'organ', 'synth'],
            ['guitar', 'electric-guitar', 'acoustic-guitar'],
            ['drums', 'percussion'],
            ['brass', 'wind', 'woodwind', 'saxophone']]


def db(x: np.ndarray, ref: float) -> float:
    e = float(np.mean(x.astype(np.float64) ** 2))
    return 10 * np.log10(max(e, 1e-12) / ref)


def cos(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a.ravel().astype(np.float64), b.ravel().astype(np.float64)
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))


def analyse(title: str, mix: np.ndarray, src: dict) -> None:
    ref = float(np.mean(mix.astype(np.float64) ** 2))
    print(f'\n--- {title}: raw head level relative to mix (dB) ---')
    print('  ' + '  '.join(f'{h}={db(src[h], ref):.1f}' for h in ANALYSIS_HEADS))

    print('\n  Hierarchy  parent  vs  sum(children)   [cos | residual dB rel. parent]')
    for parent, children in HIERARCHY.items():
        p = src[parent]
        s = np.sum([src[c] for c in children], axis=0)
        pe = float(np.mean(p.astype(np.float64) ** 2))
        if pe < 1e-9:
            print(f'   {parent:14s} silent')
            continue
        print(f'   {parent:14s} cos={cos(p, s):.3f}  residual={db(p - s, pe):6.1f} dB  '
              f'children/parent={db(s, pe):5.1f} dB')

    print('\n  Sibling cosine similarity (high = same content counted twice)')
    for group in SIBLINGS:
        pairs = [(a, b) for i, a in enumerate(group) for b in group[i + 1:]]
        print('   ' + '  '.join(f'{a}/{b}={cos(src[a], src[b]):.2f}' for a, b in pairs))


def sync(device: torch.device) -> None:
    if device.type == 'cuda':
        torch.cuda.synchronize()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('audio', nargs='+')
    parser.add_argument('--out', default=os.path.join('utils', 'testing', 'mvsep_mega_out'))
    parser.add_argument('--analyse', action='store_true', help='Also analyse raw head overlap')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    args = parser.parse_args()

    config_path, ckpt_path, drumsep_path = ms.ensure_weights()
    config = ms.load_config(config_path)
    chunk = config['audio']['chunk_size']
    device = ms.pick_device('cuda')
    _, heads = ms.plan(ms.FINE_STEMS)
    all_heads = list(dict.fromkeys(heads + (ANALYSIS_HEADS if args.analyse else [])))

    for path in args.audio:
        title = os.path.splitext(os.path.basename(path))[0]
        mix = ms.load_audio(path, args.ffmpeg)
        duration = mix.shape[1] / ms.SAMPLE_RATE
        ref = float(np.mean(mix.astype(np.float64) ** 2))
        if device.type == 'cuda':
            torch.cuda.reset_peak_memory_stats()

        # Same order as production: Demucs first (then freed), then the Mega model.
        sync(device)
        t0 = time.time()
        base = ms.run_demucs(mix, device)
        drum_parts = ms.run_drumsep(base['drums'], drumsep_path, device)
        sync(device)
        t_demucs = time.time() - t0
        model = ms.load_model(config, ckpt_path, all_heads, device)
        if args.analyse:
            analyse(title, mix, dict(zip(all_heads, ms.demix(model, mix, device, chunk))))
        sync(device)
        t0 = time.time()
        outputs = ms.separate_track(model, config, all_heads, ms.FINE_STEMS, mix, base, device,
                                    drum_parts)
        sync(device)
        t_split = time.time() - t0
        del model
        peak = torch.cuda.max_memory_allocated() / 2**30 if device.type == 'cuda' else 0
        print(f'\n=== {title}: {duration:.0f}s audio | demucs {t_demucs:.1f}s + mega split '
              f'{t_split:.1f}s | peak VRAM {peak:.2f} GB ===')
        print('  Demucs levels (dB rel. mix): ' + '  '.join(
            f'{k}={db(v, ref):.1f}' for k, v in base.items()))
        print('  Fine levels   (dB rel. mix): ' + '  '.join(
            f'{k}={db(v, ref):.1f}' for k, v in outputs.items()))
        stems_sum = np.sum([v for k, v in outputs.items() if k != ms.DRUMS_FULL_KEY], axis=0)
        print(f'  Null test max |mix - sum(stems)| = {np.abs(mix - stems_sum).max():.2e}')

        out_dir = os.path.join(args.out, title + '_hybrid')
        os.makedirs(out_dir, exist_ok=True)
        for k, v in outputs.items():
            ms.write_audio(os.path.join(out_dir, f'{k}.wav'), v)
        print(f'  WAV written to {out_dir}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
