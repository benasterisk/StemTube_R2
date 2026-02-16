/**
 * StemTube Mobile - Music Theory Constants
 * Note names, piano intervals, chord quality maps
 * Depends on: (none — loaded first)
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const WHITE_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_KEYS = [
    { note: 'C#', anchor: 0 },
    { note: 'D#', anchor: 1 },
    { note: 'F#', anchor: 3 },
    { note: 'G#', anchor: 4 },
    { note: 'A#', anchor: 5 }
];

const PIANO_INTERVALS = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    dom7: [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    maj9: [0, 4, 7, 11, 14],
    maj11: [0, 4, 7, 11, 14, 17],
    maj13: [0, 4, 7, 11, 14, 17, 21],
    m7: [0, 3, 7, 10],
    m9: [0, 3, 7, 10, 14],
    m11: [0, 3, 7, 10, 14, 17],
    m13: [0, 3, 7, 10, 14, 17, 21],
    m7b5: [0, 3, 6, 10],
    m6: [0, 3, 7, 9],
    m6add9: [0, 3, 7, 9, 14],
    madd9: [0, 3, 7, 14],
    aug: [0, 4, 8],
    dim: [0, 3, 6],
    dim7: [0, 3, 6, 9],
    '6': [0, 4, 7, 9],
    '6add9': [0, 4, 7, 9, 14],
    '5': [0, 7],
    '9': [0, 4, 7, 10, 14],
    '11': [0, 4, 7, 10, 14, 17],
    '13': [0, 4, 7, 10, 14, 17, 21],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    sus2sus4: [0, 2, 5, 7],
    add9: [0, 4, 7, 14],
    mmaj7: [0, 3, 7, 11]
};

const DEFAULT_CHORD_MESSAGE = 'Select a chord to view the diagram.';

const QUALITY_TO_SUFFIX = {
    major: 'major',
    minor: 'minor',
    dom7: '7',
    maj7: 'maj7',
    maj9: 'maj9',
    maj11: 'maj11',
    maj13: 'maj13',
    mmaj7: 'mmaj7',
    m7: 'm7',
    m9: 'm9',
    m11: 'm11',
    m13: 'm13',
    m7b5: 'm7b5',
    m6: 'm6',
    m6add9: 'm6add9',
    add9: 'add9',
    madd9: 'madd9',
    '6': '6',
    '6add9': '6add9',
    '5': '5',
    '9': '9',
    '11': '11',
    '13': '13',
    sus2: 'sus2',
    sus4: 'sus4',
    sus2sus4: 'sus2sus4',
    aug: 'aug',
    dim: 'dim',
    dim7: 'dim7'
};

const CHORD_QUALITY_MAP = [
    { match: /^maj13/, key: 'maj13' },
    { match: /^maj11/, key: 'maj11' },
    { match: /^maj7(add)?11/, key: 'maj11' },
    { match: /^maj9/, key: 'maj9' },
    { match: /^maj7(add)?9/, key: 'maj9' },
    { match: /^maj7sus/, key: 'sus4' },
    { match: /^maj7/, key: 'maj7' },
    { match: /^ma7/, key: 'maj7' },
    { match: /^Δ7/, key: 'maj7' },
    { match: /^maj6/, key: '6' },
    { match: /^majb5/, key: 'major' },
    { match: /^maj/, key: 'major' },
    { match: /^mmaj7/, key: 'mmaj7' },
    { match: /^m13/, key: 'm13' },
    { match: /^m11/, key: 'm11' },
    { match: /^m9/, key: 'm9' },
    { match: /^m7b5/, key: 'm7b5' },
    { match: /^m7/, key: 'm7' },
    { match: /^-7/, key: 'm7' },
    { match: /^min7/, key: 'm7' },
    { match: /^m6add9/, key: 'm6add9' },
    { match: /^m6/, key: 'm6' },
    { match: /^madd9/, key: 'madd9' },
    { match: /^minor/, key: 'minor' },
    { match: /^min/, key: 'minor' },
    { match: /^m/, key: 'minor' },
    { match: /^sus2sus4/, key: 'sus2sus4' },
    { match: /^sus2/, key: 'sus2' },
    { match: /^sus4/, key: 'sus4' },
    { match: /^7sus4/, key: 'sus4' },
    { match: /^7sus2/, key: 'sus2' },
    { match: /^7sus/, key: 'sus4' },
    { match: /^7#9b5/, key: 'dom7' },
    { match: /^7#9/, key: 'dom7' },
    { match: /^7b5/, key: 'dom7' },
    { match: /^7#5/, key: 'dom7' },
    { match: /^7/, key: 'dom7' },
    { match: /^6add9/, key: '6add9' },
    { match: /^6/, key: '6' },
    { match: /^add9/, key: 'add9' },
    { match: /^9/, key: '9' },
    { match: /^11/, key: '11' },
    { match: /^13/, key: '13' },
    { match: /^aug/, key: 'aug' },
    { match: /^dim7/, key: 'dim7' },
    { match: /^dim/, key: 'dim' },
    { match: /^°/, key: 'dim' },
    { match: /^ø/, key: 'm7b5' },
    { match: /^5/, key: '5' }
];
