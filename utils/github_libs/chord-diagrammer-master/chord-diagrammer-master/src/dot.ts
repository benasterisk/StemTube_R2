import { Helper } from "./helper";
import { Settings } from "./settings";

export class Dot {
    private _settings: Settings;

    constructor(settings: Settings) {
        this._settings = settings;
    }

    build(index: number, fret: number, finger: number, hasNut: boolean): SVGElement {
        const circleX = index * this._settings.stringSpace;
        const circleY = fret * this._settings.fretSpace - this._settings.fretSpace / 2;
        if (fret === -1) {
            var textElement = Helper.createSVGElement(
                "text",
                {
                    fontSize: this._settings.neck.stringInfo.size,
                    fill: this._settings.neck.stringInfo.color,
                    textAnchor: "middle",
                    dominantBaseline: "auto",
                    x: circleX,
                    y: hasNut
                        ? -this._settings.neck.nut.width - this._settings.neck.stringInfo.margin
                        : -this._settings.neck.stringInfo.margin,
                },
                true
            );

            return Helper.appendTextNode(textElement, "x");
        } else {
            let cy = circleY;
            let radius = this._settings.dot.radius;
            let fill = this._settings.dot.fillColor;
            if (fret === 0) {
                (cy = hasNut
                    ? -this._settings.neck.nut.width -
                      this._settings.neck.stringInfo.margin -
                      this._settings.dot.openStringRadius
                    : -this._settings.neck.stringInfo.margin - this._settings.dot.openStringRadius),
                    (radius = this._settings.dot.openStringRadius);
                fill = "transparent";
            }
            var dotElement = Helper.createSVGElement("g");
            var circleElement = Helper.createSVGElement(
                "circle",
                {
                    fontSize: this._settings.neck.stringInfo.size,
                    fill: fill,
                    strokeWidth: this._settings.dot.borderWidth,
                    stroke: this._settings.dot.strokeColor,
                    cx: circleX,
                    cy: cy,
                    r: radius,
                },
                true
            );
            dotElement.appendChild(circleElement);

            if (finger > 0 && this._settings.fingering.visible) {
                var text2Element = Helper.createSVGElement(
                    "text",
                    {
                        fill: this._settings.fingering.color,
                        fontSize: this._settings.fingering.size,
                        textAnchor: "middle",
                        dominantBaseline: "middle",
                        x: circleX,
                        y: circleY + 0.2,
                    },
                    true
                );
                dotElement.appendChild(Helper.appendTextNode(text2Element, finger.toString()));
            }

            return dotElement;
        }
    }
}
