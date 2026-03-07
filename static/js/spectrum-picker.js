/**
 * Photoshop-style spectrum color picker + neumorphic presets.
 * Requires hexToHsl() and hslToHex() from theme-generator.js.
 *
 * Usage:
 *   var picker = new SpectrumPicker(containerEl, {
 *       color: '#e63950',
 *       onChange: function(hex) { ... }
 *   });
 *   picker.setColor('#3498db');   // programmatic
 *   picker.getColor();            // → '#3498db'
 */

// Neumorphic theme presets: { name, accent, bg, text }
var NEUMORPHIC_PRESETS = [
    { name: 'Steel',   accent: '#5a9cf5', bg: '#2a2d35', text: '#d8dce3' },
    { name: 'Navy',    accent: '#4fc3f7', bg: '#0d1b2a', text: '#c8dce8' },
    { name: 'Cherry',  accent: '#e63950', bg: '#1e0a10', text: '#e8d0d5' },
    { name: 'Cloud',   accent: '#5b7fea', bg: '#e4e8ef', text: '#2a2e3a' },
    { name: 'Sand',    accent: '#d4864a', bg: '#e8ddd0', text: '#3a3028' },
    { name: 'Mint',    accent: '#34b89a', bg: '#dff0ea', text: '#1e3a30' }
];

function SpectrumPicker(container, options) {
    var self = this;
    var opts = options || {};
    self._onChange = opts.onChange || function() {};
    self._hue = 0;
    self._sat = 100;
    self._lit = 50;
    self._draggingSL = false;
    self._draggingHue = false;

    // Canvas dimensions
    var SL_W = 200, SL_H = 150;
    var HUE_W = 20, HUE_H = 150;

    // Build DOM
    var wrapper = document.createElement('div');
    wrapper.className = 'spectrum-picker-wrapper';

    // SL canvas
    var slCanvas = document.createElement('canvas');
    slCanvas.className = 'spectrum-picker-sl';
    slCanvas.width = SL_W;
    slCanvas.height = SL_H;
    self._slCanvas = slCanvas;
    self._slCtx = slCanvas.getContext('2d');

    // Hue strip
    var hueCanvas = document.createElement('canvas');
    hueCanvas.className = 'spectrum-picker-hue';
    hueCanvas.width = HUE_W;
    hueCanvas.height = HUE_H;
    self._hueCanvas = hueCanvas;
    self._hueCtx = hueCanvas.getContext('2d');

    // Info panel (preview + hex)
    var info = document.createElement('div');
    info.className = 'spectrum-picker-info';
    var preview = document.createElement('div');
    preview.className = 'spectrum-picker-preview';
    self._preview = preview;
    var hexLabel = document.createElement('span');
    hexLabel.className = 'spectrum-picker-hex';
    self._hexLabel = hexLabel;
    info.appendChild(preview);
    info.appendChild(hexLabel);

    wrapper.appendChild(slCanvas);
    wrapper.appendChild(hueCanvas);
    wrapper.appendChild(info);
    container.appendChild(wrapper);

    // Draw initial hue strip (static rainbow)
    self._drawHueStrip();

    // Set initial color
    var initColor = opts.color || '#e63950';
    self.setColor(initColor);

    // --- Mouse events for SL canvas ---
    slCanvas.addEventListener('mousedown', function(e) {
        self._draggingSL = true;
        self._handleSL(e);
    });

    // --- Mouse events for Hue strip ---
    hueCanvas.addEventListener('mousedown', function(e) {
        self._draggingHue = true;
        self._handleHue(e);
    });

    // Global mousemove + mouseup (drag outside canvas)
    document.addEventListener('mousemove', function(e) {
        if (self._draggingSL) self._handleSL(e);
        if (self._draggingHue) self._handleHue(e);
    });
    document.addEventListener('mouseup', function() {
        self._draggingSL = false;
        self._draggingHue = false;
    });

    // --- Touch events for mobile ---
    function touchToMouse(e) {
        return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    slCanvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        self._draggingSL = true;
        self._handleSL(touchToMouse(e));
    }, { passive: false });
    hueCanvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
        self._draggingHue = true;
        self._handleHue(touchToMouse(e));
    }, { passive: false });
    document.addEventListener('touchmove', function(e) {
        if (self._draggingSL) { e.preventDefault(); self._handleSL(touchToMouse(e)); }
        if (self._draggingHue) { e.preventDefault(); self._handleHue(touchToMouse(e)); }
    }, { passive: false });
    document.addEventListener('touchend', function() {
        self._draggingSL = false;
        self._draggingHue = false;
    });
}

SpectrumPicker.prototype._handleSL = function(e) {
    var rect = this._slCanvas.getBoundingClientRect();
    var x = Math.max(0, Math.min(e.clientX - rect.left, this._slCanvas.width));
    var y = Math.max(0, Math.min(e.clientY - rect.top, this._slCanvas.height));

    // x → saturation (0 left = 0%, right = 100%)
    // y → lightness (top = 100%, bottom = 0%)
    var s = (x / this._slCanvas.width) * 100;
    var l_white = 100 - (y / this._slCanvas.height) * 100; // 100 at top, 0 at bottom

    // Convert SB (saturation-brightness) to HSL
    // In the Photoshop model: x = saturation (0-100), y = brightness/value (100 at top, 0 at bottom)
    // We need to convert HSV to HSL
    var v = l_white / 100;
    var sv = s / 100;
    var l = v * (1 - sv / 2);
    var sl;
    if (l === 0 || l === 1) {
        sl = 0;
    } else {
        sl = (v - l) / Math.min(l, 1 - l);
    }

    this._sat = Math.round(sl * 100);
    this._lit = Math.round(l * 100);
    this._emitColor();
    this._drawSLCanvas();
};

SpectrumPicker.prototype._handleHue = function(e) {
    var rect = this._hueCanvas.getBoundingClientRect();
    var y = Math.max(0, Math.min(e.clientY - rect.top, this._hueCanvas.height));
    this._hue = Math.round((y / this._hueCanvas.height) * 360);
    if (this._hue >= 360) this._hue = 359;
    this._emitColor();
    this._drawSLCanvas();
    this._drawHueStrip();
};

SpectrumPicker.prototype._emitColor = function() {
    var hex = hslToHex(this._hue, this._sat, this._lit);
    this._preview.style.backgroundColor = hex;
    this._hexLabel.textContent = hex;
    this._onChange(hex);
};

SpectrumPicker.prototype._drawSLCanvas = function() {
    var ctx = this._slCtx;
    var w = this._slCanvas.width;
    var h = this._slCanvas.height;

    // Base: pure hue at full saturation
    var pureColor = 'hsl(' + this._hue + ', 100%, 50%)';

    // Fill with white
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    // Horizontal gradient: white → pure hue
    var gradH = ctx.createLinearGradient(0, 0, w, 0);
    gradH.addColorStop(0, '#fff');
    gradH.addColorStop(1, pureColor);
    ctx.fillStyle = gradH;
    ctx.fillRect(0, 0, w, h);

    // Vertical gradient: transparent → black
    var gradV = ctx.createLinearGradient(0, 0, 0, h);
    gradV.addColorStop(0, 'rgba(0,0,0,0)');
    gradV.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gradV;
    ctx.fillRect(0, 0, w, h);

    // Crosshair at current position
    // Convert HSL back to HSV for position
    var s_hsl = this._sat / 100;
    var l_hsl = this._lit / 100;
    var v = l_hsl + s_hsl * Math.min(l_hsl, 1 - l_hsl);
    var s_hsv;
    if (v === 0) {
        s_hsv = 0;
    } else {
        s_hsv = 2 * (1 - l_hsl / v);
    }
    var cx = s_hsv * w;
    var cy = (1 - v) * h;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
};

SpectrumPicker.prototype._drawHueStrip = function() {
    var ctx = this._hueCtx;
    var w = this._hueCanvas.width;
    var h = this._hueCanvas.height;

    // Draw rainbow gradient
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    for (var i = 0; i <= 6; i++) {
        grad.addColorStop(i / 6, 'hsl(' + (i * 60) + ', 100%, 50%)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Indicator line at current hue
    var y = (this._hue / 360) * h;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y - 1);
    ctx.lineTo(w, y - 1);
    ctx.moveTo(0, y + 1);
    ctx.lineTo(w, y + 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
};

SpectrumPicker.prototype.setColor = function(hex) {
    var hsl = hexToHsl(hex);
    this._hue = hsl.h;
    this._sat = hsl.s;
    this._lit = hsl.l;
    this._preview.style.backgroundColor = hex;
    this._hexLabel.textContent = hex;
    this._drawSLCanvas();
    this._drawHueStrip();
};

SpectrumPicker.prototype.getColor = function() {
    return hslToHex(this._hue, this._sat, this._lit);
};

/**
 * Build preset pastilles into a container element.
 * @param {Element} container - DOM element to fill with pastilles
 * @param {Function} onSelect - callback(preset) when a pastille is clicked
 */
function buildPresetPastilles(container, onSelect) {
    if (!container || typeof NEUMORPHIC_PRESETS === 'undefined') return;
    container.innerHTML = '';
    for (var i = 0; i < NEUMORPHIC_PRESETS.length; i++) {
        (function(preset) {
            var el = document.createElement('div');
            el.className = 'preset-pastille';
            el.setAttribute('data-preset', preset.name);
            var dot = document.createElement('div');
            dot.className = 'preset-pastille-dot';
            dot.style.background = 'linear-gradient(135deg, ' + preset.bg + ' 50%, ' + preset.accent + ' 50%)';
            var label = document.createElement('span');
            label.className = 'preset-pastille-label';
            label.textContent = preset.name;
            el.appendChild(dot);
            el.appendChild(label);
            el.addEventListener('click', function() {
                var siblings = container.querySelectorAll('.preset-pastille');
                for (var j = 0; j < siblings.length; j++) siblings[j].classList.remove('active');
                el.classList.add('active');
                onSelect(preset);
            });
            container.appendChild(el);
        })(NEUMORPHIC_PRESETS[i]);
    }
}
