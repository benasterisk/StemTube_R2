export interface LineSettings {
    color: string;
    width: number;
    visible: boolean;
}

export interface TextSettings {
    color: string;
    size: number;
    visible: boolean;
    margin: number;
}

export interface DotSettings {
    /**
     * Circle radius
     */
    radius: number;
    /**
     * Dot border width
     */
    borderWidth: number;
    /**
     * Dot fill color
     */
    fillColor: string,
    /**
     * Dot stroke color
     */
    strokeColor: string,
    /**
     * Open string circle radius
     */
    openStringRadius: number;
}

export interface NeckSettings {
    useRoman: boolean;
    color: string;
    nut: LineSettings,
    grid: LineSettings,
    stringName: TextSettings,
    baseFret:TextSettings,
    stringInfo: TextSettings,
}

export class Settings {
    stringSpace: number = 10;
    fretSpace: number = 14;
    fontFamily: string = "Verdana";
    fingering: TextSettings = {
        color: "#fff",
        margin: 1,
        size: 4,
        visible: true,
    };
    dot: DotSettings = {
        radius: 4,
        borderWidth: 0.25,
        fillColor: "#444",
        strokeColor: "#444",
        openStringRadius: 2,
    };
    neck: NeckSettings = {
        useRoman: true,
        color: "transparent",
        nut:  {
            color: "#444",
            visible: true,
            width: 2,
        },
        grid: {
            color: "#444",
            width: 0.3,
            visible: true,
        },
        stringName: {
            color: "#444",
            size: 5,
            margin: 2,
            visible: true,
        },
        baseFret: {
            color: "#444",
            size: 4,
            margin: 1,
            visible: true,
        },
        stringInfo: {
            color: "#444",
            size: 5,
            margin: 2,
            visible: true,
        }
    };
}
