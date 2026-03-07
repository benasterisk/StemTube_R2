/**
 * Neumorphic Custom Theme — palette generator
 * Converts an accent color + background color into a full set of CSS variables.
 * Shared by desktop, mobile, and mixer iframe.
 */

function hexToHsl(hex) {
    hex = hex.replace(/^#/, '');
    var r = parseInt(hex.substring(0, 2), 16) / 255;
    var g = parseInt(hex.substring(2, 4), 16) / 255;
    var b = parseInt(hex.substring(4, 6), 16) / 255;

    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var a = s * Math.min(l, 1 - l);
    var f = function(n) {
        var k = (n + h / 30) % 12;
        var color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
}

function hslStr(h, s, l) {
    return 'hsl(' + h + ', ' + s + '%, ' + l + '%)';
}

/**
 * Generate full neumorphic palette from accent color and background color.
 * @param {string} accentHex - Accent/primary color (buttons, highlights)
 * @param {string} bgHex - Background base color
 */
function generateNeumorphicPalette(accentHex, bgHex, textHex) {
    var accent = hexToHsl(accentHex);
    var bg = hexToHsl(bgHex);

    // Background tones derived from the bg color
    var bgH = bg.h;
    var bgS = bg.s;
    var bgL = bg.l;

    // Clamp bg lightness to usable neumorphic range (8-85%)
    if (bgL < 8) bgL = 8;
    if (bgL > 85) bgL = 85;

    // Determine if light or dark background
    var isLight = bgL > 50;

    // Background variants (relative to base)
    var bgPrimaryL = Math.max(bgL - 2, 2);
    var bgSecondaryL = Math.min(bgL + 3, 98);
    var bgTertiaryL = Math.max(bgL - 4, 2);
    var bgHoverL = Math.min(bgL + 8, 98);

    // Text color: use provided textHex or auto-derive from bg lightness
    var textH, textSat, textL, textSecSat, textSecL;
    if (textHex) {
        var txt = hexToHsl(textHex);
        textH = txt.h;
        textSat = txt.s;
        textL = txt.l;
        textSecSat = txt.s;
        // Secondary text: reduce lightness toward middle
        textSecL = txt.l > 50 ? Math.max(txt.l - 23, 30) : Math.min(txt.l + 23, 70);
    } else {
        textH = bgH;
        if (isLight) {
            textL = 15;
            textSecL = 35;
        } else {
            textL = 88;
            textSecL = 65;
        }
        textSat = Math.min(bgS, 20);
        textSecSat = Math.min(bgS, 30);
    }

    // Accent hover variant
    var accentHoverL = Math.min(accent.l + 8, 95);

    // Shadow pair: neumorphic needs darker + lighter than base
    var shadowDarkL, shadowLightL;
    if (isLight) {
        shadowDarkL = Math.max(bgL - 15, 0);
        shadowLightL = Math.min(bgL + 12, 100);
    } else {
        shadowDarkL = Math.max(bgL - 8, 0);
        shadowLightL = Math.min(bgL + 7, 100);
    }
    var shadowDarkSat = Math.round(bgS * 0.6);
    var shadowLightSat = Math.round(bgS * 0.4);

    // Accent RGB for rgba() usage
    var accentR = parseInt(accentHex.replace('#', '').substring(0, 2), 16);
    var accentG = parseInt(accentHex.replace('#', '').substring(2, 4), 16);
    var accentB = parseInt(accentHex.replace('#', '').substring(4, 6), 16);
    var accentRgb = accentR + ', ' + accentG + ', ' + accentB;

    var shadowDark = hslStr(bgH, shadowDarkSat, shadowDarkL);
    var shadowLight = hslStr(bgH, shadowLightSat, shadowLightL);

    // Border color: subtle, adapts to light/dark
    var borderColor = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(' + accentRgb + ', 0.12)';

    var vars = {
        '--bg-color':        hslStr(bgH, bgS, bgL),
        '--bg-primary':      hslStr(bgH, bgS, bgPrimaryL),
        '--bg-secondary':    hslStr(bgH, bgS, bgSecondaryL),
        '--bg-tertiary':     hslStr(bgH, bgS, bgTertiaryL),
        '--bg-hover':        hslStr(bgH, bgS, bgHoverL),
        '--text-color':      hslStr(textH, textSat, textL),
        '--text-primary':    hslStr(textH, textSat, textL),
        '--text-secondary':  hslStr(textH, textSecSat, textSecL),
        '--accent-color':    accentHex,
        '--accent-hover':    hslToHex(accent.h, accent.s, accentHoverL),
        '--accent-rgb':      accentRgb,
        '--border-color':    borderColor,
        '--success-color':   accentHex,
        '--info-color':      hslToHex(accent.h, accent.s, accentHoverL),
        '--warning-color':   'hsl(40, 65%, 53%)',
        '--shadow-sm':       '3px 3px 6px ' + shadowDark + ', -3px -3px 6px ' + shadowLight,
        '--shadow-md':       '5px 5px 10px ' + shadowDark + ', -5px -5px 10px ' + shadowLight,
        '--shadow-lg':       '7px 7px 14px ' + shadowDark + ', -7px -7px 14px ' + shadowLight,
        '--neu-shadow-inset': 'inset 3px 3px 6px ' + shadowDark + ', inset -3px -3px 6px ' + shadowLight,
        '--neu-shadow-flat':  '4px 4px 8px ' + shadowDark + ', -4px -4px 8px ' + shadowLight,
        '--neu-shadow-pressed': 'inset 3px 3px 6px ' + shadowDark + ', inset -3px -3px 6px ' + shadowLight,
        '--border-radius':   '12px',

        // Mobile variables
        '--mobile-primary':       accentHex,
        '--mobile-primary-dark':  hslToHex(accent.h, accent.s, Math.max(accent.l - 10, 10)),
        '--mobile-bg':            hslStr(bgH, bgS, bgL),
        '--mobile-bg-secondary':  hslStr(bgH, bgS, bgSecondaryL),
        '--mobile-bg-tertiary':   hslStr(bgH, bgS, bgTertiaryL),
        '--mobile-text':          hslStr(textH, textSat, textL),
        '--mobile-text-secondary': hslStr(textH, textSecSat, textSecL),
        '--mobile-border':        borderColor,
        '--mobile-neu-shadow':    '5px 5px 10px ' + shadowDark + ', -5px -5px 10px ' + shadowLight,
        '--mobile-neu-shadow-sm': '3px 3px 6px ' + shadowDark + ', -3px -3px 6px ' + shadowLight,
        '--mobile-neu-inset':     'inset 3px 3px 6px ' + shadowDark + ', inset -3px -3px 6px ' + shadowLight,
        '--mobile-neu-pressed':   'inset 2px 2px 5px ' + shadowDark + ', inset -2px -2px 5px ' + shadowLight,

        // Neumorphic dial variables
        '--neu-bg':           hslStr(bgH, bgS, bgL),
        '--neu-shadow-dark':  shadowDark,
        '--neu-shadow-light': shadowLight
    };

    return vars;
}

/**
 * Apply all generated custom theme variables to an element.
 * @param {Element} element - Target (usually document.body)
 * @param {string} accentHex - Accent color
 * @param {string} bgHex - Background color
 */
function applyCustomThemeVariables(element, accentHex, bgHex, textHex) {
    var palette = generateNeumorphicPalette(accentHex, bgHex, textHex);
    for (var prop in palette) {
        if (palette.hasOwnProperty(prop)) {
            element.style.setProperty(prop, palette[prop]);
        }
    }
}

/**
 * Remove all inline custom theme variables from an element.
 */
var _customThemeVarNames = [
    '--bg-color', '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover',
    '--text-color', '--text-primary', '--text-secondary',
    '--accent-color', '--accent-hover', '--accent-rgb',
    '--border-color', '--success-color', '--info-color', '--warning-color',
    '--shadow-sm', '--shadow-md', '--shadow-lg',
    '--neu-shadow-inset', '--neu-shadow-flat', '--neu-shadow-pressed',
    '--border-radius',
    '--mobile-primary', '--mobile-primary-dark',
    '--mobile-bg', '--mobile-bg-secondary', '--mobile-bg-tertiary',
    '--mobile-text', '--mobile-text-secondary', '--mobile-border',
    '--mobile-neu-shadow', '--mobile-neu-shadow-sm', '--mobile-neu-inset', '--mobile-neu-pressed',
    '--neu-bg', '--neu-shadow-dark', '--neu-shadow-light'
];

function clearCustomThemeVariables(element) {
    for (var i = 0; i < _customThemeVarNames.length; i++) {
        element.style.removeProperty(_customThemeVarNames[i]);
    }
}
