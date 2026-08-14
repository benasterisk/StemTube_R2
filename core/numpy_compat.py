"""Restore numpy aliases removed in numpy 1.24 for madmom 0.16.1.

madmom's COMPILED module madmom/ml/hmm.pyx (TransitionModel.make_sparse,
line 191) reads np.int at runtime; text-patching site-packages
(patch_madmom.py) cannot reach compiled code, so the DBN *downbeat*
tracker (BarTransitionModel) crashes on any numpy >= 1.24 with
"module 'numpy' has no attribute 'int'". The plain beat tracker does
not hit it, which is why the failure only shows up on downbeat-aware
paths (chord detector with beats_per_bar, POC metronome preparation).

Import this module BEFORE anything that touches madmom:

    import core.numpy_compat  # noqa: F401  (must precede madmom imports)

The aliases point at the builtins, exactly what the deprecated names
meant; this is the fix numpy's own error message recommends and is a
no-op on numpy < 1.24 or madmom >= 0.17.
"""
import numpy as np

for _name, _builtin in (("int", int), ("float", float), ("bool", bool),
                        ("complex", complex), ("object", object)):
    if not hasattr(np, _name):
        setattr(np, _name, _builtin)
