/**
 * StemTubes Mixer - Timeline
 * Timeline and playhead management for the mixer
 */

class Timeline {
    /**
     * Timeline constructor
     * @param {StemMixer} mixer - Main mixer instance
     */
    constructor(mixer) {
        this.mixer = mixer;
        this.markerInterval = 5; // Interval between time markers in seconds
        this.isDragging = false; // To track dragging state
        this.justFinishedDragging = false; // To avoid click/drag conflicts

        // Bind methods to use them as event handlers
        this.boundMouseMove = this.handleMouseMove.bind(this);
        this.boundMouseUp = this.handleMouseUp.bind(this);
    }
    
    /**
     * Create time markers on the timeline
     */
    createTimeMarkers() {
        // Check if timeline element exists
        if (!this.mixer.elements.timeline) return;

        // Get or create markers container
        let markersContainer = this.mixer.elements.timeline.querySelector('.timeline-markers');
        if (!markersContainer) {
            markersContainer = document.createElement('div');
            markersContainer.className = 'timeline-markers';
            this.mixer.elements.timeline.appendChild(markersContainer);
        } else {
            // Clean up existing markers
            markersContainer.innerHTML = '';
        }

        // Check if duration is available
        if (!this.mixer.maxDuration) {
            this.mixer.log('Duration not available to create markers');
            return;
        }

        // Create markers at regular intervals
        const duration = this.mixer.maxDuration;
        
        // Calculate interval between main markers
        // For short tracks, use shorter intervals
        this.markerInterval = duration <= 60 ? 5 :
                            duration <= 180 ? 10 :
                            duration <= 600 ? 30 : 60;

        // Calculate subdivisions
        const intermediateCount = 2; // Number of intermediate divisions between main markers
        const minorCount = 4; // Number of minor divisions between each intermediate marker

        // Calculate intermediate and minor intervals
        const intermediateInterval = this.markerInterval / intermediateCount;
        const minorInterval = intermediateInterval / minorCount;
        
        // Create all markers (main, intermediate and minor)
        for (let time = 0; time <= duration; time += minorInterval) {
            // Determine marker type
            const isMainMarker = Math.abs(time % this.markerInterval) < 0.001;
            const isIntermediateMarker = !isMainMarker && Math.abs(time % intermediateInterval) < 0.001;
            const isMinorMarker = !isMainMarker && !isIntermediateMarker;

            // If not a marker (rounding error), skip to next
            if (time > 0 && !isMainMarker && !isIntermediateMarker && !isMinorMarker) continue;

            // Create marker
            const marker = document.createElement('div');
            marker.className = 'timeline-marker';
            
            // Add appropriate class according to marker type
            if (isIntermediateMarker) marker.classList.add('intermediate');
            if (isMinorMarker) marker.classList.add('minor');

            // Calculate position in percentage
            const position = (time / duration) * 100;
            marker.style.left = `${position}%`;

            // Format time for display (only for main and intermediate markers)
            if (!isMinorMarker) {
                marker.textContent = this.mixer.formatTime(time);
            }

            // Add marker to container
            markersContainer.appendChild(marker);
        }

        this.mixer.log('Timeline markers created with subdivisions');
    }
    
    /**
     * Update playhead position
     * @param {number} position - Position in seconds
     */
    updatePlayhead(position) {
        // Check if playhead element exists
        if (!this.mixer.elements.playhead) return;

        // Calculate position in percentage
        let positionPercent = 0;
        if (this.mixer.maxDuration > 0) {
            positionPercent = (position / this.mixer.maxDuration) * 100;
        }
        
        // Clamp position between 0% and 100%
        const clampedPercent = Math.max(0, Math.min(positionPercent, 100));

        // Update main playhead position
        this.mixer.elements.playhead.style.left = `${clampedPercent}%`;

        // Update track playheads
        this.mixer.waveform.updateWaveformPlayheads(position);
    }
    
    /**
     * Handle timeline clicks
     * @param {Event} event - Click event
     */
    handleTimelineClick(event) {
        // Ignore if we just finished dragging
        if (this.justFinishedDragging) {
            return;
        }

        // Check if timeline element exists
        if (!this.mixer.elements.timeline) return;

        // Calculate relative click position
        const timelineRect = this.mixer.elements.timeline.getBoundingClientRect();
        const clickPosition = event.clientX - timelineRect.left;
        const clickPercent = clickPosition / timelineRect.width;
        
        // Calculate corresponding time position
        const newPosition = clickPercent * this.mixer.maxDuration;

        // Seek to new position
        this.mixer.audioEngine.seekToPosition(newPosition);

        this.mixer.log(`Timeline clicked: position ${newPosition.toFixed(2)}s`);
    }
    
    /**
     * Handle start of dragging (mousedown) on timeline
     * @param {MouseEvent} event - Mousedown event
     */
    handleMouseDown(event) {
        // Check if timeline element exists
        if (!this.mixer.elements.timeline) return;

        // Enable dragging mode
        this.isDragging = true;

        // Enable scratching mode in AudioEngine
        this.mixer.audioEngine.startScratchMode();

        // Directly simulate first scratch at click position
        this.handleMouseMove(event);

        // Add event listeners to track movement
        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
        
        // Prevent text selection during dragging
        event.preventDefault();
    }
    
    /**
     * Handle movement (mousemove) during dragging
     * @param {MouseEvent} event - Mousemove event
     */
    handleMouseMove(event) {
        // Check if we are in dragging mode
        if (!this.isDragging) return;

        // Calculate relative cursor position
        const timelineRect = this.mixer.elements.timeline.getBoundingClientRect();
        const cursorPosition = Math.max(0, Math.min(event.clientX - timelineRect.left, timelineRect.width));
        const positionPercent = cursorPosition / timelineRect.width;
        
        // Calculate corresponding time position
        const newPosition = positionPercent * this.mixer.maxDuration;

        // Apply scratching at this position
        this.mixer.audioEngine.scratchAt(newPosition);
    }
    
    /**
     * Handle end of dragging (mouseup)
     * @param {MouseEvent} event - Mouseup event
     */
    handleMouseUp(event) {
        // Check if we were in dragging mode
        if (!this.isDragging) return;

        // Mark as finished to avoid conflict with click
        const wasDragging = this.isDragging;

        // Disable dragging mode
        this.isDragging = false;

        // Disable scratching mode
        this.mixer.audioEngine.stopScratchMode();

        // Calculate final position
        const timelineRect = this.mixer.elements.timeline.getBoundingClientRect();
        const finalPosition = Math.max(0, Math.min(event.clientX - timelineRect.left, timelineRect.width));
        const positionPercent = finalPosition / timelineRect.width;
        const finalTime = positionPercent * this.mixer.maxDuration;
        
        // Use seekToPosition method for clean navigation
        this.mixer.audioEngine.seekToPosition(finalTime);

        // Remove event listeners
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);

        // Mark that we just finished dragging to avoid conflict with click
        this.justFinishedDragging = true;
        setTimeout(() => {
            this.justFinishedDragging = false;
        }, 100);
    }
    
    /**
     * Update time markers based on duration
     */
    updateTimeMarkers() {
        // Recreate time markers
        this.createTimeMarkers();
    }

    /**
     * Calculate time corresponding to a percentage position
     * @param {number} percent - Position in percentage
     * @returns {number} Time in seconds
     */
    percentToTime(percent) {
        return (percent / 100) * this.mixer.maxDuration;
    }
    
    /**
     * Calculate percentage corresponding to a time
     * @param {number} time - Time in seconds
     * @returns {number} Position in percentage
     */
    timeToPercent(time) {
        if (this.mixer.maxDuration <= 0) return 0;
        return (time / this.mixer.maxDuration) * 100;
    }
}
