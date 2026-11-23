"""Polyphonic note transcription with Spotify's Basic Pitch model (ICASSP 2022).

The model file ``basic_pitch_nmp.onnx`` and the note-creation algorithm below
come from https://github.com/spotify/basic-pitch, Copyright 2022 Spotify AB,
licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). This module is a trimmed port of
``basic_pitch/inference.py`` and ``basic_pitch/note_creation.py``: ONNX inference
only, no pitch bends, no TensorFlow / resampy / pretty_midi dependency. Windows
are batched for speed; the note-creation logic is unchanged.
"""
import os
import threading

import numpy as np
import scipy.signal

FFT_HOP = 256
AUDIO_SAMPLE_RATE = 22050
AUDIO_WINDOW_LENGTH = 2
ANNOTATIONS_FPS = AUDIO_SAMPLE_RATE // FFT_HOP
ANNOT_N_FRAMES = ANNOTATIONS_FPS * AUDIO_WINDOW_LENGTH
AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * AUDIO_WINDOW_LENGTH - FFT_HOP
MIDI_OFFSET = 21
MAX_FREQ_IDX = 87
N_OVERLAPPING_FRAMES = 30

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "basic_pitch_nmp.onnx")
_session = None
_lock = threading.Lock()


def _get_session():
    global _session
    with _lock:
        if _session is None:
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            _session = ort.InferenceSession(MODEL_PATH, sess_options=opts,
                                            providers=["CPUExecutionProvider"])
        return _session


def run_inference(audio, batch=8):
    """audio: mono float32 at AUDIO_SAMPLE_RATE. Returns {'note', 'onset', 'contour'} (frames x bins)."""
    session = _get_session()
    overlap_len = N_OVERLAPPING_FRAMES * FFT_HOP
    hop_size = AUDIO_N_SAMPLES - overlap_len
    original_length = audio.shape[0]
    audio = np.concatenate([np.zeros(overlap_len // 2, np.float32), audio.astype(np.float32)])
    windows = []
    for i in range(0, audio.shape[0], hop_size):
        w = audio[i:i + AUDIO_N_SAMPLES]
        if len(w) < AUDIO_N_SAMPLES:
            w = np.pad(w, (0, AUDIO_N_SAMPLES - len(w)))
        windows.append(w)
    x = np.stack(windows)[:, :, None]
    out = {"note": [], "onset": [], "contour": []}
    names = ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2", "StatefulPartitionedCall:0"]
    for i in range(0, len(x), batch):
        res = session.run(names, {"serving_default_input_2:0": x[i:i + batch]})
        for k, v in zip(("note", "onset", "contour"), res):
            out[k].append(v)
    n_olap = N_OVERLAPPING_FRAMES // 2
    n_frames = int(np.floor(original_length * (ANNOTATIONS_FPS / AUDIO_SAMPLE_RATE)))
    unwrapped = {}
    for k in out:
        o = np.concatenate(out[k])[:, n_olap:-n_olap, :]
        unwrapped[k] = o.reshape(o.shape[0] * o.shape[1], o.shape[2])[:n_frames, :]
    return unwrapped


def frames_to_time(n_frames):
    original = np.arange(n_frames) * FFT_HOP / AUDIO_SAMPLE_RATE
    window_numbers = np.floor(np.arange(n_frames) / ANNOT_N_FRAMES)
    # same alignment constant as the reference implementation
    window_offset = (FFT_HOP / AUDIO_SAMPLE_RATE) * (ANNOT_N_FRAMES - (AUDIO_N_SAMPLES / FFT_HOP)) + 0.0018
    return original - window_offset * window_numbers


def _hz_to_idx(hz):
    return int(np.round(69 + 12 * np.log2(hz / 440.0) - MIDI_OFFSET))


def _inferred_onsets(onsets, frames, n_diff=2):
    diffs = []
    for n in range(1, n_diff + 1):
        appended = np.concatenate([np.zeros((n, frames.shape[1])), frames])
        diffs.append(appended[n:, :] - appended[:-n, :])
    frame_diff = np.min(diffs, axis=0)
    frame_diff[frame_diff < 0] = 0
    frame_diff[:n_diff, :] = 0
    peak = np.max(frame_diff)
    if peak > 0:
        frame_diff = np.max(onsets) * frame_diff / peak
    return np.max([onsets, frame_diff], axis=0)


def output_to_notes(frames, onsets, onset_thresh=0.5, frame_thresh=0.3, min_note_len=11,
                    min_freq=None, max_freq=None, melodia_trick=True, energy_tol=11):
    """Returns [(start_frame, end_frame, midi_pitch, amplitude)]."""
    frames = frames.copy()
    onsets = onsets.copy()
    n_frames = frames.shape[0]
    if max_freq is not None:
        i = max(0, min(88, _hz_to_idx(max_freq)))
        onsets[:, i:] = 0
        frames[:, i:] = 0
    if min_freq is not None:
        i = max(0, min(88, _hz_to_idx(min_freq)))
        onsets[:, :i] = 0
        frames[:, :i] = 0
    onsets = _inferred_onsets(onsets, frames)

    peak_mat = np.zeros(onsets.shape)
    peaks = scipy.signal.argrelmax(onsets, axis=0)
    peak_mat[peaks] = onsets[peaks]
    onset_idx = np.where(peak_mat >= onset_thresh)
    onset_time_idx = onset_idx[0][::-1]
    onset_freq_idx = onset_idx[1][::-1]

    remaining = frames.copy()
    notes = []
    for start, f in zip(onset_time_idx, onset_freq_idx):
        if start >= n_frames - 1:
            continue
        i = start + 1
        k = 0
        while i < n_frames - 1 and k < energy_tol:
            k = k + 1 if remaining[i, f] < frame_thresh else 0
            i += 1
        i -= k
        if i - start <= min_note_len:
            continue
        remaining[start:i, f] = 0
        if f < MAX_FREQ_IDX:
            remaining[start:i, f + 1] = 0
        if f > 0:
            remaining[start:i, f - 1] = 0
        notes.append((int(start), int(i), int(f + MIDI_OFFSET), float(np.mean(frames[start:i, f]))))

    if melodia_trick:
        shape = remaining.shape
        while np.max(remaining) > frame_thresh:
            i_mid, f = np.unravel_index(np.argmax(remaining), shape)
            remaining[i_mid, f] = 0
            i = i_mid + 1
            k = 0
            while i < n_frames - 1 and k < energy_tol:
                k = k + 1 if remaining[i, f] < frame_thresh else 0
                remaining[i, f] = 0
                if f < MAX_FREQ_IDX:
                    remaining[i, f + 1] = 0
                if f > 0:
                    remaining[i, f - 1] = 0
                i += 1
            i_end = i - 1 - k
            i = i_mid - 1
            k = 0
            while i > 0 and k < energy_tol:
                k = k + 1 if remaining[i, f] < frame_thresh else 0
                remaining[i, f] = 0
                if f < MAX_FREQ_IDX:
                    remaining[i, f + 1] = 0
                if f > 0:
                    remaining[i, f - 1] = 0
                i -= 1
            i_start = i + 1 + k
            if i_end - i_start <= min_note_len:
                continue
            notes.append((int(i_start), int(i_end), int(f + MIDI_OFFSET),
                          float(np.mean(frames[i_start:i_end, f]))))
    return notes


def predict(audio, onset_thresh=0.5, frame_thresh=0.3, min_note_ms=110.0,
            min_freq=None, max_freq=None, melodia_trick=True):
    """Transcribe mono audio at AUDIO_SAMPLE_RATE.

    Returns [(start_s, end_s, midi_pitch, amplitude 0..1)] sorted by start.
    """
    out = run_inference(audio)
    min_len = int(np.round(min_note_ms / 1000 * (AUDIO_SAMPLE_RATE / FFT_HOP)))
    notes = output_to_notes(out["note"], out["onset"], onset_thresh, frame_thresh, min_len,
                            min_freq, max_freq, melodia_trick)
    times = frames_to_time(out["note"].shape[0])
    last = len(times) - 1
    events = [(float(times[min(s, last)]), float(times[min(e, last)]), p, a) for s, e, p, a in notes]
    return sorted((ev for ev in events if ev[1] > ev[0]), key=lambda ev: ev[0])
