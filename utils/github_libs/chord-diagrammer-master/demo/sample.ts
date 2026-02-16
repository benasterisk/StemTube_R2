import { SvgBuilder } from "../src/svgBuilder";
import { ChordDiagram } from "../src/models/chordDiagram";
import { Instrument } from "../src/models/instrument";

// chordSample
var diagrams = [
    new ChordDiagram({
        frets: [-1, 0, 2, 2, 1, 0],
        fingers: [0, 0, 2, 3, 1, 0],
        baseFret: 1,
    }),
    new ChordDiagram({
        frets: [-1, 3, 2, 0, 1, 0],
        fingers: [0, 3, 2, 0, 1, 0],
        baseFret: 3,
    })
];

const instrument: Instrument = {
    stringsCount: 6,
    fretsOnDiagram: 4,
    name: "Guitar",
    tuning: ["E", "A", "D", "G", "B", "E"],
};

const builder = new SvgBuilder();

var container = document.getElementById("container");

diagrams.forEach(diagram => {
    var svg = builder.build(diagram, instrument);   
    var div = document.createElement("div");
    div.className = "diagram";
    div.appendChild(svg);
    container?.appendChild(div);
});