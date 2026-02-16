# Chord Diagrammer

A TypeScript library to generate SVG chord diagrams.

Inspired by: https://github.com/tombatossals/react-chords.

Part of [ChordProject](https://chordproject.com/)
## Overview

Generates SVG chord diagrams according to received specifications.

![Diagrams](./diagrammer.png)

## Usage

`Chord Diagrammer` is on npm. To install run:

```sh
$ npm i chordproject-editor
```

It's really easy to draw an SVG chord diagram:

```ts
// chord diagram definitions
const chordDiagram = new ChordDiagram({
    frets: [-1, 0, 2, 2, 1, 0],
    fingers: [0, 0, 2, 3, 1, 0],
    baseFret: 1,
});

// instrument definitions
const instrument = {
    strings: 6,
    fretsOnChord: 4,
    name: "Guitar",
    tunings: ["E", "A", "D", "G", "B", "E"],
};

const generator = new Diagrammer(); // create an instance of Diagrammer
var svg = generator.builder(chordDiagram, instrument); // build the svg
document.body.appendChild(svg); // add the svg in the html content (here the body)
```

A ChordDiagram is defined by:

-   **frets** (array of numbers). Use 0 for open strings and -1 for muted strings. Frets must be relative to the base-fret.
-   **fingers** (array of numbers). Use 0 for no finger. The fingers array length must match the frets array length. The fingers are optional
-   **base-fret** (number)

## Customization
You can customize the diagram by changing the default settings.

For example:
```ts
builder.settings.dot.radius = 5; // change the dot radius
builder.settings.neck.lineWidth = 0.8; //change the line width of the neck
```
Here is all the available settings:
- stringSpace
- fretSpace
- fontFamily
- fingering:
  - color
  - margin
  - size
  - visible
- dot:
  - radius
  - borderWith
  - fillColor
  - strokeColor
  - openStringRadius
- neck
  - useRoman
  - color
  - nut:
    - color
    - visible
    - width
  - stringName: 
    - color
    - size
    - margin
    - visible
  - grid:
    - color
    - width
    - visible
  - baseFret:
    - color
    - size
    - margin
    - visible
  - stringInfo:
    - color
    - size
    - margin
    - visible
## Demo

1. Clone
2. Install dependencies:

```sh
$ npm i
```

1.  Run in dev mode:

```sh
$ npm run start
```

Open a browser and navigate to http://localhost:8082/ to load the demo.

## Contributing

This project welcomes contributions of all types. If you find any bug or want some new features, please feel free to create an issue or submit a pull request.

Join the community and chat with us on **[Discord](https://discord.gg/ZQAgwBC9c8)**

## License
[MIT License](LICENSE)