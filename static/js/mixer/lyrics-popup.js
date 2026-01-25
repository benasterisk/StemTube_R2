class LyricsPopup {
    constructor() {
        this.popup = document.getElementById('lyrics-popup');
        if (!this.popup) {
            return;
        }

        this.openBtn = document.getElementById('lyrics-popup-open');
        this.closeBtn = document.getElementById('lyrics-popup-close');
        this.slider = document.getElementById('lyrics-popup-slider');
        this.popupLyricsSlot = document.getElementById('lyrics-popup-lyrics');
        this.originalLyricsElement = document.querySelector('#karaoke-container-lyrics .karaoke-lyrics');
        this.originalParent = this.originalLyricsElement ? this.originalLyricsElement.parentElement : null;
        this.placeholder = null;
        this.isOpen = false;

        this.bindEvents();
    }

    bindEvents() {
        if (this.openBtn) {
            this.openBtn.addEventListener('click', () => this.open());
        }

        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => this.close());
        }

        if (this.slider) {
            this.sizeValueDisplay = document.getElementById('lyrics-popup-size-value');

            const refocus = () => {
                if (window.karaokeDisplayInstance) {
                    window.karaokeDisplayInstance.refocusCurrentLine(true);
                }
            };

            this.slider.addEventListener('input', (event) => {
                const value = parseFloat(event.target.value);
                this.applyScale(value);
                this.updateSizeDisplay(value);
            });

            this.slider.addEventListener('change', refocus);
            this.slider.addEventListener('mouseup', refocus);
            this.slider.addEventListener('touchend', refocus);
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });

        this.popup.addEventListener('click', (event) => {
            if (event.target === this.popup) {
                this.close();
            }
        });
    }

    open() {
        if (this.isOpen || !this.popupLyricsSlot) {
            return;
        }

        // Refresh reference to lyrics element (may have been created after page load)
        if (!this.originalLyricsElement) {
            this.originalLyricsElement = document.querySelector('#karaoke-container-lyrics .karaoke-lyrics');
            this.originalParent = this.originalLyricsElement ? this.originalLyricsElement.parentElement : null;
        }

        if (!this.originalLyricsElement) {
            console.warn('[LyricsPopup] No lyrics element found');
            return;
        }

        // Insert placeholder to remember where to restore lyrics
        if (!this.placeholder) {
            this.placeholder = document.createElement('div');
            this.placeholder.className = 'lyrics-placeholder';
        }

        if (this.originalParent) {
            this.originalParent.insertBefore(this.placeholder, this.originalLyricsElement);
        }

        this.popupLyricsSlot.appendChild(this.originalLyricsElement);
        this.popup.classList.add('active');
        document.body.classList.add('lyrics-popup-open');
        this.isOpen = true;

        // Reset slider to default if lyrics were scaled before
        if (this.slider) {
            this.slider.value = this.slider.value || '1';
            this.applyScale(parseFloat(this.slider.value));
        }

        if (window.karaokeDisplayInstance) {
            window.karaokeDisplayInstance.refocusCurrentLine(true);
        }
    }

    close() {
        if (!this.isOpen || !this.originalLyricsElement) {
            return;
        }

        if (this.placeholder && this.placeholder.parentNode) {
            this.placeholder.parentNode.replaceChild(this.originalLyricsElement, this.placeholder);
        } else if (this.originalParent) {
            this.originalParent.appendChild(this.originalLyricsElement);
        }

        this.popup.classList.remove('active');
        document.body.classList.remove('lyrics-popup-open');
        this.isOpen = false;

        // Reset transform when closing
        if (this.originalLyricsElement) {
            this.originalLyricsElement.style.removeProperty('transform');
            this.originalLyricsElement.style.removeProperty('transform-origin');
        }

        if (this.slider) {
            this.slider.value = '1';
            this.updateSizeDisplay(1);
        }

        if (window.karaokeDisplayInstance) {
            window.karaokeDisplayInstance.refocusCurrentLine(true);
        }
    }

    applyScale(scaleValue) {
        // Get the lyrics element fresh in case it was created after page load
        const lyricsElement = this.originalLyricsElement || document.querySelector('#karaoke-container-lyrics .karaoke-lyrics');
        if (!lyricsElement) {
            return;
        }
        const clamped = Math.min(1.6, Math.max(0.8, scaleValue || 1));
        // Use transform scale to affect all child elements uniformly
        lyricsElement.style.setProperty('transform', `scale(${clamped})`, 'important');
        lyricsElement.style.setProperty('transform-origin', 'top left', 'important');
    }

    updateSizeDisplay(value) {
        if (this.sizeValueDisplay) {
            this.sizeValueDisplay.textContent = value.toFixed(1) + 'x';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.lyricsPopup = new LyricsPopup();
});
