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
                try { localStorage.setItem('lyrics_popup_scale', String(value)); } catch (e) { /* blocked storage */ }
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

        // Restore the musician's preferred stage size (persisted), else the
        // slider's default from the template.
        if (this.slider) {
            let saved = null;
            try { saved = localStorage.getItem('lyrics_popup_scale'); } catch (e) { /* blocked storage */ }
            if (saved && !isNaN(parseFloat(saved))) this.slider.value = saved;
            const v = parseFloat(this.slider.value) || 1.25;
            this.applyScale(v);
            this.updateSizeDisplay(v);
        }

        if (window.karaokeDisplayInstance) {
            window.karaokeDisplayInstance.refocusCurrentLine(true);
        }
    }

    close() {
        if (!this.isOpen || !this.originalLyricsElement) {
            return;
        }

        // If the lyrics live in a detached (PiP) window, bring them back first
        // so the restore below moves the real element, not a stale reference.
        if (window.PopupDetach && window.PopupDetach.isDetached('lyrics')) {
            window.PopupDetach.reattach('lyrics');
        }

        if (this.placeholder && this.placeholder.parentNode) {
            this.placeholder.parentNode.replaceChild(this.originalLyricsElement, this.placeholder);
        } else if (this.originalParent) {
            this.originalParent.appendChild(this.originalLyricsElement);
        }

        this.popup.classList.remove('active');
        document.body.classList.remove('lyrics-popup-open');
        this.isOpen = false;

        // Drop the stage scale when returning to the practice tab (the CSS
        // there sizes the lyrics itself); the slider keeps the user's choice.
        if (this.originalLyricsElement) {
            this.originalLyricsElement.style.removeProperty('--lyrics-scale');
            this.originalLyricsElement.style.removeProperty('transform');
            this.originalLyricsElement.style.removeProperty('transform-origin');
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
        const clamped = Math.min(3.0, Math.max(0.8, scaleValue || 1));
        // Real font scaling (not transform: scale): the text reflows inside the
        // popup width and stays centered, so a stage-size 3x setting is readable
        // instead of overflowing off the right edge. The CSS reads --lyrics-scale.
        lyricsElement.style.setProperty('--lyrics-scale', String(clamped));
        lyricsElement.style.removeProperty('transform');
        lyricsElement.style.removeProperty('transform-origin');
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
