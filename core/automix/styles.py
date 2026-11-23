"""Mixing styles and instrument roles of the auto remix.

A style is a starting point, not a verdict: the remix writes processed stems, and
the mixer still offers every fader, the tempo and the pitch on top of them.

Fields of a style:
  balance  loudness of each instrument family relative to the lead vocal (LU)
  tone     extra EQ bells on top of the neutral correction, (Hz, dB) per family
  comp     scales the compression depth (1.0 = standard)
  punch    drum attack lift (0..1)
  width    stereo spread of the harmonic instruments (0..1)
  verb     (vocal reverb level dB, vocal reverb time s, drum room level dB)
  master   (low shelf dB, high shelf dB, glue compression ratio)
"""

STYLES = {
    "pop": dict(
        label="Pop",
        balance=dict(drums=-2.0, bass=-3.5, guitar=-5.0, piano=-5.0, other=-7.0),
        tone=dict(vocals=[(3000, 1.5), (10000, 2.0)], drums=[(60, 1.5), (5000, 1.5)],
                  bass=[(80, 1.0)]),
        comp=1.0, punch=0.7, width=0.5, verb=(-17, 1.4, -22), master=(0.5, 1.0, 1.6)),
    "rock": dict(
        label="Rock",
        balance=dict(drums=-1.5, bass=-3.5, guitar=-1.5, piano=-7.0, other=-8.0),
        tone=dict(vocals=[(3000, 2.0)], drums=[(70, 2.0), (4000, 2.0)],
                  guitar=[(250, -1.5), (3000, 2.0)], bass=[(100, 1.0), (800, 1.0)]),
        comp=1.0, punch=0.9, width=0.65, verb=(-19, 1.0, -20), master=(0.5, 0.5, 1.6)),
    "metal": dict(
        label="Metal",
        balance=dict(drums=-1.0, bass=-4.0, guitar=-0.5, piano=-9.0, other=-9.0),
        tone=dict(vocals=[(3500, 2.5)], drums=[(60, 2.0), (350, -3.0), (5000, 4.0)],
                  guitar=[(500, -2.5), (5000, 2.5)], bass=[(250, -2.0), (1500, 2.0)]),
        comp=1.3, punch=1.0, width=0.75, verb=(-22, 0.8, -24), master=(1.0, 1.5, 2.0)),
    "soul_funk": dict(
        label="Soul / Funk",
        balance=dict(drums=-1.0, bass=-1.0, guitar=-4.0, piano=-4.5, other=-7.0),
        tone=dict(vocals=[(250, 1.0), (8000, 1.5)], drums=[(80, 1.5), (8000, 1.0)],
                  bass=[(70, 2.0), (1200, 1.0)], guitar=[(2500, 1.5)]),
        comp=0.9, punch=0.7, width=0.5, verb=(-16, 1.6, -22), master=(1.0, 0.0, 1.5)),
    "jazz": dict(
        label="Jazz",
        balance=dict(drums=-4.0, bass=-2.5, guitar=-3.0, piano=-2.0, other=-4.0),
        tone=dict(),
        comp=0.4, punch=0.3, width=0.4, verb=(-18, 1.3, -20), master=(0.0, 0.0, 1.2)),
    "acoustic_folk": dict(
        label="Acoustic / Folk",
        balance=dict(drums=-5.0, bass=-6.0, guitar=-1.5, piano=-4.0, other=-6.0),
        tone=dict(vocals=[(10000, 1.5)], guitar=[(200, -1.0), (8000, 2.0)]),
        comp=0.6, punch=0.4, width=0.5, verb=(-17, 1.5, -22), master=(0.0, 0.5, 1.3)),
    "reggae": dict(
        label="Reggae",
        balance=dict(drums=-1.5, bass=0.5, guitar=-5.0, piano=-4.5, other=-7.0),
        tone=dict(bass=[(70, 3.0), (2000, -3.0)], drums=[(80, 1.5), (6000, 1.0)],
                  guitar=[(200, -2.0), (2500, 1.5)]),
        comp=0.8, punch=0.6, width=0.55, verb=(-15, 1.2, -20), master=(1.5, -0.5, 1.5)),
    "blues": dict(
        label="Blues",
        balance=dict(drums=-3.0, bass=-4.0, guitar=-1.5, piano=-4.0, other=-7.0),
        tone=dict(vocals=[(2500, 1.0)], guitar=[(2000, 1.5)]),
        comp=0.7, punch=0.5, width=0.5, verb=(-18, 1.1, -21), master=(0.5, 0.0, 1.4)),
}
DEFAULT_STYLE = "pop"

# Stem name -> instrument family. The family decides the neutral target, the
# style balance and the style tone; unknown names fall back to "other".
FAMILY = {
    "vocals": "vocals", "backing_vocals": "vocals",
    "drums": "drums", "kick": "drums", "snare": "drums", "toms": "drums", "cymbals": "drums",
    "bass": "bass",
    "guitar": "guitar", "electric_guitar": "guitar", "acoustic_guitar": "guitar",
    "piano": "piano", "organ": "piano", "synth": "piano",
    "other": "other", "brass": "other", "winds": "other", "strings": "other",
}
HARMONIC = ("guitar", "piano", "other")

# High-pass per family (Hz); the bass also gets a low-pass.
HIGH_PASS = {"vocals": 90, "drums": 35, "bass": 35, "guitar": 80, "piano": 60, "other": 60}
BASS_LOW_PASS = 6000
MAX_BOOST = {"vocals": 12, "drums": 10, "bass": 6, "guitar": 10, "piano": 9, "other": 6}
# Compression ratio above 1 at comp = 1.0.
RATIO = {"vocals": 2.0, "bass": 3.0}

# Kit pieces (fine separation): role tone through (Hz, dB) points, level of each
# piece relative to the kick (LU), and which pieces get the attack lift.
KIT = ("kick", "snare", "toms", "cymbals")
KIT_TONE = {
    "kick": [(25, -3), (60, 3), (120, 0), (300, -4), (800, -2), (3500, 4), (6000, 2), (12000, 0)],
    "snare": [(25, -18), (100, -6), (200, 2), (500, -2), (2000, 1), (5000, 4), (10000, 3), (16000, 0)],
    "toms": [(25, -6), (100, 2), (400, -3), (4000, 3), (10000, 0)],
    "cymbals": [(25, -24), (300, -9), (600, 0), (4000, 0), (10000, 3), (16000, 2)],
}
KIT_LEVEL = {"kick": 0.0, "snare": -1.5, "toms": -6.0, "cymbals": -7.0}
KIT_PUNCH = ("kick", "snare", "toms")
BACKING_VOCALS_LEVEL = -4.0     # LU under the lead vocal
