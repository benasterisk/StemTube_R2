/**
 * Desktop Chord Display - Complete with mobile diagram code
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
    'maj#11': [0, 4, 7, 11, 14, 18],
    maj13: [0, 4, 7, 11, 14, 17, 21],
    maj7b5: [0, 4, 6, 11],
    m7: [0, 3, 7, 10],
    m9: [0, 3, 7, 10, 14],
    m11: [0, 3, 7, 10, 14, 17],
    m13: [0, 3, 7, 10, 14, 17, 21],
    'm7#5': [0, 3, 8, 10],
    m7b5: [0, 3, 6, 10],
    'm#5': [0, 3, 8],
    m6: [0, 3, 7, 9],
    m6add9: [0, 3, 7, 9, 14],
    madd9: [0, 3, 7, 14],
    mmaj7: [0, 3, 7, 11],
    mmaj9: [0, 3, 7, 11, 14],
    mmaj11: [0, 3, 7, 11, 14, 17],
    mmaj13: [0, 3, 7, 11, 14, 17, 21],
    aug: [0, 4, 8],
    aug7: [0, 4, 8, 10],
    aug9: [0, 4, 8, 10, 14],
    augmaj7: [0, 4, 8, 11],
    augmaj9: [0, 4, 8, 11, 14],
    dim: [0, 3, 6],
    dim7: [0, 3, 6, 9],
    '6': [0, 4, 7, 9],
    '6add9': [0, 4, 7, 9, 14],
    '6b5': [0, 4, 6, 9],
    '5': [0, 7],
    '7#9': [0, 4, 7, 10, 15],
    '7b9': [0, 4, 7, 10, 13],
    '7#5': [0, 4, 8, 10],
    '7b5': [0, 4, 6, 10],
    '7#9b5': [0, 4, 6, 10, 15],
    '9': [0, 4, 7, 10, 14],
    '9b5': [0, 4, 6, 10, 14],
    '9sus4': [0, 5, 7, 10, 14],
    '11': [0, 4, 7, 10, 14, 17],
    '13': [0, 4, 7, 10, 14, 17, 21],
    '7sus2': [0, 2, 7, 10],
    '7sus4': [0, 5, 7, 10],
    '7sus2sus4': [0, 2, 5, 7, 10],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    sus2sus4: [0, 2, 5, 7],
    'sus2#5': [0, 2, 8],
    'sus4#5': [0, 5, 8],
    add9: [0, 4, 7, 14]
};

const DEFAULT_CHORD_MESSAGE = 'Select a chord to view the diagram.';
const QUALITY_TO_SUFFIX = {
    major: 'major',
    minor: 'minor',
    dom7: '7',
    maj7: 'maj7',
    maj9: 'maj9',
    maj11: 'maj11',
    'maj#11': 'maj#11',
    maj13: 'maj13',
    maj7b5: 'maj7b5',
    mmaj7: 'mmaj7',
    mmaj9: 'mmaj9',
    mmaj11: 'mmaj11',
    mmaj13: 'mmaj13',
    m7: 'm7',
    m9: 'm9',
    m11: 'm11',
    m13: 'm13',
    'm7#5': 'm7#5',
    m7b5: 'm7b5',
    'm#5': 'm#5',
    m6: 'm6',
    m6add9: 'm6add9',
    add9: 'add9',
    madd9: 'madd9',
    '6': '6',
    '6add9': '6add9',
    '6b5': '6b5',
    '5': '5',
    '7#9': '7#9',
    '7b9': '7b9',
    '7#5': '7#5',
    '7b5': '7b5',
    '7#9b5': '7#9b5',
    '9': '9',
    '9b5': '9b5',
    '9sus4': '9sus4',
    '11': '11',
    '13': '13',
    '7sus2': '7sus2',
    '7sus4': '7sus4',
    '7sus2sus4': '7sus2sus4',
    sus2: 'sus2',
    sus4: 'sus4',
    sus2sus4: 'sus2sus4',
    'sus2#5': 'sus2#5',
    'sus4#5': 'sus4#5',
    aug: 'aug',
    aug7: 'aug7',
    aug9: 'aug9',
    augmaj7: 'augmaj7',
    augmaj9: 'augmaj9',
    dim: 'dim',
    dim7: 'dim7'
};

const CHORD_QUALITY_MAP = [
    // Augmented chords (most specific first)
    { match: /^augmaj9/, key: 'augmaj9' },
    { match: /^augmaj7/, key: 'augmaj7' },
    { match: /^aug9/, key: 'aug9' },
    { match: /^aug7/, key: 'aug7' },
    { match: /^aug/, key: 'aug' },
    { match: /^\+maj9/, key: 'augmaj9' },
    { match: /^\+maj7/, key: 'augmaj7' },
    { match: /^\+9/, key: 'aug9' },
    { match: /^\+7/, key: 'aug7' },
    { match: /^\+/, key: 'aug' },

    // Major extended chords
    { match: /^maj13/, key: 'maj13' },
    { match: /^maj#11/, key: 'maj#11' },
    { match: /^maj11/, key: 'maj11' },
    { match: /^maj7(add)?11/, key: 'maj11' },
    { match: /^maj9/, key: 'maj9' },
    { match: /^maj7(add)?9/, key: 'maj9' },
    { match: /^maj7sus4#5/, key: 'sus4' },
    { match: /^maj7sus2sus4/, key: 'sus2sus4' },
    { match: /^maj7sus4/, key: 'sus4' },
    { match: /^maj7sus2/, key: 'sus2' },
    { match: /^maj7sus/, key: 'sus4' },
    { match: /^maj7b5/, key: 'maj7b5' },
    { match: /^maj7/, key: 'maj7' },
    { match: /^ma7/, key: 'maj7' },
    { match: /^Δ7/, key: 'maj7' },
    { match: /^M7/, key: 'maj7' },
    { match: /^maj6/, key: '6' },
    { match: /^majb5/, key: 'major' },
    { match: /^maj/, key: 'major' },

    // Minor major chords (melodic minor)
    { match: /^mmaj13/, key: 'mmaj13' },
    { match: /^mmaj11/, key: 'mmaj11' },
    { match: /^mmaj9/, key: 'mmaj9' },
    { match: /^mmaj7#5/, key: 'mmaj7' },
    { match: /^mmaj7/, key: 'mmaj7' },
    { match: /^mM7/, key: 'mmaj7' },
    { match: /^m\(maj7\)/, key: 'mmaj7' },

    // Minor extended chords
    { match: /^m13/, key: 'm13' },
    { match: /^m11/, key: 'm11' },
    { match: /^m9/, key: 'm9' },
    { match: /^m7#5/, key: 'm7#5' },
    { match: /^m7b5/, key: 'm7b5' },
    { match: /^m7/, key: 'm7' },
    { match: /^-7/, key: 'm7' },
    { match: /^min7/, key: 'm7' },
    { match: /^m6add9/, key: 'm6add9' },
    { match: /^m6/, key: 'm6' },
    { match: /^m#5/, key: 'm#5' },
    { match: /^madd9/, key: 'madd9' },
    { match: /^minor/, key: 'minor' },
    { match: /^min/, key: 'minor' },
    { match: /^m/, key: 'minor' },
    { match: /^-/, key: 'minor' },

    // Dominant 7 sus chords
    { match: /^7sus2sus4/, key: '7sus2sus4' },
    { match: /^7sus4#5/, key: '7sus4' },
    { match: /^7sus4/, key: '7sus4' },
    { match: /^7sus2#5/, key: '7sus2' },
    { match: /^7sus2/, key: '7sus2' },
    { match: /^7sus/, key: '7sus4' },

    // Dominant 7 altered chords (most specific first)
    { match: /^7#9b5/, key: '7#9b5' },
    { match: /^7#9#5/, key: '7#9' },
    { match: /^7#9/, key: '7#9' },
    { match: /^7b9b5/, key: '7b9' },
    { match: /^7b9#5/, key: '7b9' },
    { match: /^7b9/, key: '7b9' },
    { match: /^7#5/, key: '7#5' },
    { match: /^7b5/, key: '7b5' },
    { match: /^7alt/, key: '7#9b5' },
    { match: /^7/, key: 'dom7' },

    // Extended dominant chords
    { match: /^13b5/, key: '13' },
    { match: /^13#5/, key: '13' },
    { match: /^13/, key: '13' },
    { match: /^11/, key: '11' },
    { match: /^9sus4/, key: '9sus4' },
    { match: /^9b5/, key: '9b5' },
    { match: /^9#5/, key: '9' },
    { match: /^9/, key: '9' },

    // Major 6 chords
    { match: /^6add9/, key: '6add9' },
    { match: /^6b5/, key: '6b5' },
    { match: /^6/, key: '6' },

    // Sus chords
    { match: /^sus2sus4/, key: 'sus2sus4' },
    { match: /^sus4#5/, key: 'sus4#5' },
    { match: /^sus2#5/, key: 'sus2#5' },
    { match: /^sus4/, key: 'sus4' },
    { match: /^sus2/, key: 'sus2' },
    { match: /^sus/, key: 'sus4' },

    // Add chords
    { match: /^add9/, key: 'add9' },
    { match: /^add11/, key: 'add9' },
    { match: /^add/, key: 'add9' },

    // Diminished chords
    { match: /^dim7/, key: 'dim7' },
    { match: /^dim/, key: 'dim' },
    { match: /^°7/, key: 'dim7' },
    { match: /^°/, key: 'dim' },
    { match: /^o7/, key: 'dim7' },
    { match: /^o/, key: 'dim' },

    // Half-diminished
    { match: /^ø7/, key: 'm7b5' },
    { match: /^ø/, key: 'm7b5' },

    // Power chord
    { match: /^5/, key: '5' }
];
function readCssVariable(varName, fallback) {
    try {
        const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
        return value && value.trim() ? value.trim() : fallback;
    } catch (err) {
        return fallback;
    }
}

class GuitarDiagramSettings {
    constructor() {
        const text = readCssVariable('--mobile-text', '#f5f5f5');
        const secondary = readCssVariable('--mobile-text-secondary', '#b5b5b5');
        const accent = readCssVariable('--mobile-primary', '#5ce1a5');
        const border = readCssVariable('--mobile-border', 'rgba(255,255,255,0.2)');

        this.stringSpace = 42;
        this.fretSpace = 46;
        this.fontFamily = 'Inter, "SF Pro Display", "Segoe UI", sans-serif';
        this.fingering = {
            color: '#04150d',
            margin: 1.5,
            size: 13,
            visible: true
        };
        this.dot = {
            radius: 11,
            borderWidth: 2,
            fillColor: accent,
            strokeColor: accent,
            openStringRadius: 6
        };
        this.neck = {
            useRoman: true,
            color: 'rgba(255,255,255,0.02)',
            nut: {
                color: text,
                visible: true,
                width: 3.2
            },
            grid: {
                color: border,
                width: 1.2,
                visible: true
            },
            stringName: {
                color: secondary,
                size: 12,
                margin: 6,
                visible: true
            },
            baseFret: {
                color: secondary,
                size: 14,
                margin: 10,
                visible: true
            },
            stringInfo: {
                color: secondary,
                size: 12,
                margin: 5,
                visible: true
            }
        };
    }
}

class GuitarChordDiagram {
    constructor(data = {}) {
        this.frets = Array.isArray(data.frets) ? data.frets.slice(0, 6) : [];
        this.fingers = Array.isArray(data.fingers) ? data.fingers.slice(0, 6) : [];
        this.baseFret = Number.isFinite(data.baseFret) && data.baseFret > 0 ? data.baseFret : 1;
        while (this.frets.length < 6) this.frets.push(0);
        while (this.fingers.length < 6) this.fingers.push(0);
    }

    getBarres() {
        const barres = [];
        if (!this.fingers.some(f => f > 0)) return barres;

        const dots = this.frets.map((fret, idx) => [fret, this.fingers[idx]]);
        const uniqueFrets = this.frets
            .filter((value, index, self) => value > 0 && self.indexOf(value) === index)
            .sort((a, b) => a - b);

        uniqueFrets.forEach(fret => {
            for (let index = 0; index < dots.length; index++) {
                const dot = dots[index];
                if (dot[0] !== fret) continue;
                const startString = index;
                const finger = dot[1];
                let total = 1;
                while (++index < dots.length && (dots[index][0] >= fret || dots[index][0] === -1)) {
                    if (dots[index][0] === fret) {
                        if (dots[index][1] !== finger) continue;
                        total++;
                    }
                }
                if (total > 1) {
                    barres.push({
                        fret,
                        startString,
                        endString: index - 1
                    });
                }
            }
        });

        return barres;
    }
}

class GuitarDiagramHelper {
    static createSVG(name, attrs = {}, dash = false) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', name);
        Object.keys(attrs).forEach(key => {
            if (attrs[key] === undefined || attrs[key] === null) return;
            const attrName = dash ? key.replace(/[A-Z]/g, m => '-' + m.toLowerCase()) : key;
            node.setAttribute(attrName, attrs[key].toString());
        });
        return node;
    }

    static appendText(node, value) {
        node.appendChild(document.createTextNode(value));
        return node;
    }
}

class GuitarDiagramBuilder {
    constructor() {
        this.settings = new GuitarDiagramSettings();
        this.instrument = {
            stringsCount: 6,
            fretsOnDiagram: 5,
            name: 'Guitar',
            tuning: ['E', 'A', 'D', 'G', 'B', 'E']
        };
    }

    build(chordData, options = {}) {
        const chord = chordData instanceof GuitarChordDiagram ? chordData : new GuitarChordDiagram(chordData);
        const rows = Number.isFinite(options.rows) ? Math.max(4, Math.min(6, options.rows)) : this.instrument.fretsOnDiagram;
        return this.buildSvg(chord, rows);
    }

    buildSvg(chord, fretsOnChord) {
        const settings = this.settings;
        const stringsCount = this.instrument.stringsCount;
        const baseFret = chord.baseFret > 0 ? chord.baseFret : 1;

        const stringsWidth = (stringsCount - 1) * settings.stringSpace;
        const fretsHeight = fretsOnChord * settings.fretSpace;
        const hasStringNames = !!settings.neck.stringName.visible;

        const horizontalPad = Math.max(14, settings.stringSpace * 0.65);
        const topPad = Math.max(28, settings.fretSpace * 0.9);
        const bottomExtra = hasStringNames
            ? settings.neck.stringName.margin + settings.neck.stringName.size + settings.stringSpace * 0.2
            : 20;
        const bottomPad = Math.max(32, settings.fretSpace) + bottomExtra;

        const viewBoxWidth = stringsWidth + horizontalPad * 2;
        const viewBoxHeight = fretsHeight + topPad + bottomPad;
        const translateX = horizontalPad;
        const translateY = topPad;

        const svg = GuitarDiagramHelper.createSVG('svg', {
            class: 'chordproject-diagram',
            width: '100%',
            'font-family': settings.fontFamily,
            preserveAspectRatio: 'xMidYMid meet',
            viewBox: `0 0 ${viewBoxWidth} ${viewBoxHeight}`
        });

        const root = GuitarDiagramHelper.createSVG('g', { transform: `translate(${translateX}, ${translateY})` });

        root.appendChild(this.buildNeck(stringsCount, fretsOnChord, baseFret));

        const barres = chord.getBarres();
        if (barres.length) {
            barres.forEach(barre => root.appendChild(this.buildBarre(barre)));
        }

        this.buildDots(chord).forEach(dot => root.appendChild(dot));

        svg.appendChild(root);
        return svg;
    }

    buildNeck(stringsCount, fretsOnChord, baseFret) {
        const s = this.settings;
        const group = GuitarDiagramHelper.createSVG('g', { class: 'neck' });
        const width = s.stringSpace * (stringsCount - 1);
        const height = s.fretSpace * fretsOnChord;

        group.appendChild(GuitarDiagramHelper.createSVG('rect', {
            x: 0,
            y: 0,
            width,
            height,
            fill: s.neck.color
        }));

        const path = this.getNeckPath(stringsCount, fretsOnChord);
        group.appendChild(GuitarDiagramHelper.createSVG('path', {
            stroke: s.neck.grid.visible ? s.neck.grid.color : 'transparent',
            strokeWidth: s.neck.grid.width,
            strokeLinecap: 'square',
            d: path
        }));

        if (baseFret === 1) {
            group.appendChild(GuitarDiagramHelper.createSVG('path', {
                stroke: s.neck.nut.color,
                strokeWidth: s.neck.nut.width,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                d: `M 0 ${-s.neck.nut.width / 2} H ${(stringsCount - 1) * s.stringSpace}`
            }));
        } else if (s.neck.baseFret.visible) {
            const text = GuitarDiagramHelper.createSVG('text', {
                fontSize: s.neck.baseFret.size,
                fill: s.neck.baseFret.color,
                dominantBaseline: 'middle',
                textAnchor: 'end',
                x: -(s.neck.baseFret.margin + (s.stringSpace * 0.4)),
                y: s.fretSpace / 2
            });
            group.appendChild(GuitarDiagramHelper.appendText(text, this.getBaseFretText(baseFret)));
        }

        if (s.neck.stringName.visible) {
            const tuningGroup = GuitarDiagramHelper.createSVG('g');
            this.instrument.tuning.forEach((note, index) => {
                const text = GuitarDiagramHelper.createSVG('text', {
                    textAnchor: 'middle',
                    dominantBaseline: 'hanging',
                    fontSize: s.neck.stringName.size,
                    fill: s.neck.stringName.color,
                    x: index * s.stringSpace,
                    y: fretsOnChord * s.fretSpace + s.neck.stringName.margin
                });
                tuningGroup.appendChild(GuitarDiagramHelper.appendText(text, note));
            });
            group.appendChild(tuningGroup);
        }

        return group;
    }

    buildDots(chord) {
        const hasNut = chord.baseFret === 1;
        return chord.frets.map((value, index) => this.buildDot(index, value, chord.fingers[index] || 0, hasNut));
    }

    buildDot(index, fret, finger, hasNut) {
        const s = this.settings;
        const cx = index * s.stringSpace;
        const cy = fret * s.fretSpace - s.fretSpace / 2;

        if (fret === -1) {
            const text = GuitarDiagramHelper.createSVG('text', {
                fontSize: s.neck.stringInfo.size,
                fill: s.neck.stringInfo.color,
                textAnchor: 'middle',
                dominantBaseline: 'auto',
                x: cx,
                y: hasNut ? -s.neck.nut.width - s.neck.stringInfo.margin : -s.neck.stringInfo.margin
            }, true);
            return GuitarDiagramHelper.appendText(text, 'X');
        }

        if (fret === 0) {
            const circle = GuitarDiagramHelper.createSVG('circle', {
                fill: 'transparent',
                strokeWidth: s.dot.borderWidth,
                stroke: s.dot.strokeColor,
                cx,
                cy: hasNut
                    ? -s.neck.nut.width - s.neck.stringInfo.margin - s.dot.openStringRadius
                    : -s.neck.stringInfo.margin - s.dot.openStringRadius,
                r: s.dot.openStringRadius
            });
            return circle;
        }

        const group = GuitarDiagramHelper.createSVG('g');
        const circleElement = GuitarDiagramHelper.createSVG('circle', {
            fill: s.dot.fillColor,
            strokeWidth: s.dot.borderWidth,
            stroke: s.dot.strokeColor,
            cx,
            cy,
            r: s.dot.radius
        });
        group.appendChild(circleElement);

        if (finger > 0 && this.settings.fingering.visible) {
            const text = GuitarDiagramHelper.createSVG('text', {
                fill: this.settings.fingering.color,
                fontSize: this.settings.fingering.size,
                textAnchor: 'middle',
                dominantBaseline: 'central',
                alignmentBaseline: 'central',
                x: cx,
                y: cy
            }, true);
            text.setAttribute('font-weight', '600');
            group.appendChild(GuitarDiagramHelper.appendText(text, finger.toString()));
        }

        return group;
    }

    buildBarre(barreData) {
        const s = this.settings;
        const span = Math.max(1, barreData.endString - barreData.startString);
        const rectX = barreData.startString * s.stringSpace;
        const rectY = barreData.fret * s.fretSpace - s.fretSpace / 2 - s.dot.radius;
        return GuitarDiagramHelper.createSVG('rect', {
            x: rectX,
            y: rectY,
            width: span * s.stringSpace + s.dot.radius,
            height: s.dot.radius * 2,
            fill: s.dot.fillColor,
            rx: s.dot.radius,
            ry: s.dot.radius / 1.5,
            opacity: 0.9
        });
    }

    getBaseFretText(baseFret) {
        if (!this.settings.neck.useRoman) {
            return `${baseFret}fr`;
        }
        const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
        return roman[baseFret - 1] || `${baseFret}fr`;
    }

    getNeckPath(stringsCount, fretsOnChord) {
        const horizontal = Array.from({ length: fretsOnChord + 1 }, (_, pos) =>
            `M 0 ${pos * this.settings.fretSpace} H ${(stringsCount - 1) * this.settings.stringSpace}`
        ).join(' ');
        const vertical = Array.from({ length: stringsCount }, (_, pos) =>
            `M ${pos * this.settings.stringSpace} 0 V ${fretsOnChord * this.settings.fretSpace}`
        ).join(' ');
        return `${horizontal} ${vertical}`;
    }
}


// ChordDisplay class with mobile methods
class ChordDisplay {
    constructor(mixer) {
        this.mixer = mixer;
        this.isEnabled = false;
        this.chords = [];
        this.chordSegments = [];
        this.chordElements = [];
        this.currentChordIndex = -1;
        this.currentTime = 0;
        this.duration = 300;
        this.currentBPM = 120;
        this.originalBPM = 120;
        this.beatsPerBar = 4;
        this.beatOffset = 0;
        this.currentPitchShift = 0;
        this.chordBPM = 120;
        this.chordPxPerBeat = 40;
        this.chordScrollContainer = null;
        this.chordTrackElement = null;
        this.playheadIndicator = null;
        this.chordDiagramEl = null;
        this.chordDiagramPrevEl = null;
        this.chordDiagramNextEl = null;
        this.chordDiagramMode = "guitar";
        this.currentChordSymbol = null;
        this.prevChordSymbol = null;
        this.nextChordSymbol = null;
        this.chordInstrumentButtons = [];
        this.guitarDiagramCache = new Map();
        this.guitarDiagramCacheLimit = 100;
        this.guitarDiagramBuilder = null;
    }

    // Prevent manual horizontal scroll while allowing programmatic scrollTo()
    preventManualHorizontalScroll(scrollContainer) {
        if (!scrollContainer) return;

        // Block horizontal wheel scroll
        scrollContainer.addEventListener('wheel', (e) => {
            // If scrolling horizontally (shift+wheel or trackpad horizontal swipe)
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                e.preventDefault();
            }
        }, { passive: false });

        // Block horizontal touch scroll on mobile
        let touchStartX = 0;
        let touchStartY = 0;

        scrollContainer.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        scrollContainer.addEventListener('touchmove', (e) => {
            if (!e.touches.length) return;

            const touchX = e.touches[0].clientX;
            const touchY = e.touches[0].clientY;
            const deltaX = Math.abs(touchX - touchStartX);
            const deltaY = Math.abs(touchY - touchStartY);

            // If horizontal swipe is stronger than vertical
            if (deltaX > deltaY && deltaX > 10) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    // Methods from mobile-app.js
        displayChords() {
            const container = document.getElementById('mobileChordTimeline');
            if (!container || !this.chords.length) {
                if (container) container.innerHTML = '<p class="mobile-text-muted">No chords detected</p>';
                this.setChordDiagramMessage('No chord data available.');
                this.chordSegments = [];
                return;
            }

            if (!this.chordDiagramEl) {
                this.chordDiagramEl = document.getElementById('mobileChordDiagram');
            }
            this.setupChordInstrumentToggle();

            const bpm = this.chordBPM || this.currentBPM || this.originalBPM || 120;
            const beatsPerBar = Math.max(2, Math.min(12, this.beatsPerBar || 4));
            const beatDuration = 60 / bpm;
            const measureSeconds = beatDuration * beatsPerBar;

            this.chordPxPerBeat = 100; // Fixed width per beat for grid
            this.chordBPM = bpm;
            this.chordSegments = [];
            this.chordElements = [];
            this.beatElements = []; // All beat elements including empty ones
            this.currentChordIndex = -1;

            // Apply beatOffset to align chord timestamps with the beat grid
            const offset = this.beatOffset || 0;

            // Quantize chords to nearest STRONG beat (1 or 3) with beatOffset
            const quantizedChords = [...this.chords].map(chord => {
                const originalTime = (chord.timestamp || 0) - offset;

                // Find the measure this chord belongs to
                const measureIndex = Math.floor(Math.max(0, originalTime) / measureSeconds);
                const measureStart = measureIndex * measureSeconds;

                // Strong beats are at 0 (beat 1) and 2*beatDuration (beat 3)
                const beat1Time = measureStart;
                const beat3Time = measureStart + (2 * beatDuration);

                // Check distance to each strong beat
                const distToBeat1 = Math.abs(originalTime - beat1Time);
                const distToBeat3 = Math.abs(originalTime - beat3Time);

                // Tolerance: snap to strong beat if within 0.7 of a beat duration
                const strongBeatTolerance = beatDuration * 0.7;

                let quantizedTime;
                if (distToBeat1 <= strongBeatTolerance) {
                    quantizedTime = beat1Time;
                } else if (distToBeat3 <= strongBeatTolerance) {
                    quantizedTime = beat3Time;
                } else {
                    // Fall back to nearest beat
                    quantizedTime = Math.round(originalTime / beatDuration) * beatDuration;
                }

                return {
                    ...chord,
                    timestamp: Math.max(0, quantizedTime),
                    originalTimestamp: chord.timestamp
                };
            }).sort((a, b) => a.timestamp - b.timestamp);

            // Build chordSegments for diagram display
            quantizedChords.forEach((chord, index) => {
                this.chordSegments.push({
                    chord: chord.chord || '',
                    start: chord.timestamp,
                    end: quantizedChords[index + 1]?.timestamp ?? this.duration,
                    sourceIndex: index
                });
            });

            // Calculate total measures needed
            const totalDuration = this.duration || 180;
            const totalMeasures = Math.ceil(totalDuration / measureSeconds);

            // Create ALL measures with beat slots
            const measures = [];
            let lastActiveChord = '';
            let chordIndex = 0;

            for (let measureNum = 0; measureNum < totalMeasures; measureNum++) {
                const measureStartTime = measureNum * measureSeconds;
                const measure = {
                    number: measureNum + 1,
                    startTime: measureStartTime,
                    beats: []
                };

                for (let beat = 0; beat < beatsPerBar; beat++) {
                    const beatTime = measureStartTime + (beat * beatDuration);

                    // Find chord active at this beat
                    while (chordIndex < quantizedChords.length - 1 &&
                           quantizedChords[chordIndex + 1].timestamp <= beatTime + 0.01) {
                        chordIndex++;
                    }

                    const activeChord = quantizedChords[chordIndex];
                    const chordName = activeChord?.chord || '';

                    // Check if chord changes at this beat
                    if (chordName && chordName !== lastActiveChord) {
                        measure.beats.push({
                            chord: chordName,
                            timestamp: beatTime,
                            index: chordIndex,
                            sourceIndex: chordIndex,
                            empty: false
                        });
                        lastActiveChord = chordName;
                    } else {
                        measure.beats.push({
                            empty: true,
                            currentChord: lastActiveChord,
                            timestamp: beatTime
                        });
                    }
                }

                measures.push(measure);
            }

            // Get lyrics if available
            const lyrics = this.mixer?.lyricsDisplay?.lyrics || window.EXTRACTION_INFO?.lyrics_data;
            const lyricsArray = lyrics ? (typeof lyrics === 'string' ? JSON.parse(lyrics) : lyrics) : [];

            // Render the linear grid view
            container.innerHTML = '';
            const scroll = document.createElement('div');
            scroll.className = 'chord-linear-scroll';

            const track = document.createElement('div');
            track.className = 'chord-linear-track';

            measures.forEach((measure, measureIndex) => {
                const measureEl = document.createElement('div');
                measureEl.className = 'chord-linear-measure';
                measureEl.dataset.measureNumber = measure.number;
                measureEl.dataset.startTime = measure.startTime;

                // Chord grid row
                const chordRow = document.createElement('div');
                chordRow.className = 'chord-linear-chord-row';

                measure.beats.forEach((beat, beatIndex) => {
                    const beatEl = document.createElement('div');
                    beatEl.className = 'chord-linear-beat';

                    // Calculate beat timestamp
                    const beatDuration = measureSeconds / beatsPerBar;
                    const beatTimestamp = measure.startTime + (beatIndex * beatDuration);

                    beatEl.dataset.beatTime = beatTimestamp;
                    beatEl.dataset.measureIndex = measureIndex;
                    beatEl.dataset.beatIndex = beatIndex;

                    if (beat.empty) {
                        beatEl.classList.add('empty');
                        beatEl.innerHTML = '<div class="chord-linear-beat-name">—</div>';
                        // Store the current chord for empty beats
                        beatEl.dataset.currentChord = beat.currentChord || '';
                    } else {
                        beatEl.dataset.index = beat.sourceIndex;
                        beatEl.dataset.timestamp = beat.timestamp;
                        beatEl.dataset.currentChord = beat.chord;
                        const transposedChord = this.transposeChord(beat.chord, this.currentPitchShift);
                        beatEl.innerHTML = `<div class="chord-linear-beat-name">${transposedChord}</div>`;

                        this.chordElements.push(beatEl);
                    }

                    beatEl.addEventListener('click', () => this.seek(beatTimestamp));
                    this.beatElements.push(beatEl);

                    chordRow.appendChild(beatEl);
                });

                measureEl.appendChild(chordRow);

                // Lyrics row
                const lyricsRow = document.createElement('div');
                lyricsRow.className = 'chord-linear-lyrics-row';

                // Find lyrics that fall in this measure
                const measureEndTime = measure.startTime + measureSeconds;
                const measureLyrics = lyricsArray.filter(lyric => {
                    const lyricTime = lyric.start || 0;
                    return lyricTime >= measure.startTime && lyricTime < measureEndTime;
                });

                if (measureLyrics.length > 0) {
                    const lyricsText = measureLyrics.map(l => l.text || '').join(' ');
                    lyricsRow.textContent = lyricsText;
                } else {
                    lyricsRow.innerHTML = '&nbsp;';
                }

                measureEl.appendChild(lyricsRow);
                track.appendChild(measureEl);
            });

            // Add playhead
            this.playheadIndicator = document.createElement('div');
            this.playheadIndicator.className = 'chord-linear-playhead';
            track.appendChild(this.playheadIndicator);

            scroll.appendChild(track);
            container.appendChild(scroll);

            this.chordScrollContainer = scroll;
            this.chordTrackElement = track;

            // Block manual horizontal scroll while allowing code-controlled scrollTo()
            this.preventManualHorizontalScroll(scroll);

            this.syncChordPlayhead(true);
            const firstSegmentChord = this.chordSegments[0]?.chord || this.chords[0]?.chord || '';
            const thirdSegmentChord = this.chordSegments[2]?.chord || this.chords[2]?.chord || ''; // Anticipate 2 beats ahead
            const initialChordSymbol = this.currentChordSymbol || this.transposeChord(firstSegmentChord, this.currentPitchShift);
            const initialNextSymbol = this.transposeChord(thirdSegmentChord, this.currentPitchShift);
            this.renderChordDiagramCarousel('', initialChordSymbol, initialNextSymbol);
        }
    
        preloadChordDiagrams(maxChords = 40) {
            if (!Array.isArray(this.chords) || !this.chords.length) return;
            const seen = new Set();
            const tasks = [];
            for (const entry of this.chords) {
                if (tasks.length >= maxChords) break;
                const symbol = (entry?.chord || '').trim();
                if (!symbol || seen.has(symbol)) continue;
                const parsed = this.parseChordSymbol(symbol);
                if (!parsed) continue;
                const root = this.normalizeNoteName(parsed.root);
                const suffixCandidates = Array.isArray(parsed.suffixCandidates) && parsed.suffixCandidates.length
                    ? parsed.suffixCandidates
                    : [this.getSuffixForQuality(parsed.quality)];
                seen.add(symbol);
                tasks.push(
                    this.loadGuitarChordPositions(root, suffixCandidates).catch(() => {})
                );
            }
            if (tasks.length) {
                Promise.allSettled(tasks).catch(() => {});
            }
        }
    
        isChordTimelineVisible() {
            if (!this.chordScrollContainer) return true;
            const rect = this.chordScrollContainer.getBoundingClientRect();
            const viewHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            return rect.bottom > 0 && rect.top < viewHeight * 0.7;
        }
    
        syncChordPlayhead(force = false) {
            if (!this.beatElements || !this.beatElements.length) return;

            // Find current beat based on actual time (no tempo adjustment needed - timestamps are in original time)
            const currentTime = this.currentTime - (this.beatOffset || 0);
            const beatIdx = this.getBeatIndexForTime(currentTime);
            if (beatIdx === -1) return;

            // Highlight the beat
            if (force || beatIdx !== this.currentChordIndex) {
                this.currentChordIndex = beatIdx;
                this.highlightBeat(beatIdx);
            }

            // Scroll to keep highlighted beat in 4th position (using actual DOM position)
            if (this.chordScrollContainer) {
                const activeBeat = this.beatElements[beatIdx];
                if (activeBeat) {
                    // Get the actual position of the beat element in the DOM
                    const beatLeft = activeBeat.offsetLeft;

                    // Fixed position at 4th beat (300px from left edge of viewport)
                    const fixedPlayheadPos = 3 * 100;

                    // Scroll so the active beat appears at the fixed position
                    const targetScroll = Math.max(0, beatLeft - fixedPlayheadPos);

                    this.chordScrollContainer.scrollTo({
                        left: targetScroll,
                        behavior: 'auto'
                    });
                }
            }
        }
    
        getBeatIndexForTime(time) {
            if (!this.beatElements || !this.beatElements.length) return -1;

            // Find which beat element contains this time
            for (let i = 0; i < this.beatElements.length; i++) {
                const beatEl = this.beatElements[i];
                const beatTime = parseFloat(beatEl.dataset.beatTime);
                const nextBeatTime = i < this.beatElements.length - 1
                    ? parseFloat(this.beatElements[i + 1].dataset.beatTime)
                    : this.duration;

                if (time >= beatTime && time < nextBeatTime) {
                    return i;
                }
            }

            // Return last beat if time is beyond all beats
            return this.beatElements.length - 1;
        }

        getChordIndexForTime(time) {
            const segments = this.chordSegments.length ? this.chordSegments : null;
            if (!segments || !segments.length) return -1;
            const offsetTime = time - (this.beatOffset || 0);
            for (let i = segments.length - 1; i >= 0; i--) {
                const start = segments[i].start || 0;
                const end = segments[i].end ?? this.duration;
                if (offsetTime >= start && offsetTime < end) return i;
            }
            return segments.length - 1;
        }
    
        highlightBeat(beatIndex) {
            if (!this.beatElements || !this.beatElements.length) return;

            const active = this.beatElements[beatIndex];
            if (!active) return;

            // Remove active class from all beats
            this.beatElements.forEach(el => el.classList.remove('active'));
            active.classList.add('active');

            // Highlight parent measure
            const measures = this.chordTrackElement?.querySelectorAll('.chord-linear-measure');
            if (measures) {
                measures.forEach(m => m.classList.remove('active'));
                const parentMeasure = active.closest('.chord-linear-measure');
                if (parentMeasure) parentMeasure.classList.add('active');
            }

            // Get the current, previous, and next chords
            // Anticipate 2 beats ahead for better preparation time
            const currentChordName = active.dataset.currentChord || '';
            const prevBeat = this.beatElements[beatIndex - 1];
            const nextBeat = this.beatElements[beatIndex + 2]; // Anticipate 2 beats ahead

            const prevChordName = prevBeat ? (prevBeat.dataset.currentChord || '') : '';
            const nextChordName = nextBeat ? (nextBeat.dataset.currentChord || '') : '';

            if (currentChordName) {
                const transposedCurrent = this.transposeChord(currentChordName, this.currentPitchShift);
                const transposedPrev = prevChordName ? this.transposeChord(prevChordName, this.currentPitchShift) : '';
                const transposedNext = nextChordName ? this.transposeChord(nextChordName, this.currentPitchShift) : '';

                this.currentChordSymbol = transposedCurrent;
                this.prevChordSymbol = transposedPrev;
                this.nextChordSymbol = transposedNext;

                this.renderChordDiagramCarousel(transposedPrev, transposedCurrent, transposedNext);
            }
        }

        highlightChord(index) {
            if (!this.chordElements || !this.chordElements.length) return;

            // Don't highlight if this is an empty slot
            const active = this.chordElements[index];
            if (!active || active.classList.contains('empty')) return;

            this.chordElements.forEach(el => el.classList.remove('active'));
            active.classList.add('active');

            // Highlight parent measure
            const measures = this.chordTrackElement?.querySelectorAll('.chord-linear-measure');
            if (measures) {
                measures.forEach(m => m.classList.remove('active'));
                const parentMeasure = active.closest('.chord-linear-measure');
                if (parentMeasure) parentMeasure.classList.add('active');
            }

            const chordSource = this.chordSegments[index] || this.chords[index] || null;
            const chordName = this.transposeChord(chordSource?.chord || '', this.currentPitchShift);
            this.currentChordSymbol = chordName;
            this.renderChordDiagram(chordName);
        }
    
        updateChordLabels() {
            this.setupChordInstrumentToggle();
            if (!this.chordElements || !this.chordElements.length) {
                const firstChord = this.chordSegments[0]?.chord || this.chords[0]?.chord;
                const thirdChord = this.chordSegments[2]?.chord || this.chords[2]?.chord; // Anticipate 2 beats ahead
                if (firstChord) {
                    const chordName = this.transposeChord(firstChord, this.currentPitchShift);
                    const nextChordName = thirdChord ? this.transposeChord(thirdChord, this.currentPitchShift) : '';
                    this.currentChordSymbol = chordName;
                    this.renderChordDiagramCarousel('', chordName, nextChordName);
                } else {
                    this.setChordDiagramMessage(DEFAULT_CHORD_MESSAGE);
                }
                return;
            }
            if (!this.chordElements) return;
            this.chordElements.forEach((el, idx) => {
                const chord = this.chordSegments[idx]?.chord || el.dataset.chord || el.dataset.currentChord || '';
                const name = el.querySelector('.chord-linear-beat-name');
                if (name) name.textContent = this.transposeChord(chord, this.currentPitchShift);
            });
            if (typeof this.currentChordIndex === 'number' && this.currentChordIndex >= 0 && this.beatElements) {
                const currentBeat = this.beatElements[this.currentChordIndex];
                const prevBeat = this.beatElements[this.currentChordIndex - 1];
                const nextBeat = this.beatElements[this.currentChordIndex + 2]; // Anticipate 2 beats ahead

                const currentChordName = currentBeat?.dataset.currentChord || '';
                const prevChordName = prevBeat?.dataset.currentChord || '';
                const nextChordName = nextBeat?.dataset.currentChord || '';

                const transposedCurrent = this.transposeChord(currentChordName, this.currentPitchShift);
                const transposedPrev = this.transposeChord(prevChordName, this.currentPitchShift);
                const transposedNext = this.transposeChord(nextChordName, this.currentPitchShift);

                this.currentChordSymbol = transposedCurrent;
                this.renderChordDiagramCarousel(transposedPrev, transposedCurrent, transposedNext);
            }
        }
    
        transposeChord(chord, semitones) {
            if (!chord || !semitones) return chord || '';
    
            const rootMatch = chord.match(/^([A-G][#b]?)/);
            if (!rootMatch) return chord;
    
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const root = rootMatch[1];
            const quality = chord.substring(root.length);
    
            const normalized = root
                .replace('Db', 'C#')
                .replace('Eb', 'D#')
                .replace('Gb', 'F#')
                .replace('Ab', 'G#')
                .replace('Bb', 'A#');
    
            const idx = noteNames.indexOf(normalized);
            if (idx === -1) return chord;
    
            let nextIdx = (idx + semitones) % 12;
            if (nextIdx < 0) nextIdx += 12;
    
            return noteNames[nextIdx] + quality;
        }
    
        setupChordInstrumentToggle() {
            if (!this.chordDiagramEl) {
                this.chordDiagramEl = document.getElementById('mobileChordDiagram');
            }
            if (this.chordInstrumentButtons.length === 0) {
                const buttons = document.querySelectorAll('[data-chord-instrument]');
                if (!buttons.length) return;
                this.chordInstrumentButtons = Array.from(buttons);
                this.chordInstrumentButtons.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const mode = btn.dataset.chordInstrument;
                        if (!mode || mode === this.chordDiagramMode) return;
                        this.chordDiagramMode = mode;
                        this.chordInstrumentButtons.forEach(b => b.classList.toggle('active', b.dataset.chordInstrument === this.chordDiagramMode));
                        // Refresh the carousel with current chords
                        if (this.currentChordSymbol) {
                            this.renderChordDiagramCarousel(this.prevChordSymbol || '', this.currentChordSymbol, this.nextChordSymbol || '');
                        }
                    });
                });
            }
            this.chordInstrumentButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.chordInstrument === this.chordDiagramMode));
        }
    
        setChordDiagramMessage(message) {
            if (!this.chordDiagramEl) {
                this.chordDiagramEl = document.getElementById('mobileChordDiagram');
            }
            if (!this.chordDiagramEl) return;
            this.currentChordSymbol = null;
            this.chordDiagramEl.innerHTML = `<p class="mobile-text-muted">${message}</p>`;
            this.setupChordInstrumentToggle();
        }
    
        renderChordDiagram(chordName) {
            this.setupChordInstrumentToggle();
            if (!this.chordDiagramEl) {
                this.chordDiagramEl = document.getElementById('mobileChordDiagram');
            }
            if (!this.chordDiagramEl) return;
            if (!chordName) {
                this.setChordDiagramMessage(DEFAULT_CHORD_MESSAGE);
                return;
            }
            this.currentChordSymbol = chordName;
            const parsed = this.parseChordSymbol(chordName);
            if (!parsed) {
                this.setChordDiagramMessage('Diagram unavailable for this chord.');
                return;
            }
            if (this.chordDiagramMode === 'piano') {
                this.renderPianoDiagram(parsed, chordName);
            } else {
                this.renderGuitarDiagram(parsed, chordName);
            }
        }

        renderChordDiagramCarousel(prevChordName, currentChordName, nextChordName) {
            this.setupChordInstrumentToggle();

            // Initialize diagram elements if not already done
            if (!this.chordDiagramEl) {
                this.chordDiagramEl = document.getElementById('mobileChordDiagram');
            }
            if (!this.chordDiagramPrevEl) {
                this.chordDiagramPrevEl = document.getElementById('mobileChordDiagramPrev');
            }
            if (!this.chordDiagramNextEl) {
                this.chordDiagramNextEl = document.getElementById('mobileChordDiagramNext');
            }

            // Render current chord (center, large)
            if (currentChordName) {
                const parsed = this.parseChordSymbol(currentChordName);
                if (parsed) {
                    this.currentChordSymbol = currentChordName;
                    if (this.chordDiagramMode === 'piano') {
                        this.renderPianoDiagramInElement(parsed, currentChordName, this.chordDiagramEl);
                    } else {
                        this.renderGuitarDiagramInElement(parsed, currentChordName, this.chordDiagramEl);
                    }
                }
            } else {
                if (this.chordDiagramEl) {
                    this.chordDiagramEl.innerHTML = '<p class="mobile-text-muted">—</p>';
                }
            }

            // Render previous chord (left, small)
            if (prevChordName && this.chordDiagramPrevEl) {
                const parsed = this.parseChordSymbol(prevChordName);
                if (parsed) {
                    this.prevChordSymbol = prevChordName;
                    if (this.chordDiagramMode === 'piano') {
                        this.renderPianoDiagramInElement(parsed, prevChordName, this.chordDiagramPrevEl);
                    } else {
                        this.renderGuitarDiagramInElement(parsed, prevChordName, this.chordDiagramPrevEl);
                    }
                } else {
                    this.chordDiagramPrevEl.innerHTML = '<p class="mobile-text-muted">—</p>';
                }
            } else if (this.chordDiagramPrevEl) {
                this.chordDiagramPrevEl.innerHTML = '<p class="mobile-text-muted">—</p>';
            }

            // Render next chord (right, small)
            if (nextChordName && this.chordDiagramNextEl) {
                const parsed = this.parseChordSymbol(nextChordName);
                if (parsed) {
                    this.nextChordSymbol = nextChordName;
                    if (this.chordDiagramMode === 'piano') {
                        this.renderPianoDiagramInElement(parsed, nextChordName, this.chordDiagramNextEl);
                    } else {
                        this.renderGuitarDiagramInElement(parsed, nextChordName, this.chordDiagramNextEl);
                    }
                } else {
                    this.chordDiagramNextEl.innerHTML = '<p class="mobile-text-muted">—</p>';
                }
            } else if (this.chordDiagramNextEl) {
                this.chordDiagramNextEl.innerHTML = '<p class="mobile-text-muted">—</p>';
            }
        }
    
        parseChordSymbol(chord) {
            if (!chord) return null;
            const match = chord.match(/^([A-G][#b]?)(.*)$/);
            if (!match) return null;
            const rawRoot = match[1];
            const normalizedRoot = this.normalizeNoteName(rawRoot);
            const remainder = this.sanitizeChordSuffix(match[2] || '');
            const { baseSuffix, bassNote } = this.extractSuffixParts(remainder);
            const quality = this.getQualityFromSuffix(baseSuffix);
            const qualitySuffix = this.getSuffixForQuality(quality);
            const suffixCandidates = this.buildSuffixCandidates(baseSuffix, bassNote, qualitySuffix);
            return {
                root: normalizedRoot,
                quality,
                suffixCandidates,
                baseSuffix,
                bassNote
            };
        }
    
        sanitizeChordSuffix(value) {
            if (!value) return '';
            let result = value
                .replace(/♭/g, 'b')
                .replace(/♯/g, '#')
                .replace(/–|−/g, '-')
                .replace(/Δ/g, 'maj')
                .replace(/Ø/g, 'm7b5')
                .replace(/ø/g, 'm7b5')
                .replace(/°/g, 'dim')
                .replace(/^\+/, 'aug')
                .replace(/\s+/g, '')
                .replace(/[()]/g, '');
    
            if (/^M(?=[0-9A-Za-z#b+\-])/.test(result)) {
                result = 'maj' + result.slice(1);
            }
            if (/^Maj/.test(result)) {
                result = 'maj' + result.slice(3);
            }
            result = result.toLowerCase();
    
            if (/^mi(?=[a-z0-9#b+\-])/.test(result)) {
                result = 'm' + result.slice(2);
            }
            if (/^min(?=[a-z0-9#b+\-])/.test(result)) {
                result = 'm' + result.slice(3);
            }
    
            return result;
        }
    
        extractSuffixParts(suffix) {
            if (!suffix) {
                return { baseSuffix: 'major', bassNote: '' };
            }
            const [base, bass] = suffix.split('/');
            return {
                baseSuffix: this.normalizeSuffixBase(base),
                bassNote: this.normalizeBassNote(bass)
            };
        }
    
        normalizeSuffixBase(token) {
            if (!token) return 'major';
            const lowered = token.toLowerCase();
            if (!lowered || lowered === 'maj') return 'major';
            if (['m', 'min', 'minor', '-'].includes(lowered)) return 'minor';
            if (lowered === 'sus') return 'sus4';
            if (lowered === 'dom7') return '7';
            if (lowered === 'dom9') return '9';
            if (lowered === 'dom11') return '11';
            if (lowered === 'dom13') return '13';
            return lowered;
        }
    
        normalizeBassNote(note) {
            if (!note) return '';
            const cleaned = note.replace(/[^A-G#b]/gi, '');
            if (!cleaned) return '';
            const normalized = this.normalizeNoteName(cleaned);
            return normalized ? normalized.toLowerCase() : '';
        }
    
        buildSuffixCandidates(baseSuffix, bassNote, fallbackSuffix) {
            const candidates = [];
            const pushCandidate = (suffix, includeBass = true) => {
                if (!suffix) return;
                const normalized = suffix.toLowerCase();
                if (includeBass && bassNote) {
                    const withBass = `${normalized}_${bassNote}`;
                    if (!candidates.includes(withBass)) candidates.push(withBass);
                }
                if (!candidates.includes(normalized)) candidates.push(normalized);
            };
    
            if (baseSuffix) pushCandidate(baseSuffix, true);
            if (fallbackSuffix) pushCandidate(fallbackSuffix, true);
            if (baseSuffix) pushCandidate(baseSuffix, false);
            if (fallbackSuffix && fallbackSuffix !== baseSuffix) pushCandidate(fallbackSuffix, false);
    
            if (baseSuffix !== 'major') pushCandidate('major', false);
            if (baseSuffix !== 'minor' && fallbackSuffix !== 'minor') {
                pushCandidate('minor', false);
            }
    
            return candidates.filter(Boolean);
        }
    
        getQualityFromSuffix(suffix) {
            const target = (suffix || '').toLowerCase();
            for (const pattern of CHORD_QUALITY_MAP) {
                if (pattern.match.test(target)) {
                    return pattern.key;
                }
            }
            if (!target || target === 'major') return 'major';
            if (target === 'minor') return 'minor';
            return target || 'major';
        }
    
        getSuffixForQuality(quality) {
            if (!quality) return 'major';
            return QUALITY_TO_SUFFIX[quality] || quality || 'major';
        }
    
        shouldPreferBarreVoicing(chord, label) {
            if (!chord) return false;
            const root = chord.root || '';
            const normalizedLabel = (label || '').trim();
            const openChordList = [
                'A', 'C', 'D', 'E', 'G',
                'Am', 'Dm', 'Em',
                'A7', 'B7', 'C7', 'D7', 'E7', 'G7',
                'Amaj7', 'Cmaj7', 'Dmaj7', 'Emaj7', 'Gmaj7',
                'Am7', 'Dm7', 'Em7',
                'E9', 'G9',
                'Aadd9', 'Cadd9', 'Dadd9', 'Eadd9', 'Gadd9',
                'Asus2', 'Dsus2', 'Esus2', 'Gsus2',
                'Asus4', 'Csus4', 'Dsus4', 'Esus4', 'Gsus4',
                'A6', 'C6', 'D6', 'E6', 'G6',
                'Adim', 'Ddim', 'Edim',
                'Eaug', 'Caug'
            ];
            const forcedBarreRoots = ['F', 'F#', 'G#', 'A#', 'Bb', 'B', 'C#', 'D#', 'Eb', 'Ab'];
    
            if (openChordList.includes(normalizedLabel)) {
                return false;
            }
    
            const normalizedRoot = this.normalizeNoteName(root);
            if (forcedBarreRoots.includes(normalizedRoot)) {
                return true;
            }
    
            if (/#|b/.test(root)) return true;
            const suffix = chord.baseSuffix || '';
            return /(add9|9|11|13|dim|aug|m7b5|sus2sus4)/.test(suffix);
        }
    
        normalizeNoteName(note) {
            if (!note) return '';
            const replaced = note.replace('♭', 'b');
            const normalized = replaced.length > 1
                ? replaced[0].toUpperCase() + replaced.slice(1)
                : replaced.toUpperCase();
            return FLAT_TO_SHARP[normalized] || normalized;
        }
    
        getNoteIndex(note) {
            return NOTE_NAMES.indexOf(note);
        }
    
        getGuitarDiagramBuilder() {
            if (!this.guitarDiagramBuilder) {
                this.guitarDiagramBuilder = new GuitarDiagramBuilder();
            }
            return this.guitarDiagramBuilder;
        }
    
        hasCachedGuitarDiagram(root, suffixCandidates = []) {
            if (!root || !this.guitarDiagramCache) return false;
            const candidates = Array.isArray(suffixCandidates) && suffixCandidates.length
                ? suffixCandidates
                : ['major'];
            for (const suffix of candidates) {
                if (!suffix) continue;
                const key = `${root}_${suffix.toLowerCase()}`;
                if (this.guitarDiagramCache.has(key)) return true;
            }
            return false;
        }
    
        async loadGuitarChordPositions(root, suffixCandidates = []) {
            if (!root) return { positions: [], suffix: null };
            const candidates = Array.isArray(suffixCandidates) && suffixCandidates.length
                ? suffixCandidates
                : ['major'];
            const tried = new Set();
    
            for (const suffix of candidates) {
                if (!suffix) continue;
                const normalized = suffix.toLowerCase();
                if (tried.has(normalized)) continue;
                tried.add(normalized);
                const cacheKey = `${root}_${normalized}`;
                if (this.guitarDiagramCache.has(cacheKey)) {
                    const cached = this.guitarDiagramCache.get(cacheKey);
                    if (cached.length) return { positions: cached, suffix: normalized };
                    continue;
                }
    
                const positions = await this.fetchGuitarChordPositions(root, normalized);
                if (positions.length) {
                    this.storeInCache(this.guitarDiagramCache, cacheKey, positions, this.guitarDiagramCacheLimit);
                    return { positions, suffix: normalized };
                }
            }
    
            return { positions: [], suffix: null };
        }
    
        async fetchGuitarChordPositions(root, suffix) {
            const encodedRoot = encodeURIComponent(root);
            const encodedSuffix = encodeURIComponent(suffix);
            const path = `/static/js/datas/guitar-chords-db-json/${encodedRoot}/${encodedSuffix}.json`;
            try {
                const res = await fetch(path);
                if (!res.ok) {
                    if (res.status === 404) {
                        return [];
                    }
                    throw new Error(`Failed to load chord diagram (${res.status})`);
                }
                const json = await res.json();
                return Array.isArray(json?.positions) ? json.positions : [];
            } catch (err) {
                console.warn('[ChordDiagram] Load failed:', err);
                return [];
            }
        }
    
        renderGuitarDiagram(chord, label) {
            if (!this.chordDiagramEl) {
                this.chordDiagramEl = document.getElementById('mobileChordDiagram');
            }
            if (!this.chordDiagramEl) return;
            this.renderGuitarDiagramInElement(chord, label, this.chordDiagramEl);
        }

        renderGuitarDiagramInElement(chord, label, targetElement) {
            if (!targetElement) return;

            const root = this.normalizeNoteName(chord.root);
            const suffixCandidates = Array.isArray(chord.suffixCandidates) && chord.suffixCandidates.length
                ? chord.suffixCandidates
                : [this.getSuffixForQuality(chord.quality)];
            const preferBarre = this.shouldPreferBarreVoicing(chord, label);
            if (!this.hasCachedGuitarDiagram(root, suffixCandidates)) {
                targetElement.innerHTML = '<p class="mobile-text-muted">Loading…</p>';
            }

            this.loadGuitarChordPositions(root, suffixCandidates)
                .then(({ positions }) => {
                    if (!positions.length) {
                        targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                        return;
                    }

                    const selection = this.pickGuitarPosition(positions, { preferBarre, label });
                    if (!selection) {
                        targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                        return;
                    }

                    const { position, frets, minFret, maxFret } = selection;
                    if (!frets || frets.length !== 6) {
                        targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                        return;
                    }

                    const { baseFret, rows } = this.determineFretWindow(frets, position, minFret, maxFret);
                    const fingers = this.parseFingerString(position.fingers);

                    const relativeFrets = frets.map(fret => {
                        if (fret <= 0) return fret;
                        return Math.max(1, fret - baseFret + 1);
                    });

                    const builder = this.getGuitarDiagramBuilder();
                    const svg = builder.build({
                        frets: relativeFrets,
                        fingers,
                        baseFret
                    }, { rows });

                    const wrapper = document.createElement('div');
                    wrapper.className = 'guitar-diagram';

                    const labelEl = document.createElement('div');
                    labelEl.className = 'mobile-chord-diagram-label';
                    labelEl.textContent = label;
                    wrapper.appendChild(labelEl);

                    const svgContainer = document.createElement('div');
                    svgContainer.className = 'guitar-svg-wrapper';
                    svgContainer.appendChild(svg);
                    wrapper.appendChild(svgContainer);

                    targetElement.innerHTML = '';
                    targetElement.appendChild(wrapper);
                })
                .catch(err => {
                    console.warn('[ChordDiagram] Guitar render failed:', err);
                    targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                });
        }
    
        renderPianoDiagram(chord, label) {
            if (!this.chordDiagramEl) {
                this.chordDiagramEl = document.getElementById('mobileChordDiagram');
            }
            if (!this.chordDiagramEl) return;
            this.renderPianoDiagramInElement(chord, label, this.chordDiagramEl);
        }

        renderPianoDiagramInElement(chord, label, targetElement) {
            if (!targetElement) return;

            const rootIndex = this.getNoteIndex(chord.root);
            if (rootIndex === -1) {
                targetElement.innerHTML = '<p class="mobile-text-muted">—</p>';
                return;
            }
            const intervals = PIANO_INTERVALS[chord.quality] || PIANO_INTERVALS.major;
            const notes = intervals.map(offset => (rootIndex + offset) % 12);

            const whiteKeysHTML = WHITE_KEYS.map(note => {
                const noteIndex = NOTE_NAMES.indexOf(note);
                const active = notes.includes(noteIndex);
                return `<div class="piano-white-key${active ? ' active' : ''}"><span>${note}</span></div>`;
            }).join('');

            const whiteWidth = 100 / WHITE_KEYS.length;
            const blackKeysHTML = BLACK_KEYS.map(entry => {
                const noteIndex = NOTE_NAMES.indexOf(entry.note);
                if (noteIndex === -1) return '';
                const active = notes.includes(noteIndex);
                const left = ((entry.anchor + 1) * whiteWidth) - (whiteWidth * 0.35);
                return `<div class="piano-black-key${active ? ' active' : ''}" style="left:${left}%"></div>`;
            }).join('');

            targetElement.innerHTML = `
                <div class="mobile-chord-diagram-label">${label}</div>
                <div class="piano-diagram">
                    <div class="piano-wrapper">
                        <div class="piano-white-keys">${whiteKeysHTML}</div>
                        <div class="piano-black-keys">${blackKeysHTML}</div>
                    </div>
                </div>
            `;
        }
    
        storeInCache(map, key, value, limit = 10) {
            if (!map) return;
            if (map.has(key)) map.delete(key);
            map.set(key, value);
            while (map.size > limit) {
                const oldest = map.keys().next().value;
                map.delete(oldest);
            }
        }
    
        setChordCache(key, chords) {
            if (!key || !Array.isArray(chords)) return;
            this.storeInCache(this.chordDataCache, key, this.cloneChordArray(chords), this.chordDataCacheLimit);
        }
    
        cloneChordArray(arr) {
            return Array.isArray(arr) ? arr.map(ch => ({ ...ch })) : [];
        }
    
        parseFrets(fretsString) {
            if (!fretsString) return null;
            const result = [];
            for (let i = 0; i < fretsString.length && result.length < 6; i++) {
                const char = fretsString[i];
                if (char === 'x' || char === 'X') {
                    result.push(-1);
                } else if (/[0-9]/.test(char)) {
                    result.push(parseInt(char, 10));
                } else if (/[a-z]/i.test(char)) {
                    result.push(this.fretLetterToNumber(char));
                }
            }
            while (result.length < 6) result.push(0);
            return result;
        }
    
        fretLetterToNumber(char) {
            if (!char) return 0;
            const lower = char.toLowerCase();
            const code = lower.charCodeAt(0);
            if (code < 97 || code > 122) return 0;
            return 10 + (code - 97);
        }
    
        parseFingerString(fingerString) {
            if (!fingerString) return Array(6).fill(0);
            const result = [];
            for (let i = 0; i < fingerString.length && result.length < 6; i++) {
                const char = fingerString[i];
                result.push(/[0-9]/.test(char) ? parseInt(char, 10) : 0);
            }
            while (result.length < 6) result.push(0);
            return result;
        }
    
    
    seek(time) {
        if (this.mixer && this.mixer.audioEngine) {
            this.mixer.audioEngine.seek(time);
        }
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    async loadGuitarChordPositions(root, suffixCandidates = []) {
        if (!root) return { positions: [], suffix: null };
        const candidates = Array.isArray(suffixCandidates) && suffixCandidates.length ? suffixCandidates : ['major'];
        const tried = new Set();
        for (const suffix of candidates) {
            if (!suffix) continue;
            const normalized = suffix.toLowerCase();
            if (tried.has(normalized)) continue;
            tried.add(normalized);
            const cacheKey = `${root}_${normalized}`;
            if (this.guitarDiagramCache.has(cacheKey)) {
                const cached = this.guitarDiagramCache.get(cacheKey);
                if (cached.length) return { positions: cached, suffix: normalized };
                continue;
            }
            const positions = await this.fetchGuitarChordPositions(root, normalized);
            if (positions.length) {
                this.storeInCache(this.guitarDiagramCache, cacheKey, positions, this.guitarDiagramCacheLimit);
                return { positions, suffix: normalized };
            }
        }
        return { positions: [], suffix: null };
    }

    async fetchGuitarChordPositions(root, suffix) {
        const encodedRoot = encodeURIComponent(root);
        const encodedSuffix = encodeURIComponent(suffix);
        const path = `/static/js/datas/guitar-chords-db-json/${encodedRoot}/${encodedSuffix}.json`;
        try {
            const res = await fetch(path);
            if (!res.ok) return [];
            const json = await res.json();
            return Array.isArray(json?.positions) ? json.positions : [];
        } catch (err) {
            return [];
        }
    }

    getBaseFret(position, fallback = null) {
        const raw = parseInt(position?.baseFret || position?.basefret || 'NaN', 10);
        if (Number.isFinite(raw) && raw > 0) return raw;
        if (Number.isFinite(fallback) && fallback > 0) return fallback;
        return 1;
    }

    determineFretWindow(frets, position, minFret = null, maxFret = null) {
        const positive = frets.filter(f => f > 0);
        if (!positive.length) return { baseFret: 1, rows: 4 };
        const minVal = Number.isFinite(minFret) ? minFret : Math.min(...positive);
        const maxVal = Number.isFinite(maxFret) ? maxFret : Math.max(...positive);
        const baseFret = this.getBaseFret(position, minVal);
        const span = maxVal - baseFret;
        const rows = Math.max(4, Math.min(6, span + 1));
        return { baseFret, rows };
    }

    pickGuitarPosition(positions, options = {}) {
        if (!Array.isArray(positions) || !positions.length) return null;
        let best = null;
        let bestScore = Infinity;
        const preferBarre = Boolean(options.preferBarre);
        const label = (options.label || '').trim().toLowerCase();
        const forceBarreLabel = ['bm', 'f#m', 'g#m', 'bbm', 'abm', 'b#m'].includes(label);

        positions.forEach(position => {
            const frets = this.parseFrets(position.frets);
            if (!Array.isArray(frets) || frets.length !== 6) return;
            const positive = frets.filter(f => f > 0);
            if (!positive.length) return;
            const minFret = Math.min(...positive);
            const maxFret = Math.max(...positive);
            const span = maxFret - minFret;
            const effectiveBase = Math.min(this.getBaseFret(position, minFret), minFret);
            const muted = frets.filter(f => f < 0).length;
            const open = frets.filter(f => f === 0).length;
            const hasBarre = typeof position.barres !== 'undefined';
            let score = (span * 3) + effectiveBase + (muted * 0.25) - (open * 0.1);
            if (preferBarre || forceBarreLabel) {
                score += open * 1.5;
                if (effectiveBase < 2) score += 3;
                if (effectiveBase < 4) score += 2;
                if (!hasBarre) score += 6;
                if ((open > 0 || effectiveBase <= 2) && !hasBarre) score += 4;
                if (hasBarre) score -= 2;
            } else {
                score -= open * 0.2;
            }
            if (score < bestScore) {
                bestScore = score;
                best = { position, frets, minFret, maxFret };
            }
        });

        if (best) return best;
        const fallback = positions[0];
        return fallback ? { position: fallback, frets: this.parseFrets(fallback.frets) || [], minFret: 1, maxFret: 4 } : null;
    }

    async regenerateChords() {
        const targetId = this.mixer.extractionId;
        if (!targetId) {
            alert('Load a track before regenerating chords.');
            return;
        }
        if (this.chordRegenerating) return;

        const btn = document.getElementById('regenerateChordsBtn');
        const originalHTML = btn ? btn.innerHTML : '';

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Regenerating...</span>';
        }

        this.chordRegenerating = true;

        try {
            const url = `/api/extractions/${targetId}/chords/regenerate`;
            const res = await fetch(url, { method: 'POST' });
            const data = await res.json();

            if (!res.ok || data.error) {
                throw new Error(data.error || ('HTTP ' + res.status));
            }

            const payload = Array.isArray(data.chords) ? data.chords : data.chords_data;
            let parsed = payload;
            if (typeof payload === 'string') {
                parsed = JSON.parse(payload);
            }

            if (!Array.isArray(parsed)) {
                throw new Error('Chord data missing from response');
            }

            this.chords = parsed;

            if (typeof data.beat_offset === 'number') {
                this.beatOffset = data.beat_offset;
            }

            // Update EXTRACTION_INFO if it exists
            if (window.EXTRACTION_INFO) {
                window.EXTRACTION_INFO.chords_data = JSON.stringify(parsed);
                if (typeof data.beat_offset === 'number') {
                    window.EXTRACTION_INFO.beat_offset = data.beat_offset;
                }
            }

            // Redisplay chords
            this.displayChords();

            if (btn) {
                btn.innerHTML = '<i class="fas fa-check"></i> <span>Updated!</span>';
                setTimeout(() => {
                    if (btn) btn.innerHTML = originalHTML;
                }, 2000);
            }

            console.log('[ChordDisplay] Chords regenerated successfully:', parsed.length, 'chords');

        } catch (error) {
            console.error('[ChordDisplay] Regeneration failed:', error);
            alert('Failed to regenerate chords: ' + error.message);
            if (btn) btn.innerHTML = originalHTML;
        } finally {
            if (btn) btn.disabled = false;
            this.chordRegenerating = false;
        }
    }

    async loadChordData() {
        try {
            let chordsJson = null;
            try {
                const response = await fetch(`/api/extractions/${this.mixer.extractionId}`);
                if (response.ok) {
                    const data = await response.json();
                    chordsJson = data.chords_data;
                    if (data.beat_offset) this.beatOffset = data.beat_offset;
                    if (data.detected_bpm) { this.currentBPM = data.detected_bpm; this.originalBPM = data.detected_bpm; this.chordBPM = data.detected_bpm; }
                }
            } catch (e) {}
            if (!chordsJson && window.EXTRACTION_INFO?.chords_data) {
                chordsJson = window.EXTRACTION_INFO.chords_data;
                if (window.EXTRACTION_INFO.beat_offset) this.beatOffset = window.EXTRACTION_INFO.beat_offset;
                if (window.EXTRACTION_INFO.detected_bpm) { this.currentBPM = window.EXTRACTION_INFO.detected_bpm; this.originalBPM = window.EXTRACTION_INFO.detected_bpm; this.chordBPM = window.EXTRACTION_INFO.detected_bpm; }
            }
            if (chordsJson) {
                this.chords = typeof chordsJson === "string" ? JSON.parse(chordsJson) : chordsJson;
                if (this.chords?.length) {
                    this.isEnabled = true;
                    this.duration = this.mixer.maxDuration || 300;
                    this.displayChords();
                    this.initGridPopup();
                    return true;
                }
            }
            return false;
        } catch (error) { console.error("[ChordDisplay]", error); return false; }
    }

    sync(timeSeconds) {
        if (!this.isEnabled) return;
        this.currentTime = timeSeconds;
        if (window.simplePitchTempo?.currentPitchShift !== this.currentPitchShift) {
            this.currentPitchShift = window.simplePitchTempo.currentPitchShift;
            this.updateChordLabels();
        }
        this.syncChordPlayhead(false);
        this.syncGridView();
    }

    reset() { this.currentChordIndex = -1; if (this.isEnabled) this.syncChordPlayhead(true); }
    setBPM(bpm) { if (bpm > 0) { this.currentBPM = bpm; this.originalBPM = bpm; this.chordBPM = bpm; } }

    // Chords Grid Popup Methods
    initGridPopup() {
        const openBtn = document.getElementById('chord-grid-view-btn') || document.getElementById('mobileChordGridViewBtn');
        const closeBtn = document.getElementById('chords-grid-popup-close');
        const popup = document.getElementById('chords-grid-popup');

        if (!openBtn || !closeBtn || !popup) return;

        openBtn.addEventListener('click', () => this.openGridPopup());
        closeBtn.addEventListener('click', () => this.closeGridPopup());

        // Close on overlay click
        popup.addEventListener('click', (e) => {
            if (e.target === popup) this.closeGridPopup();
        });

        // Close on ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && popup.getAttribute('aria-hidden') === 'false') {
                this.closeGridPopup();
            }
        });

        // Initialize popup controls
        this.initPopupControls();
    }

    initPopupControls() {
        // Grid popup controls
        const gridPlayBtn = document.getElementById('gridPlayBtn');
        const gridStopBtn = document.getElementById('gridStopBtn');
        const gridTempoSlider = document.getElementById('gridTempoSlider');
        const gridPitchSlider = document.getElementById('gridPitchSlider');

        // Lyrics popup controls
        const lyricsPlayBtn = document.getElementById('lyricsPopupPlayBtn');
        const lyricsStopBtn = document.getElementById('lyricsPopupStopBtn');
        const lyricsTempoSlider = document.getElementById('lyricsPopupTempoSlider');
        const lyricsPitchSlider = document.getElementById('lyricsPopupPitchSlider');

        // Play/pause handlers
        [gridPlayBtn, lyricsPlayBtn].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    if (this.mixer) {
                        if (this.mixer.isPlaying) {
                            this.mixer.pause();
                        } else {
                            this.mixer.play();
                        }
                        this.syncPopupControlsState();
                    }
                });
            }
        });

        // Stop handlers
        [gridStopBtn, lyricsStopBtn].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    if (this.mixer) {
                        this.mixer.stop();
                        this.syncPopupControlsState();
                    }
                });
            }
        });

        // Tempo sliders
        [gridTempoSlider, lyricsTempoSlider].forEach(slider => {
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const ratio = parseFloat(e.target.value);
                    if (window.simplePitchTempo) {
                        const newBPM = Math.round(window.simplePitchTempo.originalBPM * ratio);
                        window.simplePitchTempo.setBPM(newBPM);
                    }
                    this.syncPopupControlsState();
                });
            }
        });

        // Pitch sliders - use direct semitone shifting for full -12 to +12 range
        [gridPitchSlider, lyricsPitchSlider].forEach(slider => {
            if (slider) {
                slider.addEventListener('input', (e) => {
                    const semitones = parseInt(e.target.value);
                    if (window.simplePitchTempo) {
                        window.simplePitchTempo.setPitchShift(semitones);
                    }
                    // Update pitch value display immediately
                    this.syncPopupControlsState();
                });
            }
        });
    }

    syncPopupControlsState() {
        const isPlaying = this.mixer?.isPlaying || false;
        const currentTime = this.currentTime || 0;
        const duration = this.duration || 0;

        // Sync play button state
        const playBtns = document.querySelectorAll('.popup-play-sync');
        playBtns.forEach(btn => {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
            }
            btn.classList.toggle('playing', isPlaying);
        });

        // Sync time display
        const timeDisplays = document.querySelectorAll('.popup-time-sync');
        timeDisplays.forEach(el => {
            el.textContent = this.formatTime(currentTime);
        });

        const durationDisplays = document.querySelectorAll('.popup-duration-sync');
        durationDisplays.forEach(el => {
            el.textContent = this.formatTime(duration);
        });

        // Sync tempo sliders
        if (window.simplePitchTempo) {
            const tempoRatio = window.simplePitchTempo.currentBPM / window.simplePitchTempo.originalBPM;
            const tempoSliders = document.querySelectorAll('.popup-tempo-sync');
            tempoSliders.forEach(slider => {
                slider.value = tempoRatio.toFixed(2);
            });

            const tempoValues = document.querySelectorAll('.popup-tempo-value-sync');
            tempoValues.forEach(el => {
                el.textContent = tempoRatio.toFixed(2) + 'x';
            });

            // Sync pitch sliders
            const pitchShift = window.simplePitchTempo.currentPitchShift || 0;
            const pitchSliders = document.querySelectorAll('.popup-pitch-sync');
            pitchSliders.forEach(slider => {
                slider.value = pitchShift;
            });

            const pitchValues = document.querySelectorAll('.popup-pitch-value-sync');
            pitchValues.forEach(el => {
                const sign = pitchShift >= 0 ? '+' : '';
                el.textContent = sign + pitchShift;
            });
        }
    }

    formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    openGridPopup() {
        const popup = document.getElementById('chords-grid-popup');
        if (!popup) return;

        this.renderChordsGrid();
        popup.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        this.syncPopupControlsState();
    }

    closeGridPopup() {
        const popup = document.getElementById('chords-grid-popup');
        if (!popup) return;

        popup.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    renderChordsGrid() {
        const container = document.getElementById('chords-grid-container');
        if (!container || !this.chords.length) {
            if (container) container.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">No chords available</p>';
            return;
        }

        this.gridBeatElements = []; // Reset grid beat elements

        const bpm = this.chordBPM || this.currentBPM || this.originalBPM || 120;
        const beatsPerBar = Math.max(2, Math.min(12, this.beatsPerBar || 4));
        const beatDuration = 60 / bpm;
        const measureSeconds = beatDuration * beatsPerBar;

        // Apply beatOffset to align chord timestamps with the beat grid
        const offset = this.beatOffset || 0;

        // Quantize chords to nearest STRONG beat (1 or 3) with beatOffset
        const quantizedChords = [...this.chords].map(chord => {
            const originalTime = (chord.timestamp || 0) - offset;

            // Find the measure this chord belongs to
            const measureIndex = Math.floor(Math.max(0, originalTime) / measureSeconds);
            const measureStart = measureIndex * measureSeconds;

            // Strong beats are at 0 (beat 1) and 2*beatDuration (beat 3)
            const beat1Time = measureStart;
            const beat3Time = measureStart + (2 * beatDuration);

            // Check distance to each strong beat
            const distToBeat1 = Math.abs(originalTime - beat1Time);
            const distToBeat3 = Math.abs(originalTime - beat3Time);

            // Tolerance: snap to strong beat if within 0.7 of a beat duration
            const strongBeatTolerance = beatDuration * 0.7;

            let quantizedTime;
            if (distToBeat1 <= strongBeatTolerance) {
                quantizedTime = beat1Time;
            } else if (distToBeat3 <= strongBeatTolerance) {
                quantizedTime = beat3Time;
            } else {
                // Fall back to nearest beat
                quantizedTime = Math.round(originalTime / beatDuration) * beatDuration;
            }

            return {
                ...chord,
                timestamp: Math.max(0, quantizedTime),
                originalTimestamp: chord.timestamp
            };
        }).sort((a, b) => a.timestamp - b.timestamp);

        // Calculate total measures needed
        const totalDuration = this.duration || 180;
        const totalMeasures = Math.ceil(totalDuration / measureSeconds);

        // Create ALL measures with beat slots
        const measures = [];
        let lastActiveChord = '';
        let chordIndex = 0;

        for (let measureNum = 0; measureNum < totalMeasures; measureNum++) {
            const measureStartTime = measureNum * measureSeconds;
            const measure = {
                number: measureNum + 1,
                startTime: measureStartTime,
                beats: []
            };

            for (let beat = 0; beat < beatsPerBar; beat++) {
                const beatTime = measureStartTime + (beat * beatDuration);

                // Find chord active at this beat
                while (chordIndex < quantizedChords.length - 1 &&
                       quantizedChords[chordIndex + 1].timestamp <= beatTime + 0.01) {
                    chordIndex++;
                }

                const activeChord = quantizedChords[chordIndex];
                const chordName = activeChord?.chord || '';

                // Check if chord changes at this beat
                if (chordName && chordName !== lastActiveChord) {
                    measure.beats.push({
                        chord: chordName,
                        timestamp: beatTime,
                        index: chordIndex,
                        empty: false
                    });
                    lastActiveChord = chordName;
                } else {
                    measure.beats.push({
                        empty: true,
                        currentChord: lastActiveChord,
                        timestamp: beatTime
                    });
                }
            }

            measures.push(measure);
        }

        // Render the grid
        container.innerHTML = '';
        measures.forEach((measure, measureIndex) => {
            const measureEl = document.createElement('div');
            measureEl.className = 'chord-grid-measure';

            const labelEl = document.createElement('div');
            labelEl.className = 'chord-grid-measure-label';
            labelEl.textContent = measure.number;
            measureEl.appendChild(labelEl);

            const beatsContainer = document.createElement('div');
            beatsContainer.className = 'chord-grid-beats';

            measure.beats.forEach((beat, beatIndex) => {
                const beatEl = document.createElement('div');
                beatEl.className = 'chord-grid-beat';

                // Calculate beat timestamp
                const beatDuration = measureSeconds / beatsPerBar;
                const beatTimestamp = measure.startTime + (beatIndex * beatDuration);

                beatEl.dataset.beatTime = beatTimestamp;
                beatEl.dataset.measureIndex = measureIndex;
                beatEl.dataset.beatIndex = beatIndex;

                if (beat.empty) {
                    beatEl.classList.add('empty');
                    beatEl.dataset.currentChord = beat.currentChord || '';
                    const displayChord = beat.currentChord ? this.transposeChord(beat.currentChord, this.currentPitchShift) : '';
                    beatEl.innerHTML = `
                        <div class="chord-grid-beat-name">—</div>
                        <div class="chord-grid-beat-time">${this.formatTime(beatTimestamp)}</div>
                    `;
                } else {
                    beatEl.dataset.timestamp = beat.timestamp;
                    beatEl.dataset.index = beat.index;
                    beatEl.dataset.currentChord = beat.chord;

                    const transposedChord = this.transposeChord(beat.chord, this.currentPitchShift);
                    beatEl.innerHTML = `
                        <div class="chord-grid-beat-name">${transposedChord}</div>
                        <div class="chord-grid-beat-time">${this.formatTime(beat.timestamp)}</div>
                    `;
                }

                beatEl.addEventListener('click', () => {
                    this.seek(beatTimestamp);
                    const clickedBeatIdx = this.gridBeatElements.indexOf(beatEl);
                    if (clickedBeatIdx !== -1) {
                        this.highlightGridBeat(clickedBeatIdx);
                    }
                });

                this.gridBeatElements.push(beatEl);
                beatsContainer.appendChild(beatEl);
            });

            measureEl.appendChild(beatsContainer);
            container.appendChild(measureEl);
        });

        // Highlight current beat using beatIndex
        if (this.beatElements && this.beatElements.length) {
            const currentBeatIdx = this.getBeatIndexForTime(this.currentTime - (this.beatOffset || 0));
            this.highlightGridBeat(currentBeatIdx);
        }
    }

    highlightGridBeat(beatIndex) {
        if (!this.gridBeatElements || !this.gridBeatElements.length) return;

        const activeBeat = this.gridBeatElements[beatIndex];
        if (!activeBeat) return;

        // Remove active class from all grid beats
        this.gridBeatElements.forEach(el => el.classList.remove('active'));
        activeBeat.classList.add('active');

        // Auto-scroll to keep focus near the top (first row position)
        // This gives the musician maximum visibility of upcoming chords
        const popup = document.getElementById('chords-grid-popup');
        const popupBody = popup?.querySelector('.chords-grid-popup-body');
        if (popupBody) {
            const parentMeasure = activeBeat.closest('.chord-grid-measure');
            if (parentMeasure) {
                const relativeTop = parentMeasure.offsetTop - popupBody.offsetTop;

                // Position so the active measure appears at the top with a small margin
                const topMargin = 10; // 10px from top
                const targetScroll = Math.max(0, relativeTop - topMargin);

                // Skip scroll if already at target position
                if (Math.abs(popupBody.scrollTop - targetScroll) < 1) return;

                popupBody.scrollTo({
                    top: targetScroll,
                    behavior: 'auto'
                });
            }
        }
    }

    syncGridView() {
        const popup = document.getElementById('chords-grid-popup');
        if (!popup || popup.getAttribute('aria-hidden') === 'true') return;
        if (!this.gridBeatElements || !this.gridBeatElements.length) return;

        const currentTime = this.currentTime - (this.beatOffset || 0);
        const beatIdx = this.getBeatIndexForTime(currentTime);
        if (beatIdx !== -1) {
            this.highlightGridBeat(beatIdx);
        }

        // Sync popup controls state
        this.syncPopupControlsState();
    }
}

if (typeof module !== "undefined" && module.exports) { module.exports = ChordDisplay; }
