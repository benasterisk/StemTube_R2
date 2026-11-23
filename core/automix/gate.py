"""One heavy job at a time on the shared server.

An auto remix, a pre-mix, a retimed copy or the (re)creation of the MIDI tracks of
a song keeps several cores busy for a while, and may use the GPU. On a server shared
by several users they are run one after the other, whoever asked: a job that finds
the slot taken waits for it. Stem extraction has its own queue and is not counted.
"""
import threading
from contextlib import contextmanager

_slot = threading.BoundedSemaphore(1)


@contextmanager
def heavy_job(on_wait=None):
    """Hold the slot for the duration of the block; ``on_wait()`` is called once if it is taken."""
    if not _slot.acquire(blocking=False):
        if on_wait:
            try:
                on_wait()
            except Exception:
                pass
        _slot.acquire()
    try:
        yield
    finally:
        _slot.release()
