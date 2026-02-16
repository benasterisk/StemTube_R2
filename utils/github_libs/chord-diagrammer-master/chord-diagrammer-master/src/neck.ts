import { Helper } from "./helper";
import { Settings } from "./settings";

export class Neck {
    private _settings: Settings;

    constructor(settings: Settings) {
        this._settings = settings;
    }

    build(tuning: string[], stringsCount: number, fretsOnChord: number, baseFret: number): SVGElement {
        var neckElement = Helper.createSVGElement("g", {
            class: "neck",
        });

        // grid
        var backgroundElement = Helper.createSVGElement("rect", {
            x: 0,
            y: 0,
            fill: this._settings.neck.color,
            width: this._settings.stringSpace * (stringsCount - 1),
            height: this._settings.fretSpace * fretsOnChord,
        });
        neckElement.appendChild(backgroundElement);

        var pathElement = Helper.createSVGElement(
            "path",
            {
                stroke: this._settings.neck.grid.visible ? this._settings.neck.grid.color :  "transparent",
                strokeWidth: this._settings.neck.grid.width,
                strokeLinecap: "square",
                d: this.getNeckPath(stringsCount, fretsOnChord),
            },
            true
        );
        neckElement.appendChild(pathElement);

        // base fret
        let baseFretElement: SVGElement;
        if (baseFret === 1) {
            // nut rectangle
            baseFretElement = Helper.createSVGElement(
                "path",
                {
                    stroke: this._settings.neck.nut.color,
                    strokeWidth: this._settings.neck.nut.width,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    d: `M 0 ${-this._settings.neck.nut.width / 2} H ${(stringsCount - 1) * this._settings.stringSpace}`,
                },
                true
            );
            neckElement.appendChild(baseFretElement);
        } else if(this._settings.neck.baseFret.visible) {
            // base-fret text
            var textElement = Helper.createSVGElement(
                "text",
                {
                    fontSize: this._settings.neck.baseFret.size,
                    fill: this._settings.neck.baseFret.color,
                    dominantBaseline: "middle",
                    textAnchor: "end",
                    x: -(
                        this._settings.neck.baseFret.margin +
                        this._settings.dot.radius +
                        this._settings.dot.borderWidth
                    ),
                    y: this._settings.fretSpace / 2 + 0.2,
                },
                true
            );
            const text = this.getBaseFretText(baseFret);
            baseFretElement = Helper.appendTextNode(textElement, text);
            neckElement.appendChild(baseFretElement);
        }

        // string tuning names
        if (this._settings.neck.stringName.visible) {
            var tuningGroupElement = Helper.createSVGElement("g");
            tuning.forEach((note, index) => {
                var textElement = Helper.createSVGElement(
                    "text",
                    {
                        key: index,
                        textAnchor: "middle",
                        dominantBaseline: "hanging",
                        fontSize: this._settings.neck.stringName.size,
                        fill: this._settings.neck.stringName.color,
                        x: index * this._settings.stringSpace,
                        y: fretsOnChord * this._settings.fretSpace + this._settings.neck.stringName.margin,
                    },
                    true
                );
                tuningGroupElement.appendChild(Helper.appendTextNode(textElement, note));
            });
            neckElement.appendChild(tuningGroupElement);
        }

        return neckElement;
    }

    private getBaseFretText(baseFret: number): string {
        if (this._settings.neck.useRoman) {
            const romanNumbers = [
                "I",
                "II",
                "III",
                "IV",
                "V",
                "VI",
                "VII",
                "VIII",
                "IX",
                "X",
                "XI",
                "XII",
                "XIII",
                "XIV",
                "XV",
            ];
            return romanNumbers[baseFret - 1];
        }
        return baseFret + "fr";
    }

    private getNeckHorizonalLine(pos: number, stringsCount: number): string {
        return `M 0 ${pos * this._settings.fretSpace} H ${(stringsCount - 1) * this._settings.stringSpace}`;
    }

    private getNeckVerticalLine(pos: number, fretsCount: number): string {
        return `M ${pos * this._settings.stringSpace} 0 V ${fretsCount * this._settings.fretSpace}`;
    }

    private getNeckPath(stringsCount: number, fretsOnChord: number): string {
        return Array.apply(null, Array(fretsOnChord + 1))
            .map((_: any, pos: number) => this.getNeckHorizonalLine(pos, stringsCount))
            .join(" ")
            .concat(
                Array.apply(null, Array(stringsCount))
                    .map((_: any, pos: number) => this.getNeckVerticalLine(pos, fretsOnChord))
                    .join(" ")
            );
    }
}
