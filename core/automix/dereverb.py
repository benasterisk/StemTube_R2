"""Optional helper of the auto remix: dry the lead vocal of its room.

Model: anvuew's "dereverb_room" (BS-Roformer, mono vocals, trained on room
reverbs, GPL-3.0). The weights (~118 MB) are not shipped: they are downloaded
from Hugging Face on first use. Inference reuses the BS-Roformer code and the
chunked overlap-add of ``core.msst``. Needs ~0.3 GiB of VRAM on a GPU; it also
runs on CPU, slowly.
"""
import os
import urllib.request

import numpy as np

REPO_URL = "https://huggingface.co/anvuew/dereverb_room/resolve/main"
CONFIG_NAME = "dereverb_room_anvuew.yaml"
CKPT_NAME = "dereverb_room_anvuew_sdr_13.7432.ckpt"
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "models", "dereverb")


def _download(url, dest):
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "stemtube"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)


def ensure_weights(model_dir=MODEL_DIR):
    """Download the model files on first use. Returns (config path, checkpoint path)."""
    os.makedirs(model_dir, exist_ok=True)
    paths = []
    for name in (CONFIG_NAME, CKPT_NAME):
        dest = os.path.join(model_dir, name)
        if not os.path.exists(dest):
            _download(f"{REPO_URL}/{name}", dest)
        paths.append(dest)
    return tuple(paths)


def weights_present(model_dir=MODEL_DIR):
    return all(os.path.exists(os.path.join(model_dir, n)) for n in (CONFIG_NAME, CKPT_NAME))


def dereverb(x, device=None):
    """Return the dry version of a vocal stem, (2, n) float32 in and out (dual mono)."""
    import torch
    from core.msst.bs_roformer import BSRoformer
    from core.msst.separate import demix, load_config

    config_path, ckpt_path = ensure_weights()
    cfg = load_config(config_path)
    model = BSRoformer(**cfg["model"])
    state = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    if isinstance(state, dict) and "state_dict" in state:
        state = state["state_dict"]
    model.load_state_dict({k.removeprefix("module."): v for k, v in state.items()})
    del state
    dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    model = model.to(dev).eval()
    try:
        mono = x.mean(axis=0)[None, :].astype(np.float32)
        out = demix(model, mono, dev, cfg["audio"]["chunk_size"],
                    num_overlap=cfg["inference"]["num_overlap"])
        dry = out[0, 0].astype(np.float32)
    finally:
        del model
        if dev.type == "cuda":
            torch.cuda.empty_cache()
    return np.stack([dry, dry])
