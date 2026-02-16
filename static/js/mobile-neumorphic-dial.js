/**
 * NeumorphicDial - Circular rotary control with touch/drag interaction
 */
class NeumorphicDial {
    constructor(element, options = {}) {
        this.element = element;
        this.min = parseFloat(element.dataset.min) || options.min || 0;
        this.max = parseFloat(element.dataset.max) || options.max || 100;
        this.step = parseFloat(element.dataset.step) || options.step || 1;
        this.value = parseFloat(element.dataset.value) || options.initial || this.min;
        this.onChange = options.onChange || (() => {});
        this.onChangeEnd = options.onChangeEnd || (() => {});
        this.formatValue = options.formatValue || (v => v.toString());

        this.indicator = element.querySelector('.dial-indicator');
        this.valueDisplay = element.querySelector('.dial-value');

        this.isDragging = false;
        this.lastAngle = 0;
        this.accumulatedRotation = 0;

        this.setupEvents();
        this.updateDisplay();
    }

    setupEvents() {
        // Touch events
        this.element.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.onEnd(e));

        // Mouse events (for testing on desktop)
        this.element.addEventListener('mousedown', (e) => this.onStart(e));
        document.addEventListener('mousemove', (e) => this.onMove(e));
        document.addEventListener('mouseup', (e) => this.onEnd(e));
    }

    getEventCoords(e) {
        if (e.touches && e.touches.length > 0) {
            return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
        return { x: e.clientX, y: e.clientY };
    }

    onStart(e) {
        e.preventDefault();
        this.isDragging = true;
        this.element.classList.add('active');

        const rect = this.element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const coords = this.getEventCoords(e);

        this.lastAngle = Math.atan2(coords.y - centerY, coords.x - centerX);
        this.accumulatedRotation = this.valueToRotation(this.value);
    }

    onMove(e) {
        if (!this.isDragging) return;
        e.preventDefault();

        const rect = this.element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const coords = this.getEventCoords(e);

        const currentAngle = Math.atan2(coords.y - centerY, coords.x - centerX);
        let deltaAngle = currentAngle - this.lastAngle;

        // Handle wrap-around at -PI/PI boundary
        if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
        if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;

        this.accumulatedRotation += deltaAngle;
        this.lastAngle = currentAngle;

        // Convert rotation to value
        const newValue = this.rotationToValue(this.accumulatedRotation);
        const clampedValue = Math.max(this.min, Math.min(this.max, newValue));
        const steppedValue = Math.round(clampedValue / this.step) * this.step;

        if (steppedValue !== this.value) {
            this.value = steppedValue;
            this.updateDisplay();
            this.onChange(this.value);
        }
    }

    onEnd(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.element.classList.remove('active');
        this.onChangeEnd(this.value);
    }

    valueToRotation(value) {
        // Map value range to rotation range (-150deg to 150deg = -2.618 to 2.618 radians)
        const range = this.max - this.min;
        const normalized = (value - this.min) / range;
        return (normalized - 0.5) * (300 * Math.PI / 180);
    }

    rotationToValue(rotation) {
        // Map rotation to value
        const maxRotation = 150 * Math.PI / 180;
        const clampedRotation = Math.max(-maxRotation, Math.min(maxRotation, rotation));
        const normalized = (clampedRotation / (300 * Math.PI / 180)) + 0.5;
        return this.min + normalized * (this.max - this.min);
    }

    updateDisplay() {
        // Update indicator rotation
        if (this.indicator) {
            const rotation = this.valueToRotation(this.value) * (180 / Math.PI);
            this.indicator.style.transform = `rotate(${rotation}deg)`;
        }

        // Update value display
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.formatValue(this.value);
        }
    }

    setValue(value, triggerCallback = false) {
        this.value = Math.max(this.min, Math.min(this.max, value));
        this.accumulatedRotation = this.valueToRotation(this.value);
        this.updateDisplay();
        if (triggerCallback) {
            this.onChange(this.value);
        }
    }

    getValue() {
        return this.value;
    }
}
