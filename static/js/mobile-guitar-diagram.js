/**
 * StemTube Mobile - Guitar & Chord Diagram Rendering
 * GuitarDiagramSettings, GuitarDiagramHelper, CSS variable reader
 * Depends on: mobile-constants.js
 */

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

        this.stringSpace = 52;
        this.fretSpace = 56;
        this.fontFamily = 'Inter, "SF Pro Display", "Segoe UI", sans-serif';
        this.fingering = {
            color: '#04150d',
            margin: 1.5,
            size: 16,
            visible: true
        };
        this.dot = {
            radius: 14,
            borderWidth: 2,
            fillColor: accent,
            strokeColor: accent,
            openStringRadius: 7
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
                size: 15,
                margin: 8,
                visible: true
            },
            baseFret: {
                color: secondary,
                size: 17,
                margin: 14,
                visible: true
            },
            stringInfo: {
                color: secondary,
                size: 15,
                margin: 6,
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
