/**
 * StemTubes Mixer - Tab Manager Module
 * Manages switching between Mixer, Chords, and Lyrics tabs
 */

class TabManager {
    /**
     * Constructor
     * @param {StemMixer} mixer - Reference to main mixer instance
     */
    constructor(mixer) {
        this.mixer = mixer;
        this.currentTab = 'mixer'; // 'mixer', 'chords', or 'lyrics'
        this.validTabs = ['mixer', 'chords', 'lyrics'];
        this.practiceTabs = new Set(['chords', 'lyrics']);

        // Section visibility state (for practice tabs)
        this.sectionVisibility = this.loadVisibilityState() || {
            chords: true,
            structure: true,
            lyrics: true
        };

        // DOM elements
        this.elements = {
            mixerApp: document.getElementById('mixer-app'),
            mixerTabBtn: document.getElementById('mixer-tab-btn'),
            chordsTabBtn: document.getElementById('chords-tab-btn'),
            lyricsTabBtn: document.getElementById('lyrics-tab-btn'),

            // Visibility toggle buttons
            chordsToggle: document.getElementById('chords-visibility-toggle'),
            structureToggle: document.getElementById('structure-visibility-toggle'),
            lyricsToggle: document.getElementById('lyrics-visibility-toggle'),

            // Sections to show/hide
            chordDisplay: document.getElementById('chord-display'),
            structureContainer: document.getElementById('structure-container'),
            karaokeLyricsContainer: document.getElementById('karaoke-container-lyrics')
        };

        this.init();
    }

    /**
     * Initialize tab manager
     */
    init() {
        this.log('Initializing tab manager...');

        // Setup tab button event listeners
        if (this.elements.mixerTabBtn) {
            this.elements.mixerTabBtn.addEventListener('click', () => {
                this.switchTab('mixer');
            });
        }

        if (this.elements.chordsTabBtn) {
            this.elements.chordsTabBtn.addEventListener('click', () => {
                this.switchTab('chords');
            });
        }

        if (this.elements.lyricsTabBtn) {
            this.elements.lyricsTabBtn.addEventListener('click', () => {
                this.switchTab('lyrics');
            });
        }

        // Setup visibility toggle buttons
        this.setupVisibilityToggles();

        // Restore saved tab state
        const savedTab = this.normalizeTabName(localStorage.getItem('mixer_active_tab'));
        if (savedTab && this.validTabs.includes(savedTab)) {
            this.switchTab(savedTab, false); // false = don't save to localStorage again
        }

        // Apply initial visibility state
        this.applyVisibilityState();

        this.log('Tab manager initialized');
    }

    /**
     * Switch between tabs
     * @param {string} tabName - 'mixer', 'chords', or 'lyrics'
     * @param {boolean} saveState - Whether to save to localStorage (default: true)
     */
    switchTab(tabName, saveState = true) {
        if (!this.validTabs.includes(tabName)) {
            this.log(`Invalid tab name: ${tabName}`);
            return;
        }

        if (this.currentTab === tabName) {
            return; // Already on this tab
        }

        this.log(`Switching from ${this.currentTab} to ${tabName}`);

        // Update current tab
        const previousTab = this.currentTab;
        this.currentTab = tabName;

        // Update data-active-tab attribute on mixer-app
        if (this.elements.mixerApp) {
            this.elements.mixerApp.setAttribute('data-active-tab', tabName);
        }

        // Update tab button active states
        if (this.elements.mixerTabBtn) {
            this.elements.mixerTabBtn.classList.toggle('active', tabName === 'mixer');
        }
        if (this.elements.chordsTabBtn) {
            this.elements.chordsTabBtn.classList.toggle('active', tabName === 'chords');
        }
        if (this.elements.lyricsTabBtn) {
            this.elements.lyricsTabBtn.classList.toggle('active', tabName === 'lyrics');
        }

        // Save state to localStorage
        if (saveState) {
            localStorage.setItem('mixer_active_tab', tabName);
        }

        // Apply visibility state for chords/lyrics practice tabs
        if (this.isPracticeTab(tabName)) {
            this.applyVisibilityState();
        }

        // Trigger waveform resize/update after tab switch
        setTimeout(() => {
            if (this.mixer.waveform) {
                this.mixer.waveform.resizeAllWaveforms();
                this.mixer.waveform.updateAllWaveforms();
            }
        }, 100);

        // Emit event for other modules
        window.dispatchEvent(new CustomEvent('tabSwitched', {
            detail: {
                from: previousTab,
                to: tabName
            }
        }));

        this.log(`Switched to ${tabName} mode`);
    }

    /**
     * Setup visibility toggle buttons
     */
    setupVisibilityToggles() {
        // Chords visibility toggle
        if (this.elements.chordsToggle) {
            this.elements.chordsToggle.addEventListener('click', () => {
                this.toggleSectionVisibility('chords');
            });
        }

        // Structure visibility toggle
        if (this.elements.structureToggle) {
            this.elements.structureToggle.addEventListener('click', () => {
                this.toggleSectionVisibility('structure');
            });
        }

        // Lyrics visibility toggle
        if (this.elements.lyricsToggle) {
            this.elements.lyricsToggle.addEventListener('click', () => {
                this.toggleSectionVisibility('lyrics');
            });
        }
    }

    /**
     * Toggle visibility of a section in practice tabs
     * @param {string} sectionName - 'chords', 'structure', or 'lyrics'
     */
    toggleSectionVisibility(sectionName) {
        if (!['chords', 'structure', 'lyrics'].includes(sectionName)) {
            this.log(`Invalid section name: ${sectionName}`);
            return;
        }

        // Toggle visibility state
        this.sectionVisibility[sectionName] = !this.sectionVisibility[sectionName];

        // Save to localStorage
        this.saveVisibilityState();

        // Apply the new state
        this.applyVisibilityState();

        this.log(`Toggled ${sectionName} visibility: ${this.sectionVisibility[sectionName]}`);
    }

    /**
     * Apply visibility state to sections
     */
    applyVisibilityState() {
        // Chords
        if (this.elements.chordDisplay && this.elements.chordsToggle) {
            const visible = this.sectionVisibility.chords;

            // Toggle section-hidden class on the content element
            this.elements.chordDisplay.classList.toggle('section-hidden', !visible);

            // Update button text and icon
            const span = this.elements.chordsToggle.querySelector('span');
            if (span) {
                span.textContent = visible ? 'Hide Chords' : 'Show Chords';
            }

            // Update button icon (eye-slash when visible = clicking will hide)
            const icon = this.elements.chordsToggle.querySelector('i');
            if (icon) {
                icon.className = visible ? 'fas fa-eye-slash' : 'fas fa-eye';
            }
        }

        // Structure
        if (this.elements.structureContainer && this.elements.structureToggle) {
            const visible = this.sectionVisibility.structure;

            // Find the structure display wrapper (rendered by structure-display.js)
            const structureWrapper = this.elements.structureContainer.querySelector('.structure-display-wrapper');
            if (structureWrapper) {
                structureWrapper.classList.toggle('section-hidden', !visible);
            }

            // Update button text and icon
            const span = this.elements.structureToggle.querySelector('span');
            if (span) {
                span.textContent = visible ? 'Hide Structure' : 'Show Structure';
            }

            // Update button icon (eye-slash when visible = clicking will hide)
            const icon = this.elements.structureToggle.querySelector('i');
            if (icon) {
                icon.className = visible ? 'fas fa-eye-slash' : 'fas fa-eye';
            }
        }

        // Lyrics
        if (this.elements.karaokeLyricsContainer && this.elements.lyricsToggle) {
            const visible = this.sectionVisibility.lyrics;

            // Find the lyrics display element
            const lyricsDisplay = this.elements.karaokeLyricsContainer.querySelector('.karaoke-lyrics');
            if (lyricsDisplay) {
                lyricsDisplay.classList.toggle('section-hidden', !visible);
            }

            // Update button text and icon
            const span = this.elements.lyricsToggle.querySelector('span');
            if (span) {
                span.textContent = visible ? 'Hide Lyrics' : 'Show Lyrics';
            }

            // Update button icon (eye-slash when visible = clicking will hide)
            const icon = this.elements.lyricsToggle.querySelector('i');
            if (icon) {
                icon.className = visible ? 'fas fa-eye-slash' : 'fas fa-eye';
            }
        }
    }

    /**
     * Save visibility state to localStorage
     */
    saveVisibilityState() {
        localStorage.setItem('mixer_section_visibility', JSON.stringify(this.sectionVisibility));
    }

    /**
     * Load visibility state from localStorage
     * @returns {Object|null} Visibility state or null if not found
     */
    loadVisibilityState() {
        try {
            const saved = localStorage.getItem('mixer_section_visibility');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (error) {
            this.log(`Error loading visibility state: ${error.message}`);
        }
        return null;
    }

    /**
     * Normalize legacy tab names to new ones
     * @param {string|null} tabName - Raw tab name
     * @returns {string|null} Normalized tab name
     */
    normalizeTabName(tabName) {
        if (!tabName) {
            return null;
        }
        if (tabName === 'rehearsal') {
            return 'chords';
        }
        return tabName;
    }

    /**
     * Get current active tab
     * @returns {string} Current tab name
     */
    getCurrentTab() {
        return this.currentTab;
    }

    /**
     * Check if the current tab (or supplied tab) is a practice tab
     * @param {string|null} tabName - Optional tab to check
     * @returns {boolean} True if tab is chords or lyrics
     */
    isPracticeTab(tabName = null) {
        const targetTab = tabName || this.currentTab;
        return this.practiceTabs.has(targetTab);
    }

    /**
     * Check if a specific tab is active
     * @param {string} tabName - Tab name to check
     * @returns {boolean} True if tab is active
     */
    isTabActive(tabName) {
        return this.currentTab === tabName;
    }

    /**
     * Logger with timestamp
     * @param {string} message - Log message
     */
    log(message) {
        console.log(`[TabManager] ${new Date().toISOString().slice(11, 19)} - ${message}`);
    }
}
