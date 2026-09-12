"""Compare three ways to split the Demucs drums and guitar stems into finer stems.

A  current production pipeline: Mega heads run on the full mix, used as Wiener masks
   inside the Demucs stems (core/msst/separate.py).
B  Mega heads run on the isolated Demucs drums / guitar stem, masks applied to that stem.
C  DrumSep (inagoy, HDemucs, MIT) on the isolated Demucs drums stem; guitar as in B.

Prints how much of each stem is really isolated per variant and writes MP3s for listening
under utils/testing/mvsep_mega_out/<track>_cmp/{ref,A,B,C}/.

Usage (from project root, venv active):
    python utils/testing/compare_drum_guitar_split.py <audio> [<audio> ...]
"""

import gc
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Sequence, Tuple

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from core.msst import separate as ms  # noqa: E402

OUT_ROOT = os.path.join('utils', 'testing', 'mvsep_mega_out')
DRUMSEP_PATH = os.path.join(ms.DEFAULT_MODEL_DIR, 'model_drumsep.th')
# DrumSep was trained with Spanish stem names.
DRUMSEP_NAMES = {'bombo': 'kick', 'redoblante': 'snare', 'platillos': 'cymbals', 'toms': 'toms'}

KIT_CHILDREN = [('kick', 'kick'), ('snare', 'snare'), ('toms', 'toms'), ('hihat', 'hh')]
GUITAR_CHILDREN = [('electric_guitar', 'electric-guitar'), ('acoustic_guitar', 'acoustic-guitar')]
B_HEADS = [h for _, h in KIT_CHILDREN + GUITAR_CHILDREN]


def energy(x: np.ndarray) -> float:
    return float(np.mean(x.astype(np.float64) ** 2))


def db(x: np.ndarray, ref: float) -> float:
    return 10 * np.log10(max(energy(x), 1e-12) / max(ref, 1e-12))


def sync(device: torch.device) -> None:
    if device.type == 'cuda':
        torch.cuda.synchronize()


def wiener_split(stem: np.ndarray, heads: Dict[str, np.ndarray],
                 children: Sequence[Tuple[str, str]], device: torch.device,
                 n_fft: int = 2048, hop: int = 512) -> Dict[str, np.ndarray]:
    """Split ``stem`` with head power masks; what the children leave goes to 'rest'.

    Same rule as HybridSplitter: P_child / max(sum(P_children), |Y_stem|^2), so the parts
    always sum back to the stem.
    """
    window = torch.hann_window(n_fft, device=device)
    t = stem.shape[-1]

    def stft(x: np.ndarray) -> torch.Tensor:
        return torch.stft(torch.from_numpy(np.ascontiguousarray(x)).to(device), n_fft, hop,
                          window=window, return_complex=True)

    with torch.inference_mode():
        y = stft(stem)
        kids = torch.stack([stft(heads[h]).abs().square() for _, h in children])
        masks = kids / (torch.maximum(kids.sum(0), y.abs().square()) + 1e-10)
        parts = list(masks * y) + [(1 - masks.sum(0)).clamp_min(0) * y]
        waves = [torch.istft(p, n_fft, hop, window=window, length=t).cpu().numpy() for p in parts]
    names = [name for name, _ in children] + ['rest']
    return dict(zip(names, waves))


def load_drumsep(device: torch.device):
    from demucs.states import load_model
    package = torch.load(DRUMSEP_PATH, map_location='cpu', weights_only=False)
    return load_model(package).to(device).eval()


def run_demucs_model(model, audio: np.ndarray, device: torch.device) -> Dict[str, np.ndarray]:
    """Apply a Demucs-family model with the same normalization as ``demucs.separate``."""
    from demucs.apply import apply_model
    wav = torch.from_numpy(np.ascontiguousarray(audio))
    ref = wav.mean(0)
    mean, std = float(ref.mean()), float(ref.std()) or 1.0
    with torch.no_grad():
        out = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=1,
                          split=True, overlap=0.25)[0]
    out = out * std + mean
    return {name: out[i].numpy() for i, name in enumerate(model.sources)}


def report(label: str, stem_name: str, stem: np.ndarray, parts: Dict[str, np.ndarray],
           seconds: float, isolated: List[str]) -> None:
    ref = energy(stem)
    share = sum(energy(parts[p]) for p in isolated if p in parts) / max(ref, 1e-12)
    total = np.sum(list(parts.values()), axis=0)
    null = float(np.abs(total - stem).max())
    levels = '  '.join(f'{k}={db(v, ref):6.1f}' for k, v in parts.items())
    print(f'  {label} {stem_name:6s} {seconds:5.1f}s  isolated {100 * share:5.1f}% '
          f'({"+".join(isolated)})  null={null:.1e}\n      {levels}')


def write_all(folder: str, parts: Dict[str, np.ndarray]) -> None:
    """Write one variant's MP3s right away so its arrays can be freed (this runs on the
    production box: holding ~30 full-length tracks at once pushed it into swap)."""
    os.makedirs(folder, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda kv: ms.write_audio(os.path.join(folder, f'{kv[0]}.mp3'), kv[1]),
                      parts.items()))


def main(paths: Sequence[str]) -> int:
    device = ms.pick_device('cuda')
    config_path, ckpt_path, _ = ms.ensure_weights()
    config = ms.load_config(config_path)
    chunk = config['audio']['chunk_size']
    _, a_heads = ms.plan(ms.FINE_STEMS)
    mega_a = ms.load_model(config, ckpt_path, a_heads, device)
    mega_b = ms.load_model(config, ckpt_path, B_HEADS, device)
    drumsep = load_drumsep(device)
    print(f'Models loaded. DrumSep sources: {drumsep.sources}')

    for path in paths:
        title = os.path.splitext(os.path.basename(path))[0]
        out = os.path.join(OUT_ROOT, f'{title}_cmp')
        mix = ms.load_audio(path)
        base = ms.run_demucs(mix, device)
        drums, guitar = base['drums'], base['guitar']
        print(f'\n=== {title} ({mix.shape[1] / ms.SAMPLE_RATE:.0f}s)  Demucs drums '
              f'{db(drums, energy(mix)):.1f} dB, guitar {db(guitar, energy(mix)):.1f} dB rel. mix')
        write_all(os.path.join(out, 'ref'), {'drums': drums, 'guitar': guitar})

        # A: production pipeline (heads computed on the full mix)
        sync(device)
        t0 = time.time()
        # Variant A is the pre-DrumSep pipeline: Mega kit heads masking the drums stem.
        kit_heads_mix = dict(zip(a_heads, ms.demix(mega_a, mix, device, chunk)))
        a_drums_split = wiener_split(drums, kit_heads_mix, KIT_CHILDREN, device)
        a = ms.separate_track(mega_a, config, a_heads, ms.FINE_STEMS, mix, base, device)
        sync(device)
        ta = time.time() - t0
        a_drums = {k: a_drums_split[k] for k in ('kick', 'snare', 'toms', 'hihat')}
        a_drums['rest'] = a_drums_split['rest']
        # In production the guitar rest is folded into electric_guitar, so A reports
        # acoustic vs everything else.
        a_guitar = {'electric_guitar': a['electric_guitar'], 'acoustic_guitar': a['acoustic_guitar']}
        del a, mix, base
        gc.collect()
        report('A', 'drums', drums, a_drums, ta, ['kick', 'snare', 'toms', 'hihat'])
        report('A', 'guitar', guitar, a_guitar, 0.0, ['acoustic_guitar'])
        write_all(os.path.join(out, 'A'), {**a_drums, **a_guitar})
        del a_drums, a_guitar
        gc.collect()

        # B: Mega heads computed on the isolated Demucs stems
        sync(device)
        t0 = time.time()
        kit_heads = dict(zip(B_HEADS, ms.demix(mega_b, drums, device, chunk)))
        b_drums = wiener_split(drums, kit_heads, KIT_CHILDREN, device)
        sync(device)
        tb_d = time.time() - t0
        t0 = time.time()
        gtr_heads = dict(zip(B_HEADS, ms.demix(mega_b, guitar, device, chunk)))
        b_guitar = wiener_split(guitar, gtr_heads, GUITAR_CHILDREN, device)
        sync(device)
        tb_g = time.time() - t0
        del kit_heads, gtr_heads
        report('B', 'drums', drums, b_drums, tb_d, ['kick', 'snare', 'toms', 'hihat'])
        report('B', 'guitar', guitar, b_guitar, tb_g,
               ['electric_guitar', 'acoustic_guitar'])
        write_all(os.path.join(out, 'B'), {**b_drums, **{
            f'guitar_{k}' if k == 'rest' else k: v for k, v in b_guitar.items()}})
        del b_drums, b_guitar
        gc.collect()

        # C: DrumSep on the isolated Demucs drums
        sync(device)
        t0 = time.time()
        ds = run_demucs_model(drumsep, drums, device)
        sync(device)
        tc = time.time() - t0
        c_drums = {DRUMSEP_NAMES.get(k, k): v for k, v in ds.items()}
        c_drums['rest'] = drums - np.sum(list(ds.values()), axis=0)
        report('C', 'drums', drums, c_drums, tc, ['kick', 'snare', 'toms'])
        print(f'      (C cymbals include the hi-hat; A/B keep cymbals in "rest")')
        write_all(os.path.join(out, 'C'), c_drums)
        del c_drums, ds
        gc.collect()
        print(f'  MP3 written to {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
