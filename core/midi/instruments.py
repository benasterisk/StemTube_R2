"""Catalogue of the sounds a MIDI track can be played with.

An instrument id is "<engine>:<preset>":
  sf:<program>     sampled General MIDI instrument (SoundFont)
  sfkit:<preset>   sampled drum kit (SoundFont, percussion bank)
  analog:<name>    virtual analog synth          fm:<name>      FM synth
  wt:<name>        wavetable synth               pluck:<name>   plucked string model
  organ:<name>     tonewheel organ               dm:<name>      analog drum machine
Labels are shown as is in the mixer (English UI). ``slug`` turns a label into the
name of a stem (pre-mix), so a label must not read like one of the stem names of the
extraction models ("acoustic guitar", "strings"...).
"""
from . import synths

GROUPS = [
    ("sf", "Real instruments (samples)"),
    ("pluck", "Plucked strings (physical model)"),
    ("organ", "Tonewheel organ"),
    ("analog", "Analog synth"),
    ("fm", "FM synth"),
    ("wt", "Wavetable synth"),
    ("sfkit", "Drum kits (samples)"),
    ("dm", "Analog drum machine"),
]

SF = {
    0: "Grand piano", 1: "Bright piano", 4: "Electric piano (Rhodes)", 5: "Electric piano (FM)",
    6: "Harpsichord", 7: "Clavinet", 11: "Vibraphone", 12: "Marimba", 16: "Hammond organ", 18: "Rock organ",
    19: "Church organ", 21: "Accordion", 22: "Harmonica", 24: "Nylon guitar", 25: "Folk guitar (steel)",
    26: "Jazz guitar", 27: "Clean electric guitar", 28: "Muted guitar", 29: "Overdriven guitar",
    30: "Distortion guitar", 32: "Double bass", 33: "Electric bass (finger)", 34: "Electric bass (pick)",
    35: "Fretless bass", 36: "Slap bass", 38: "Synth bass", 40: "Violin", 42: "Cello",
    46: "Harp", 48: "String ensemble", 49: "Slow strings", 50: "Synth strings", 52: "Choir \u201caah\u201d",
    53: "Voice \u201cooh\u201d", 56: "Trumpet", 57: "Trombone", 60: "French horn", 61: "Brass section",
    64: "Soprano saxophone", 65: "Alto saxophone", 66: "Tenor saxophone", 68: "Oboe", 71: "Clarinet",
    73: "Flute", 75: "Pan flute", 80: "Square lead", 81: "Sawtooth lead", 89: "Warm pad",
}
SFKIT = {0: "Standard kit", 8: "Room kit", 16: "Rock kit (power)", 24: "Electronic kit",
         25: "808/909 kit (samples)", 32: "Jazz kit", 40: "Brush kit"}
ANALOG = {"bass": "Analog bass (Moog)", "acid": "Acid bass (303)", "lead": "Analog lead",
          "pad": "Analog pad", "strings": "Analog strings (string machine)",
          "brass": "Analog brass", "pluck": "Analog pluck"}
FM = {"epiano": "FM electric piano (DX)", "bass": "FM bass", "bell": "FM bells", "brass": "FM brass",
      "organ": "FM organ", "clav": "FM clavinet", "marimba": "FM marimba"}
WT = {"sweep": "Wavetable sweep", "pad": "Digital pad", "lead": "Digital lead",
      "voice": "Synthetic voice (formants)", "bass": "Wavetable bass"}
PLUCK = {"nylon": "Nylon guitar (modelled string)", "steel": "Steel guitar (modelled string)",
         "electric": "Clean electric guitar (modelled string)",
         "overdrive": "Overdriven guitar (modelled string + amp)", "bass": "Plucked bass (modelled string)",
         "harp": "Harp (modelled string)"}
ORGAN = {"jazz": "Jazz organ (888000000)", "rock": "Rock organ", "gospel": "Gospel organ",
         "church": "Pipe organ"}
DM = {"808": "TR-808 (synthesis)", "909": "TR-909 (synthesis)"}
LABELS = {"sf": SF, "sfkit": SFKIT, "analog": ANALOG, "fm": FM, "wt": WT, "pluck": PLUCK,
          "organ": ORGAN, "dm": DM}

# First entry = default. The rest are the sounds made for that kind of part.
RECOMMENDED = {
    "vocals": ["sf:53", "sf:73", "sf:65", "wt:voice", "analog:lead", "wt:lead", "sf:11"],
    "backing_vocals": ["sf:52", "sf:53", "wt:voice", "analog:pad", "wt:pad"],
    "bass": ["sf:33", "sf:34", "sf:35", "sf:32", "pluck:bass", "analog:bass", "analog:acid", "fm:bass", "wt:bass"],
    "guitar": ["sf:27", "sf:25", "sf:24", "sf:26", "sf:29", "sf:30", "pluck:electric", "pluck:steel",
               "pluck:nylon", "pluck:overdrive", "analog:pluck", "fm:clav"],
    "electric_guitar": ["sf:27", "sf:26", "sf:29", "sf:30", "sf:28", "pluck:electric", "pluck:overdrive",
                        "analog:pluck", "fm:clav"],
    "acoustic_guitar": ["sf:25", "sf:24", "pluck:steel", "pluck:nylon", "pluck:harp", "sf:46"],
    "piano": ["sf:0", "sf:1", "sf:4", "fm:epiano", "sf:5", "sf:7", "fm:clav", "sf:11", "fm:marimba"],
    "organ": ["organ:jazz", "organ:rock", "organ:gospel", "organ:church", "sf:16", "sf:18", "sf:19", "fm:organ"],
    "synth": ["analog:lead", "analog:pad", "analog:brass", "wt:sweep", "wt:pad", "wt:lead", "fm:bell", "sf:81"],
    "brass": ["sf:61", "sf:56", "sf:57", "sf:66", "sf:65", "analog:brass", "fm:brass"],
    "winds": ["sf:73", "sf:71", "sf:68", "sf:65", "sf:75", "wt:lead"],
    "strings": ["sf:48", "sf:49", "sf:40", "sf:42", "analog:strings", "analog:pad", "wt:pad"],
    "other": ["sf:48", "sf:0", "sf:4", "analog:pad", "analog:strings", "wt:pad", "fm:epiano"],
}
DRUM_RECOMMENDED = ["sfkit:0", "sfkit:8", "sfkit:16", "sfkit:32", "sfkit:40", "sfkit:24", "sfkit:25",
                    "dm:808", "dm:909"]
# General MIDI program written in the .mid file of each stem.
GM_PROGRAM = {"vocals": 53, "backing_vocals": 52, "bass": 33, "guitar": 27, "electric_guitar": 27,
              "acoustic_guitar": 25, "piano": 0, "organ": 16, "synth": 81, "brass": 61, "winds": 73,
              "strings": 48, "other": 48}


def label(instrument):
    engine, _, preset = instrument.partition(":")
    table = LABELS.get(engine, {})
    key = int(preset) if engine in ("sf", "sfkit") and preset.isdigit() else preset
    return table.get(key, instrument)


def slug(instrument):
    """Stem name made from the label of an instrument ("String ensemble" -> "string_ensemble", "Folk guitar (steel)" -> "folk_guitar")."""
    import re
    import unicodedata
    text = label(instrument).split("(")[0].strip() or label(instrument)     # the detail in brackets is dropped
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "midi"


def track_title(stem, instrument, drums):
    """Name shown for a MIDI track once the user chose its sound.

    A pitched track is what its instrument says; a kit piece stays a piece of a kit.
    """
    name = label(instrument)
    return f"{stem} · {name}" if drums and stem != "drums" else name


def track_slug(stem, instrument, drums):
    """Stem name of a MIDI track written out as audio under its own name (pre-mix)."""
    return f"{stem}_{slug(instrument)}" if drums and stem != "drums" else slug(instrument)


def exists(instrument, drums):
    engine, _, preset = instrument.partition(":")
    if drums != (engine in ("sfkit", "dm")):
        return False
    key = int(preset) if engine in ("sf", "sfkit") and preset.isdigit() else preset
    return key in LABELS.get(engine, {})


def default_for(stem, drums, soundfont=True):
    """Default sound of a stem; falls back on a built-in synth when no SoundFont player is there."""
    choices = DRUM_RECOMMENDED if drums else RECOMMENDED.get(stem, RECOMMENDED["other"])
    for c in choices:
        if soundfont or not c.startswith("sf"):
            return c
    return "dm:808" if drums else "analog:lead"


def options_for(stem, drums, soundfont=True):
    """Menu for one track: {'recommended': [...], 'groups': [{'label', 'items': [{'id','label'}]}]}."""
    def ok(i):
        return (soundfont or not i.startswith("sf")) and (synths.HAVE_NUMBA or i.split(":")[0] in ("sf", "sfkit", "dm"))
    rec = [i for i in (DRUM_RECOMMENDED if drums else RECOMMENDED.get(stem, RECOMMENDED["other"])) if ok(i)]
    groups = []
    for engine, title in GROUPS:
        if drums != (engine in ("sfkit", "dm")):
            continue
        items = [{"id": f"{engine}:{k}", "label": v} for k, v in LABELS[engine].items() if ok(f"{engine}:{k}")]
        if items:
            groups.append({"label": title, "items": items})
    return {"recommended": [{"id": i, "label": label(i)} for i in rec], "groups": groups}
