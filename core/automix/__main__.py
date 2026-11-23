"""Command line: python -m core.automix <stems_dir> <out_dir> [--style rock] [--dereverb]"""
import argparse
import json
import os

from . import DEFAULT_STYLE, STYLES, remix


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("stems_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--style", default=DEFAULT_STYLE, choices=sorted(STYLES))
    ap.add_argument("--dereverb", action="store_true", help="dry the lead vocal (downloads a model)")
    ap.add_argument("--ext", default="mp3")
    ap.add_argument("--ffmpeg", default="ffmpeg")
    args = ap.parse_args()
    paths = {}
    for name in sorted(os.listdir(args.stems_dir)):
        stem, ext = os.path.splitext(name)
        if ext.lower() in (".mp3", ".wav", ".flac") and stem not in ("drums_full", "mix"):
            paths[stem] = os.path.join(args.stems_dir, name)
    dry = None
    if args.dereverb:
        from .dereverb import dereverb as dry
    rep = remix(paths, args.out_dir, style=args.style, dereverb=dry, ext=args.ext, ffmpeg=args.ffmpeg,
                progress=lambda p, t: print(f"[{p:5.1f}] {t}", flush=True))
    print(json.dumps({k: rep[k] for k in ("cleaning", "master")}, indent=1))
    for k, v in rep["settings"].items():
        print(f"{k:16s} gain {v['gain_db']:+5.1f}  comp {v['compression_db']:4.1f}  pan {v['pan']:+.2f}")


if __name__ == "__main__":
    main()
