/**
 * Structure Display Module
 * Displays song structure (intro, verse, chorus, bridge, solo, outro) on the timeline
 */

class StructureDisplay {
    constructor(containerSelector, extractionId) {
        this.container = document.querySelector(containerSelector);
        if (!this.container) {
            console.warn('[StructureDisplay] Container not found:', containerSelector);
        }

        this.extractionId = extractionId;
        this.structureData = null;
        this.totalDuration = 0;
        this.currentTime = 0;
        this.isAnalyzing = false;
        this.enabled = false;

        // Loop state
        this.loopEnabled = false;
        this.loopSection = null;

        // Offset adjustment (in seconds)
        this.timeOffset = 0;

        this.init();
    }

    init() {
        if (!this.container) return;

        // Create structure display area and append it (don't replace innerHTML)
        const displayWrapper = document.createElement('div');
        displayWrapper.className = 'structure-display-wrapper';
        displayWrapper.innerHTML = `
            <div class="structure-timeline" id="structure-timeline">
                <!-- Structure sections will be rendered here -->
            </div>
            <div class="structure-playhead" id="structure-playhead"></div>
        `;
        this.container.appendChild(displayWrapper);

        this.timeline = document.getElementById('structure-timeline');
        this.playhead = document.getElementById('structure-playhead');

        // Try to load existing structure from EXTRACTION_INFO
        this.loadStructureFromExtractionInfo();
    }

    /**
     * Load structure from EXTRACTION_INFO global variable if available
     */
    loadStructureFromExtractionInfo() {
        if (typeof EXTRACTION_INFO !== 'undefined' && EXTRACTION_INFO && EXTRACTION_INFO.structure_data) {
            console.log('[StructureDisplay] Loading structure from EXTRACTION_INFO');
            let structureData = EXTRACTION_INFO.structure_data;

            // Parse if JSON string
            if (typeof structureData === 'string') {
                try {
                    structureData = JSON.parse(structureData);
                } catch (e) {
                    console.error('[StructureDisplay] Failed to parse structure JSON:', e);
                    return;
                }
            }

            // Check if it's LLM format (with sections property) or simple array
            let sections;
            if (structureData.sections && Array.isArray(structureData.sections)) {
                // LLM format - transform it
                console.log('[StructureDisplay] Transforming LLM structure format');
                sections = this.transformLLMStructure(structureData);
            } else if (Array.isArray(structureData)) {
                // Simple array format
                sections = structureData;
            } else {
                console.error('[StructureDisplay] Unknown structure data format');
                return;
            }

            if (sections && sections.length > 0) {
                console.log(`[StructureDisplay] Loaded ${sections.length} sections from extraction info`);

                // Calculate total duration from last section
                const duration = sections[sections.length - 1].end;

                // Load the structure
                this.loadStructure(sections, duration);

                // Show the structure container (visibility managed by TabManager)
                const container = document.getElementById('structure-container');
                if (container) {
                    container.style.display = 'block';
                }

                // Mark as enabled (structure is visible by default)
                this.enabled = true;

                // Show the structure display wrapper
                this.setVisible(true);
            }
        } else {
            console.log('[StructureDisplay] No structure data in EXTRACTION_INFO');
        }
    }

    /**
     * Analyze structure using LLM API
     */
    async analyzeStructure() {
        if (!this.extractionId) {
            console.warn('[StructureDisplay] No extraction ID provided');
            return;
        }

        if (this.isAnalyzing) {
            console.log('[StructureDisplay] Already analyzing structure...');
            return;
        }

        try {
            console.log('[StructureDisplay] Starting LLM structure analysis...');
            this.isAnalyzing = true;
            this.updateAnalyzeButton('Analyzing...', true);

            const response = await fetch(`/api/extractions/${this.extractionId}/analyze-structure`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success && data.structure) {
                console.log(`[StructureDisplay] Analysis complete: ${data.sections_count} sections detected`);

                // Transform LLM format to display format
                const sections = this.transformLLMStructure(data.structure);

                // Load the structure into the display
                if (sections.length > 0) {
                    // Calculate duration from last section
                    const duration = sections[sections.length - 1].end;
                    this.loadStructure(sections, duration);

                    // Show controls
                    this.showControls(true);

                    // Update button to show "Re-analyze"
                    this.updateAnalyzeButton('Re-analyze Structure', false);
                } else {
                    console.warn('[StructureDisplay] No valid sections in analysis result');
                    alert('Structure analysis returned no sections');
                }
            } else {
                console.error('[StructureDisplay] Failed to analyze structure:', data.error);
                alert(`Failed to analyze structure: ${data.error || 'Unknown error'}`);
            }

            this.isAnalyzing = false;
            if (!data.success) {
                this.updateAnalyzeButton('Analyze Structure', false);
            }

        } catch (error) {
            console.error('[StructureDisplay] Error analyzing structure:', error);
            this.isAnalyzing = false;
            this.updateAnalyzeButton('Analyze Structure', false);
            alert(`Error: ${error.message}`);
        }
    }

    /**
     * Transform LLM structure format to display format
     * LLM format: {sections: [{type, start, end, confidence, description}], pattern, ...}
     * Display format: [{start, end, label}, ...]
     */
    transformLLMStructure(llmStructure) {
        if (!llmStructure || !llmStructure.sections) {
            return [];
        }

        // Mapping from LLM labels to English display labels
        const labelMapping = {
            'INTRO': 'Intro',
            'VERSE': 'Verse',
            'VERSE_1': 'Verse 1',
            'VERSE_2': 'Verse 2',
            'VERSE_3': 'Verse 3',
            'CHORUS': 'Chorus',
            'CHORUS_1': 'Chorus 1',
            'CHORUS_2': 'Chorus 2',
            'CHORUS_3': 'Chorus 3',
            'BRIDGE': 'Bridge',
            'SOLO': 'Solo',
            'OUTRO': 'Outro',
            'PRE_CHORUS': 'Pre-Chorus',
            'POST_CHORUS': 'Post-Chorus',
            'INTERLUDE': 'Interlude',
            'INSTRUMENTAL': 'Instrumental',
            'BREAKDOWN': 'Breakdown'
        };

        return llmStructure.sections.map(section => ({
            start: section.start,
            end: section.end,
            label: labelMapping[section.type] || section.type
        }));
    }

    /**
     * Update analyze button state
     * @param {string} text - Button text
     * @param {boolean} disabled - Whether button is disabled
     */
    updateAnalyzeButton(text, disabled) {
        if (this.analyzeButton) {
            const label = this.analyzeButton.querySelector('span');
            if (label) {
                label.textContent = text;
            }
            this.analyzeButton.disabled = disabled;
            this.analyzeButton.style.opacity = disabled ? '0.5' : '1';
            this.analyzeButton.style.cursor = disabled ? 'not-allowed' : 'pointer';
        }
    }

    /**
     * Show/hide structure controls
     * @param {boolean} hasStructure - Whether structure is loaded
     */
    showControls(hasStructure) {
        // Structure visibility is now managed by TabManager
        // This method is kept for compatibility but does nothing
        console.log('[StructureDisplay] Structure controls managed by TabManager');
    }

    /**
     * Load structure data and render the timeline
     * @param {Array} sections - Array of {start, end, label} objects
     * @param {number} duration - Total duration in seconds
     */
    loadStructure(sections, duration) {
        if (!sections || sections.length === 0) {
            console.log('[StructureDisplay] No structure data available');
            this.clear();
            return;
        }

        console.log(`[StructureDisplay] Loading ${sections.length} sections, duration: ${duration}s`);
        this.structureData = sections;
        this.totalDuration = duration;

        this.render();
    }

    /**
     * Analyze harmonic similarity between sections
     * Returns a mapping of section indices to color groups
     */
    analyzeHarmonicSimilarity() {
        if (!window.EXTRACTION_INFO || !window.EXTRACTION_INFO.chords_data) {
            // No chord data available, fall back to label-based grouping
            return this.groupByLabel();
        }

        const chordsData = window.EXTRACTION_INFO.chords_data;
        const sectionChords = [];

        // Extract chords for each section
        this.structureData.forEach(section => {
            const chords = [];
            if (Array.isArray(chordsData)) {
                chordsData.forEach(chord => {
                    if (chord.timestamp >= section.start && chord.timestamp < section.end) {
                        chords.push(chord.chord);
                    }
                });
            }
            sectionChords.push(chords);
        });

        // Group sections by chord similarity
        const groups = {};
        let groupId = 0;

        sectionChords.forEach((chords, index) => {
            if (groups[index] !== undefined) return; // Already grouped

            groups[index] = groupId;
            const chordsSet = new Set(chords);

            // Find similar sections
            for (let j = index + 1; j < sectionChords.length; j++) {
                if (groups[j] !== undefined) continue;

                const otherChords = new Set(sectionChords[j]);
                const intersection = new Set([...chordsSet].filter(c => otherChords.has(c)));
                const union = new Set([...chordsSet, ...otherChords]);

                // Jaccard similarity
                const similarity = union.size > 0 ? intersection.size / union.size : 0;

                // If similarity > 60%, group together
                if (similarity > 0.6) {
                    groups[j] = groupId;
                }
            }

            groupId++;
        });

        return groups;
    }

    /**
     * Group sections by their original label (fallback when no chord data)
     */
    groupByLabel() {
        const groups = {};
        const labelGroups = {};
        let groupId = 0;

        this.structureData.forEach((section, index) => {
            const normalizedLabel = section.label.replace(/\d+/g, '').trim();

            if (labelGroups[normalizedLabel] === undefined) {
                labelGroups[normalizedLabel] = groupId++;
            }

            groups[index] = labelGroups[normalizedLabel];
        });

        return groups;
    }

    /**
     * Get color for a group ID
     */
    getColorForGroup(groupId) {
        // Color palette with good contrast
        const colors = [
            '#FF5722', // Red-Orange
            '#2196F3', // Blue
            '#4CAF50', // Green
            '#9C27B0', // Purple
            '#FF9800', // Orange
            '#00BCD4', // Cyan
            '#FFC107', // Amber
            '#E91E63', // Pink
            '#8BC34A', // Light Green
            '#673AB7', // Deep Purple
            '#FF5252', // Red
            '#448AFF', // Light Blue
        ];

        return colors[groupId % colors.length];
    }

    /**
     * Render the structure timeline
     */
    render() {
        if (!this.timeline || !this.structureData) return;

        this.timeline.innerHTML = '';

        // Analyze harmonic similarity and assign colors
        const groups = this.analyzeHarmonicSimilarity();

        // Render each section as a colored block with numeric label
        this.structureData.forEach((section, index) => {
            const startPercent = (section.start / this.totalDuration) * 100;
            const widthPercent = ((section.end - section.start) / this.totalDuration) * 100;

            const color = this.getColorForGroup(groups[index]);

            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'structure-section';
            sectionDiv.style.left = `${startPercent}%`;
            sectionDiv.style.width = `${widthPercent}%`;
            sectionDiv.style.backgroundColor = color;
            sectionDiv.dataset.start = section.start;
            sectionDiv.dataset.end = section.end;
            sectionDiv.dataset.label = section.label;
            sectionDiv.dataset.group = groups[index];

            // Add numeric label
            const labelSpan = document.createElement('span');
            labelSpan.className = 'structure-label';
            labelSpan.textContent = `${index + 1}`; // Numeric label starting from 1
            sectionDiv.appendChild(labelSpan);

            // Add tooltip with timing and original label info
            const startMin = Math.floor(section.start / 60);
            const startSec = Math.floor(section.start % 60);
            const endMin = Math.floor(section.end / 60);
            const endSec = Math.floor(section.end % 60);
            const duration = section.end - section.start;

            sectionDiv.title = `Section ${index + 1} (${section.label})\n${startMin}:${String(startSec).padStart(2, '0')} - ${endMin}:${String(endSec).padStart(2, '0')} (${duration.toFixed(1)}s)\nGroup: ${groups[index]}\n\nClick: Go to section\nDouble-click: Loop section`;

            // Single click to seek, double-click to loop
            sectionDiv.addEventListener('click', (e) => {
                this.onSectionClick(section, e);
            });

            sectionDiv.addEventListener('dblclick', (e) => {
                this.onSectionDoubleClick(section, e);
            });

            this.timeline.appendChild(sectionDiv);
        });

        console.log('[StructureDisplay] Rendered structure timeline with numeric labels and harmonic grouping');
    }

    /**
     * Update playhead position
     * @param {number} currentTime - Current playback time in seconds
     */
    sync(currentTime) {
        if (!this.playhead || this.totalDuration === 0) return;

        this.currentTime = currentTime;
        const percent = (currentTime / this.totalDuration) * 100;
        this.playhead.style.left = `${Math.min(100, Math.max(0, percent))}%`;

        // Highlight current section
        this.highlightCurrentSection(currentTime);
    }

    /**
     * Highlight the current section based on playback time
     * @param {number} currentTime - Current playback time in seconds
     */
    highlightCurrentSection(currentTime) {
        if (!this.timeline) return;

        const sections = this.timeline.querySelectorAll('.structure-section');
        sections.forEach(section => {
            const start = parseFloat(section.dataset.start);
            const end = parseFloat(section.dataset.end);

            if (currentTime >= start && currentTime < end) {
                section.classList.add('active');
            } else {
                section.classList.remove('active');
            }
        });
    }

    /**
     * Get the current section label
     * @param {number} currentTime - Current playback time in seconds
     * @returns {string|null} - Current section label or null
     */
    getCurrentSection(currentTime) {
        if (!this.structureData) return null;

        for (const section of this.structureData) {
            if (currentTime >= section.start && currentTime < section.end) {
                return section.label;
            }
        }
        return null;
    }

    /**
     * Handle section click (seek to section start)
     * @param {Object} section - Section data
     * @param {Event} e - Click event
     */
    onSectionClick(section, e) {
        // Prevent immediate execution on double-click
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
            return;
        }

        this.clickTimeout = setTimeout(() => {
            console.log(`[StructureDisplay] Section clicked: ${section.label} at ${section.start}s`);

            // Seek directly via the mixer's audio engine if available
            if (window.mixer && window.mixer.audioEngine) {
                window.mixer.audioEngine.seekToPosition(section.start);

                // Visual feedback
                if (window.mixer.showToast) {
                    window.mixer.showToast(`Jumping to: ${section.label}`, 'info');
                }
            }

            this.clickTimeout = null;
        }, 200);  // Reduced delay for better responsiveness
    }

    /**
     * Handle section double-click (toggle loop)
     * @param {Object} section - Section data
     * @param {Event} e - Double-click event
     */
    onSectionDoubleClick(section, e) {
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
        }

        console.log(`[StructureDisplay] Section double-clicked: ${section.label}`);

        // Toggle loop on this section
        if (this.loopEnabled && this.loopSection === section) {
            // Disable loop if already looping this section
            this.disableLoop();
        } else {
            // Enable loop on this section
            this.enableLoop(section);
        }
    }

    /**
     * Enable loop on a section
     * @param {Object} section - Section to loop
     */
    enableLoop(section) {
        this.loopEnabled = true;
        this.loopSection = section;

        console.log(`[StructureDisplay] Loop enabled on ${section.label} (${section.start}s - ${section.end}s)`);

        // Update visual feedback
        this.updateLoopVisuals();

        // Notify the audio engine
        if (window.mixer && window.mixer.audioEngine) {
            window.mixer.audioEngine.setLoopSection(section.start, section.end);
        }

        // Show toast notification
        if (window.mixer) {
            window.mixer.showToast(`Loop enabled: ${section.label}`, 'success');
        }
    }

    /**
     * Disable loop
     */
    disableLoop() {
        this.loopEnabled = false;
        this.loopSection = null;

        console.log(`[StructureDisplay] Loop disabled`);

        // Update visual feedback
        this.updateLoopVisuals();

        // Notify the audio engine
        if (window.mixer && window.mixer.audioEngine) {
            window.mixer.audioEngine.disableLoop();
        }

        // Show toast notification
        if (window.mixer) {
            window.mixer.showToast('Loop disabled', 'info');
        }
    }

    /**
     * Update visual feedback for loop state
     */
    updateLoopVisuals() {
        if (!this.timeline) return;

        const sections = this.timeline.querySelectorAll('.structure-section');
        sections.forEach(section => {
            const sectionData = {
                start: parseFloat(section.dataset.start),
                end: parseFloat(section.dataset.end),
                label: section.dataset.label
            };

            // Remove loop class from all sections
            section.classList.remove('looping');

            // Add loop class to the looping section
            if (this.loopEnabled && this.loopSection &&
                sectionData.start === this.loopSection.start &&
                sectionData.end === this.loopSection.end) {
                section.classList.add('looping');
            }
        });
    }

    /**
     * Clear the structure display
     */
    clear() {
        if (this.timeline) {
            this.timeline.innerHTML = '';
        }
        this.structureData = null;
        this.totalDuration = 0;
        this.currentTime = 0;
    }

    /**
     * Show/hide the structure display
     * @param {boolean} visible
     */
    setVisible(visible) {
        if (this.container) {
            this.container.style.display = visible ? 'block' : 'none';
        }
    }
}

// Make available globally (not ES6 module)
window.StructureDisplay = StructureDisplay;
