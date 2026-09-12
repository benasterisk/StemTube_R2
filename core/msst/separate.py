"""Fine-grained stem separation: Demucs htdemucs_6s + DrumSep + MVSep Mega BS-Roformer.

Runs as a subprocess (``python -m core.msst.separate``), like ``wrap_demucs.py``, so a
cancel can kill it and all VRAM is released when it exits. Progress is printed as
``Progress: NN.N%`` which the StemsExtractor output parser already understands; no other
output line may contain a percent sign.

Three stages, each doing what it is best at (measured with
``utils/testing/compare_drum_guitar_split.py`` on real songs):

1. **Demucs htdemucs_6s** — coarse split (vocals, drums, bass, guitar, piano, other).
   Running the Mega model alone on the mixture loses much of the drum kit (-13 dB where
   Demucs finds -2 dB), so Demucs owns this stage.
2. **DrumSep** (inagoy, HDemucs, MIT) on the isolated Demucs drums — kick, snare, toms,
   cymbals (hi-hat included). It isolates 76-94 % of the kit in ~4 s, where the Mega kit
   heads managed 9-44 %.
3. **MVSep Mega** heads on the mixture, used as Wiener masks *inside* each remaining
   Demucs stem:

       Y_child = P_child / max(sum(P_children), |Y_parent|^2) * Y_parent

   where P are power spectrograms of the head estimates and Y_parent the STFT of the
   Demucs stem. Whatever the children do not claim stays in the parent's ``rest`` stem, so
   a leaky head can only take content from inside its own parent.

Every Demucs stem is exactly the sum of its fine stems, and the gap between the Demucs sum
and the mixture is added to ``other``: the stems always add back up to the original.
"""

import argparse
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import torch
import yaml
from torch import nn

from .bs_roformer import BSRoformer

SAMPLE_RATE = 44100
DEMUCS_MODEL = 'htdemucs_6s'
RELEASE_URL = 'https://github.com/ZFTurbo/Music-Source-Separation-Training/releases/download'
MEGA_URL = f'{RELEASE_URL}/v1.0.21'
CONFIG_NAME = 'mvsep_mega_model_bs_roformer_53_stems.yaml'
CKPT_NAME = 'mvsep_mega_model_bs_roformer_53_stems_v1.ckpt'
DRUMSEP_URL = f'{RELEASE_URL}/v1.0.5'
DRUMSEP_NAME = 'model_drumsep.th'
DEFAULT_MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                 'models', 'msst')

RESIDUAL_KEY = 'other'
# Full drum kit (the Demucs drums stem), written next to the stems but not exposed in the
# mixer: the metronome's beat detection needs the whole kit, not its split parts.
DRUMS_FULL_KEY = 'drums_full'
# DrumSep was trained with Spanish stem names; "drums" keeps what it could not isolate.
DRUMSEP_SOURCES = {'bombo': 'kick', 'redoblante': 'snare', 'platillos': 'cymbals',
                   'toms': 'toms'}
DRUM_STEMS: List[str] = ['drums', 'kick', 'snare', 'toms', 'cymbals']
DRUM_REST = 'drums'


@dataclass(frozen=True)
class Group:
    """A Demucs stem split between Mega child heads. ``rest`` receives what the children
    leave (for a group without children it is simply the output stem)."""
    source: str
    rest: str
    children: Tuple[Tuple[str, str], ...] = field(default_factory=tuple)  # (stem, head)

    @property
    def stems(self) -> List[str]:
        return list(dict.fromkeys([s for s, _ in self.children] + [self.rest]))


# Head choice comes from utils/testing measurements: ``keys`` is a catch-all,
# ``digital-piano`` duplicates ``piano`` and ``strings`` does not contain bowed strings, so
# those heads are unused. The drums stem is not here — DrumSep handles it.
HYBRID_GROUPS: Tuple[Group, ...] = (
    Group('vocals', rest='vocals', children=(('vocals', 'lead-vocal'),
                                             ('backing_vocals', 'back-vocal'))),
    Group('bass', rest='bass'),
    Group('guitar', rest='electric_guitar', children=(('electric_guitar', 'electric-guitar'),
                                                      ('acoustic_guitar', 'acoustic-guitar'))),
    Group('piano', rest='piano', children=(('piano', 'piano'), ('organ', 'organ'),
                                           ('synth', 'synth'))),
    Group('other', rest=RESIDUAL_KEY, children=(('piano', 'piano'), ('organ', 'organ'),
                                                ('synth', 'synth'), ('brass', 'brass'),
                                                ('winds', 'woodwind'),
                                                ('strings', 'bowed_strings'))),
)
# Must match STEM_MODELS["mvsep_mega_fine"]["stems"] in core/config.py (minus "other").
FINE_STEMS: List[str] = ['vocals', 'backing_vocals', 'drums', 'kick', 'snare', 'toms',
                         'cymbals', 'bass', 'electric_guitar', 'acoustic_guitar', 'piano',
                         'organ', 'synth', 'brass', 'winds', 'strings']


def log(msg: str) -> None:
    print(msg.replace('%', ' pct'), flush=True)


def report_progress(value: float) -> None:
    print(f'Progress: {max(0.0, min(100.0, value)):.1f}%', flush=True)


class _ConfigLoader(yaml.SafeLoader):
    """SafeLoader that also accepts the ``!!python/tuple`` tags used by MSST configs."""


_ConfigLoader.add_constructor('tag:yaml.org,2002:python/tuple',
                              lambda loader, node: tuple(loader.construct_sequence(node)))


def load_config(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return yaml.load(f, Loader=_ConfigLoader)


def weights_present(model_dir: str = DEFAULT_MODEL_DIR) -> bool:
    return all(os.path.exists(os.path.join(model_dir, n))
               for n in (CONFIG_NAME, CKPT_NAME, DRUMSEP_NAME))


def _download(url: str, dest: str) -> None:
    tmp = dest + '.part'
    name = os.path.basename(dest)
    log(f'Downloading {name} (first use only)...')
    last = [-1]

    def hook(blocks, block_size, total):
        mb = blocks * block_size // (1024 * 1024)
        if total > 0 and mb // 100 != last[0] // 100:
            last[0] = mb
            log(f'Downloading {name}: {mb}/{total // (1024 * 1024)} MB')

    urllib.request.urlretrieve(url, tmp, reporthook=hook)
    os.replace(tmp, dest)


def ensure_weights(model_dir: str = DEFAULT_MODEL_DIR) -> Tuple[str, str, str]:
    """Download the model files on first use. Returns (config, mega ckpt, drumsep)."""
    os.makedirs(model_dir, exist_ok=True)
    paths = []
    for base_url, name in ((MEGA_URL, CONFIG_NAME), (MEGA_URL, CKPT_NAME),
                           (DRUMSEP_URL, DRUMSEP_NAME)):
        dest = os.path.join(model_dir, name)
        if not os.path.exists(dest):
            _download(f'{base_url}/{name}', dest)
        paths.append(dest)
    return tuple(paths)  # type: ignore[return-value]


def load_model(config: dict, ckpt_path: str, heads: Sequence[str],
               device: torch.device) -> nn.Module:
    """Build the Mega model and keep only the mask heads we need.

    Nearly all parameters live in the 53 per-stem mask estimators; the shared trunk is
    small. Dropping unused heads before moving to the GPU brings the model from the 16 GB
    the author recommends down to ~2.5 GB peak.
    """
    instruments = config['training']['instruments']
    unknown = [h for h in heads if h not in instruments]
    if unknown:
        raise ValueError(f'Unknown model heads: {unknown}')

    model = BSRoformer(**config['model'])
    try:
        state = torch.load(ckpt_path, map_location='cpu', weights_only=True)
    except Exception:
        state = torch.load(ckpt_path, map_location='cpu', weights_only=False)
    if isinstance(state, dict) and 'state_dict' in state:
        state = state['state_dict']
    state = {k.removeprefix('module.'): v for k, v in state.items()}
    model.load_state_dict(state)
    del state

    model.mask_estimators = nn.ModuleList(
        [model.mask_estimators[instruments.index(h)] for h in heads])
    model.num_stems = len(heads)
    return model.to(device).eval()


class _TqdmShim:
    """Stands in for the ``tqdm`` module inside ``demucs.apply`` to forward progress."""

    def __init__(self, on_progress: Optional[Callable[[float], None]]):
        self.on_progress = on_progress

    def tqdm(self, iterable, **_kwargs):
        items = list(iterable)
        for i, item in enumerate(items):
            yield item  # demucs computes the chunk when the caller resumes
            if self.on_progress:
                self.on_progress((i + 1) / len(items))


def apply_demucs(model, audio: np.ndarray, device: torch.device,
                 on_progress: Optional[Callable[[float], None]] = None
                 ) -> Dict[str, np.ndarray]:
    """Apply a Demucs-family model with the same normalization as ``demucs.separate``."""
    from demucs import apply as demucs_apply

    wav = torch.from_numpy(np.ascontiguousarray(audio))
    ref = wav.mean(0)
    mean, std = float(ref.mean()), float(ref.std()) or 1.0
    original_tqdm = demucs_apply.tqdm
    demucs_apply.tqdm = _TqdmShim(on_progress)
    try:
        with torch.no_grad():
            sources = demucs_apply.apply_model(model, ((wav - mean) / std)[None], device=device,
                                               shifts=1, split=True, overlap=0.25,
                                               progress=True)[0]
    finally:
        demucs_apply.tqdm = original_tqdm
    sources = sources * std + mean
    return {name: sources[i].numpy() for i, name in enumerate(model.sources)}


def run_demucs(mix: np.ndarray, device: torch.device,
               on_progress: Optional[Callable[[float], None]] = None) -> Dict[str, np.ndarray]:
    """Coarse split with htdemucs_6s."""
    from demucs.pretrained import get_model

    model = get_model(DEMUCS_MODEL)
    model.to(device).eval()
    try:
        return apply_demucs(model, mix, device, on_progress)
    finally:
        del model
        if device.type == 'cuda':
            torch.cuda.empty_cache()


def run_drumsep(drums: np.ndarray, drumsep_path: str, device: torch.device,
                on_progress: Optional[Callable[[float], None]] = None
                ) -> Dict[str, np.ndarray]:
    """Split an isolated drums stem into kick / snare / toms / cymbals (+ the rest)."""
    from demucs.states import load_model as load_demucs_model

    # torch 2.6 defaults to weights_only=True, which cannot unpickle the model class.
    package = torch.load(drumsep_path, map_location='cpu', weights_only=False)
    model = load_demucs_model(package).to(device).eval()
    try:
        parts = apply_demucs(model, drums, device, on_progress)
    finally:
        del model, package
        if device.type == 'cuda':
            torch.cuda.empty_cache()
    out = {DRUMSEP_SOURCES.get(k, k): v for k, v in parts.items()}
    out[DRUM_REST] = drums - np.sum(list(parts.values()), axis=0)
    return out


def plan(stems: Sequence[str],
         groups: Sequence[Group] = HYBRID_GROUPS) -> Tuple[List[bool], List[str]]:
    """Which groups get split, and the Mega heads that needs.

    A group is split when one of its child stems, or its own rest stem, was requested;
    otherwise its whole Demucs stem goes to its rest stem or to "other".
    """
    wanted = set(stems)
    split, heads = [], []
    for g in groups:
        rest_wanted = g.rest in wanted and g.rest != RESIDUAL_KEY
        do_split = bool(g.children) and (rest_wanted or any(s in wanted for s, _ in g.children))
        split.append(do_split)
        if do_split:
            for _, h in g.children:
                if h not in heads:
                    heads.append(h)
    return split, heads


class HybridSplitter:
    """Per-chunk split of Demucs stems with Mega head masks (see module docstring). Runs
    on the model's device so the STFTs stay cheap. The drums stem is left untouched here;
    DrumSep splits it separately."""

    def __init__(self, stems: Sequence[str], heads: Sequence[str], sources: Sequence[str],
                 groups: Sequence[Group] = HYBRID_GROUPS, n_fft: int = 2048, hop: int = 512):
        self.groups = list(groups)
        self.split, _ = plan(stems, groups)
        self.head_index = {h: i for i, h in enumerate(heads)}
        self.source_index = {s: i for i, s in enumerate(sources)}
        wanted = set(stems)
        self.spec_outputs = [s for s in FINE_STEMS
                             if s in wanted and s not in DRUM_STEMS] + [RESIDUAL_KEY]
        self.outputs = self.spec_outputs + [DRUMS_FULL_KEY]
        self.slot = {s: i for i, s in enumerate(self.spec_outputs)}
        self.n_fft, self.hop = n_fft, hop

    def _target(self, stem: str) -> int:
        # Stems the user did not ask for fall back into "other" so nothing is lost.
        return self.slot.get(stem, self.slot[RESIDUAL_KEY])

    def __call__(self, mix: torch.Tensor, est: Optional[torch.Tensor],
                 base: torch.Tensor) -> torch.Tensor:
        """mix: (B, C, T), est: (B, H, C, T) or None, base: (B, S, C, T)
        -> (B, len(outputs), C, T)."""
        b, c, t = mix.shape
        window = torch.hann_window(self.n_fft, device=mix.device)

        def stft(x: torch.Tensor) -> torch.Tensor:
            shape = x.shape[:-1]
            spec = torch.stft(x.reshape(-1, t).float(), self.n_fft, self.hop, window=window,
                              return_complex=True)
            return spec.reshape(*shape, *spec.shape[-2:])

        y = stft(base)                                             # (B, S, C, F, N)
        power = stft(est).abs().square() if est is not None else None
        out = torch.zeros((b, len(self.spec_outputs)) + y.shape[2:], dtype=y.dtype,
                          device=y.device)
        eps = 1e-10

        for g, do_split in zip(self.groups, self.split):
            share = y[:, self.source_index[g.source]]
            if not do_split:
                out[:, self._target(g.rest)] += share
                continue
            kids = torch.stack([power[:, self.head_index[h]] for _, h in g.children], dim=1)
            kid_total = torch.maximum(kids.sum(1), share.abs().square())
            kid_masks = kids / (kid_total.unsqueeze(1) + eps)
            for ki, (stem, _) in enumerate(g.children):
                out[:, self._target(stem)] += kid_masks[:, ki] * share
            out[:, self._target(g.rest)] += (1 - kid_masks.sum(1)).clamp_min(0) * share

        wave = torch.istft(out.reshape(-1, *y.shape[-2:]), self.n_fft, self.hop, window=window,
                           length=t).reshape(b, len(self.spec_outputs), c, t)
        # The Demucs stems (drums included) do not sum exactly to the mixture; the gap
        # stays in "other". The drums stem itself is split by DrumSep, not here.
        wave[:, self.slot[RESIDUAL_KEY]] += mix - base.sum(1)
        drums = base[:, self.source_index['drums']].unsqueeze(1)
        return torch.cat([wave, drums], dim=1)


def _window(chunk_size: int, fade_size: int) -> torch.Tensor:
    window = torch.ones(chunk_size)
    window[:fade_size] = torch.linspace(0, 1, fade_size)
    window[-fade_size:] = torch.linspace(1, 0, fade_size)
    return window


def demix(model: Optional[nn.Module], mix: np.ndarray, device: torch.device, chunk_size: int,
          num_overlap: int = 2, batch_size: int = 1, post: Optional[Callable] = None,
          num_outputs: Optional[int] = None, side: Optional[np.ndarray] = None,
          on_progress: Optional[Callable[[float], None]] = None) -> np.ndarray:
    """Overlap-add chunked inference (port of MSST ``demix`` generic mode).

    ``side`` (S, C, T) is chunked exactly like ``mix`` and handed to
    ``post(mix_chunk, head_chunk, side_chunk)``, which may turn each chunk into
    ``num_outputs`` stems before overlap-add. ``model`` may be None when ``post`` needs no
    head estimates. Returns (outputs, channels, samples). The overlap counter is 1-D (the
    window is the same for every output and channel) to keep host RAM low.
    """
    mix_t = torch.tensor(mix, dtype=torch.float32)
    side_t = torch.tensor(side, dtype=torch.float32) if side is not None else None
    fade_size = chunk_size // 10
    step = chunk_size // num_overlap
    border = chunk_size - step
    length_init = mix_t.shape[-1]
    padded = length_init > 2 * border and border > 0
    if padded:
        mix_t = nn.functional.pad(mix_t, (border, border), mode='reflect')
        if side_t is not None:
            side_t = nn.functional.pad(side_t, (border, border), mode='reflect')

    total = mix_t.shape[-1]
    n_out = num_outputs or len(model.mask_estimators)
    result = torch.zeros((n_out,) + tuple(mix_t.shape), dtype=torch.float32)
    counter = torch.zeros(total, dtype=torch.float32)
    base_window = _window(chunk_size, fade_size)
    use_amp = device.type == 'cuda'

    def chunk(x: torch.Tensor, start: int) -> Tuple[torch.Tensor, int]:
        part = x[..., start:start + chunk_size].to(device)
        seg_len = part.shape[-1]
        pad_mode = 'reflect' if seg_len > chunk_size // 2 else 'constant'
        return nn.functional.pad(part, (0, chunk_size - seg_len), mode=pad_mode), seg_len

    with torch.inference_mode():
        i = 0
        batch, side_batch, locations = [], [], []
        while i < total:
            part, seg_len = chunk(mix_t, i)
            batch.append(part)
            if side_t is not None:
                side_batch.append(chunk(side_t, i)[0])
            locations.append((i, seg_len))
            i += step

            if len(batch) >= batch_size or i >= total:
                arr = torch.stack(batch, dim=0)
                est = None
                if model is not None:
                    with torch.autocast(device_type=device.type, dtype=torch.float16,
                                        enabled=use_amp):
                        est = model(arr)
                    est = est.float()
                if post is not None:
                    extra = torch.stack(side_batch, dim=0) if side_batch else None
                    est = post(arr, est, extra)
                est = est.cpu()
                for j, (start, seg_len) in enumerate(locations):
                    window = base_window.clone()
                    if start == 0:
                        window[:fade_size] = 1
                    if start + step >= total:
                        window[-fade_size:] = 1
                    result[..., start:start + seg_len] += est[j, ..., :seg_len] * window[:seg_len]
                    counter[start:start + seg_len] += window[:seg_len]
                batch.clear()
                side_batch.clear()
                locations.clear()
                if on_progress:
                    on_progress(min(i, total) / total)

    result /= counter.clamp_min(1e-8)
    if padded:
        result = result[..., border:-border]
    return np.nan_to_num(result.numpy(), copy=False)


def separate_track(model: Optional[nn.Module], config: dict, heads: Sequence[str],
                   stems: Sequence[str], mix: np.ndarray, base: Dict[str, np.ndarray],
                   device: torch.device, drum_parts: Optional[Dict[str, np.ndarray]] = None,
                   overlap: int = 2, batch_size: int = 1,
                   on_progress: Optional[Callable[[float], None]] = None
                   ) -> Dict[str, np.ndarray]:
    """Split the Demucs ``base`` stems into the requested fine stems.

    ``drum_parts`` are the DrumSep outputs for ``base['drums']``; parts the user did not
    ask for are folded into "other" so the stems still sum to the mixture.
    """
    sources = list(base)
    splitter = HybridSplitter(stems, heads, sources, n_fft=config['model']['stft_n_fft'],
                              hop=config['model']['stft_hop_length'])
    side = np.stack([base[s] for s in sources])
    result = demix(model, mix, device, config['audio']['chunk_size'], overlap, batch_size,
                   post=splitter, num_outputs=len(splitter.outputs), side=side,
                   on_progress=on_progress)
    outputs = dict(zip(splitter.outputs, result))

    wanted = set(stems)
    for name, audio in (drum_parts or {}).items():
        if name in wanted:
            outputs[name] = audio
        else:
            outputs[RESIDUAL_KEY] = outputs[RESIDUAL_KEY] + audio
    if not drum_parts:  # no drum stem requested: the kit stays in "other"
        outputs[RESIDUAL_KEY] = outputs[RESIDUAL_KEY] + base['drums']
    return outputs


def load_audio(path: str, ffmpeg: str = 'ffmpeg') -> np.ndarray:
    """Decode any container ffmpeg understands to float32 stereo 44.1 kHz, shape (2, T)."""
    cmd = [ffmpeg, '-v', 'error', '-i', path, '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le',
           '-ac', '2', '-ar', str(SAMPLE_RATE), '-']
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy()


def write_audio(path: str, audio: np.ndarray, ffmpeg: str = 'ffmpeg',
                bitrate: str = '320k') -> None:
    """Write (2, T) float audio. MP3 goes through ffmpeg, WAV through soundfile."""
    if path.endswith('.wav'):
        import soundfile as sf
        sf.write(path, audio.T, SAMPLE_RATE, subtype='FLOAT')
        return
    pcm = np.ascontiguousarray(np.clip(audio, -1.0, 1.0).T, dtype=np.float32).tobytes()
    cmd = [ffmpeg, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SAMPLE_RATE), '-ac', '2',
           '-i', '-', '-codec:a', 'libmp3lame', '-b:a', bitrate, path]
    subprocess.run(cmd, input=pcm, check=True)


def pick_device(requested: str) -> torch.device:
    if requested == 'cuda' and torch.cuda.is_available():
        return torch.device('cuda')
    if requested == 'cuda':
        log('CUDA requested but not available, falling back to CPU')
    return torch.device('cpu')


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('input')
    parser.add_argument('-o', '--output-dir', required=True)
    parser.add_argument('--stems', default=','.join(FINE_STEMS),
                        help='Comma-separated stems; unselected content goes to "other"')
    parser.add_argument('--format', choices=('mp3', 'wav'), default='mp3')
    parser.add_argument('--bitrate', default='320k')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('-d', '--device', choices=('cuda', 'cpu'), default='cuda')
    parser.add_argument('--model-dir', default=DEFAULT_MODEL_DIR)
    parser.add_argument('--overlap', type=int, default=2)
    parser.add_argument('--batch-size', type=int, default=1)
    args = parser.parse_args(argv)

    stems = [s for s in args.stems.split(',') if s and s != RESIDUAL_KEY]
    unknown = [s for s in stems if s not in FINE_STEMS]
    if unknown:
        parser.error(f'unknown stems: {unknown}')

    started = time.time()
    device = pick_device(args.device)
    config_path, ckpt_path, drumsep_path = ensure_weights(args.model_dir)
    config = load_config(config_path)
    mix = load_audio(args.input, args.ffmpeg)

    log(f'Coarse split with {DEMUCS_MODEL} on {device}')
    base = run_demucs(mix, device, on_progress=lambda f: report_progress(1 + f * 29))

    drum_parts = None
    if any(s in stems for s in DRUM_STEMS):
        log('Splitting the drum kit with DrumSep')
        drum_parts = run_drumsep(base['drums'], drumsep_path, device,
                                 on_progress=lambda f: report_progress(30 + f * 6))
    report_progress(36)

    _, heads = plan(stems)
    model = None
    if heads:
        log(f'Loading MVSep Mega model on {device} with {len(heads)} heads')
        model = load_model(config, ckpt_path, heads, device)
    report_progress(38)
    outputs = separate_track(model, config, heads, stems, mix, base, device, drum_parts,
                             args.overlap, args.batch_size,
                             on_progress=lambda f: report_progress(38 + f * 52))
    del model, base, drum_parts
    if device.type == 'cuda':
        torch.cuda.empty_cache()

    os.makedirs(args.output_dir, exist_ok=True)
    # One ffmpeg encoder per stem; running a few in parallel cuts ~18 sequential encodes.
    with ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 1)) as pool:
        jobs = [pool.submit(write_audio, os.path.join(args.output_dir, f'{key}.{args.format}'),
                            audio, args.ffmpeg, args.bitrate)
                for key, audio in outputs.items()]
        for n, job in enumerate(as_completed(jobs)):
            job.result()
            report_progress(90 + 10 * (n + 1) / len(jobs))
    log(f'Separated {len(outputs)} stems in {time.time() - started:.1f}s')
    return 0


if __name__ == '__main__':
    sys.exit(main())
