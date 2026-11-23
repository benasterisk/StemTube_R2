"""Minimal Standard MIDI File writer/reader (format 1), no dependency.

Notes are (start_s, end_s, pitch, velocity). Files carry the song tempo so a
sequencer shows the notes on the right bars; times are stored against that
single tempo, which is exact whatever the tempo value is.
"""
import struct

TICKS = 480


def _varlen(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def _track(events):
    """events: [(tick, bytes)] -> MTrk chunk."""
    events = sorted(events, key=lambda e: e[0])
    data = bytearray()
    last = 0
    for tick, payload in events:
        data += _varlen(max(0, tick - last)) + payload
        last = max(last, tick)
    data += b"\x00\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + bytes(data)


def write(path, tracks, bpm=120.0):
    """tracks: [{'name', 'program', 'drums', 'notes'}]."""
    bpm = float(bpm) if bpm and bpm > 20 else 120.0
    per_sec = TICKS * bpm / 60.0
    tempo = int(round(60_000_000 / bpm))
    chunks = [_track([(0, b"\xff\x51\x03" + struct.pack(">I", tempo)[1:])])]
    channel = 0
    for tr in tracks:
        if tr.get("drums"):
            ch = 9
        else:
            ch = channel
            channel += 1
            if channel == 9:
                channel = 10
            channel %= 16
        name = (tr.get("name") or "").encode("utf-8")[:120]
        ev = [(0, b"\xff\x03" + _varlen(len(name)) + name)]
        if not tr.get("drums"):
            ev.append((0, bytes([0xC0 | ch, int(tr.get("program", 0)) & 0x7F])))
        for s, e, p, v in tr["notes"]:
            on = int(round(s * per_sec))
            off = max(on + 1, int(round(e * per_sec)))
            p = int(p) & 0x7F
            # note-off sorts before a note-on on the same tick
            ev.append((on, bytes([0x90 | ch, p, max(1, min(127, int(v)))])))
            ev.append((off - 0.5, bytes([0x80 | ch, p, 0])))
        ev = [(int(t) if t == int(t) else int(t), b) for t, b in sorted(ev, key=lambda e: e[0])]
        chunks.append(_track(ev))
    with open(path, "wb") as f:
        f.write(b"MThd" + struct.pack(">IHHH", 6, 1, len(chunks), TICKS))
        for c in chunks:
            f.write(c)


def read_notes(path):
    """Read back the notes of a file written by write(): [(start_s, end_s, pitch, velocity)]."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"MThd":
        raise ValueError("Not a MIDI file")
    ticks = struct.unpack(">H", data[12:14])[0]
    pos = 14
    tempo = 500000
    notes = []
    while pos < len(data):
        if data[pos:pos + 4] != b"MTrk":
            break
        length = struct.unpack(">I", data[pos + 4:pos + 8])[0]
        p, end = pos + 8, pos + 8 + length
        tick, status, open_notes = 0, 0, {}
        while p < end:
            delta = 0
            while True:
                b = data[p]
                p += 1
                delta = (delta << 7) | (b & 0x7F)
                if not b & 0x80:
                    break
            tick += delta
            if data[p] & 0x80:
                status = data[p]
                p += 1
            if status == 0xFF:
                kind = data[p]
                p += 1
                n = 0
                while True:
                    b = data[p]
                    p += 1
                    n = (n << 7) | (b & 0x7F)
                    if not b & 0x80:
                        break
                if kind == 0x51:
                    tempo = int.from_bytes(data[p:p + 3], "big")
                p += n
            elif status in (0xF0, 0xF7):
                n = 0
                while True:
                    b = data[p]
                    p += 1
                    n = (n << 7) | (b & 0x7F)
                    if not b & 0x80:
                        break
                p += n
            else:
                kind = status & 0xF0
                if kind in (0xC0, 0xD0):
                    p += 1
                else:
                    d1, d2 = data[p], data[p + 1]
                    p += 2
                    if kind == 0x90 and d2 > 0:
                        open_notes.setdefault(d1, []).append((tick, d2))
                    elif kind in (0x80, 0x90) and open_notes.get(d1):
                        t0, vel = open_notes[d1].pop(0)
                        notes.append((t0, tick, d1, vel))
        pos = end
    sec = tempo / 1_000_000 / ticks
    return sorted(((a * sec, b * sec, p, v) for a, b, p, v in notes), key=lambda n: n[0])
