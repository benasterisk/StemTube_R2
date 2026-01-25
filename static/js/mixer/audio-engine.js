/**
 * StemTubes Mixer - Audio Engine
 * Management de l'audio pour le mixeur : loadedment, lecture, pause, etc.
 */

class AudioEngine {
    /**
     * Constructeur du moteur audio
     * @param {StemMixer} mixer - Instance principale du mixeur
     */
    constructor(mixer) {
        this.mixer = mixer;
        this.audioContext = null;
        this.masterGainNode = null;
        this.analyserNode = null;
        this.animationFrameId = null;
        this.isPausing = false;
        this.isScratchMode = false;  // Nouvel state pour le mode scratching
        this.scratchBufferDuration = 0.1;  // Durée de chaque segment de scratch en secondes
        this.lastScratchTime = 0;  // Pour le throttling du scratch
        this.scratchThrottle = 50;  // Minimum 50ms entre les scratch segments

        // Loop state
        this.loopEnabled = false;
        this.loopStart = 0;
        this.loopEnd = 0;

        // Precise playback tracking (accounts for tempo changes)
        this.playbackPosition = 0;     // Position within the song (seconds)
        this.lastRealTime = null;      // audioContext.currentTime at last update
    }
    
    /**
     * Initialiser le contexte audio
     */
    async initAudioContext() {
        try {
            // Créer le contexte audio
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // Créer le nœud de gain principal
            this.masterGainNode = this.audioContext.createGain();
            this.masterGainNode.connect(this.audioContext.destination);
            
            // Créer un nœud d'analyseur pour les visualisations
            this.analyserNode = this.audioContext.createAnalyser();
            this.analyserNode.fftSize = 2048;
            this.masterGainNode.connect(this.analyserNode);
            
            this.mixer.log('Contexte audio initialisé');
            return true;
        } catch (error) {
            this.mixer.log(`Error lors de l'initialisation du contexte audio: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Charger un stem audio
     * @param {string} name - Nom du stem
     * @param {string} url - URL du fichier audio
     */
    async loadStem(name, url) {
        try {
            this.mixer.log(`Chargement du stem ${name} depuis ${url}`);
            
            // Créer un élément de track pour ce stem
            this.mixer.trackControls.createTrackElement(name);
            
            // Initialiser l'objet stem
            this.mixer.stems[name] = {
                name,
                url,
                buffer: null,
                source: null,
                gainNode: null,
                panNode: null,
                volume: 1,
                pan: 0,
                muted: false,
                solo: false,
                active: true,
                waveformData: null
            };
            
            // Get le fichier audio
            const response = await fetch(url);
            
            if (!response.ok) {
                if (response.status === 404) {
                    this.mixer.log(`Le stem ${name} n'existe pas (404)`);
                    return;
                }
                throw new Error(`Error lors du loadedment du stem ${name}: ${response.status}`);
            }
            
            // Convertir la réponse en ArrayBuffer
            const arrayBuffer = await response.arrayBuffer();
            
            // Décoder l'audio
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            
            // Stocker le buffer audio
            this.mixer.stems[name].buffer = audioBuffer;
            
            // Extraire les données de forme d'onde
            await this.extractWaveformData(name);
            
            this.mixer.log(`Stem ${name} chargé with succès`);
        } catch (error) {
            this.mixer.log(`Error lors du loadedment du stem ${name}: ${error.message}`);
        }
    }
    
    /**
     * Extraire les données de forme d'onde d'un stem
     * @param {string} name - Nom du stem
     */
    async extractWaveformData(name) {
        const stem = this.mixer.stems[name];
        if (!stem || !stem.buffer) return;
        
        // Obtenir les données audio du buffer
        const audioBuffer = stem.buffer;
        const channelData = audioBuffer.getChannelData(0); // Utiliser le premier canal pour la forme d'onde
        
        // Réduire la résolution pour de meilleures performances
        const numberOfSamples = Math.min(audioBuffer.length, 2000);
        const blockSize = Math.floor(channelData.length / numberOfSamples);
        const waveformData = [];
        
        for (let i = 0; i < numberOfSamples; i++) {
            const blockStart = i * blockSize;
            let blockSum = 0;
            
            // Calculer la valeur moyenne absolue pour ce bloc
            for (let j = 0; j < blockSize && (blockStart + j) < channelData.length; j++) {
                blockSum += Math.abs(channelData[blockStart + j]);
            }
            
            // Stocker la valeur moyenne
            waveformData.push(blockSum / blockSize);
        }
        
        // Stocker les données de forme d'onde
        stem.waveformData = waveformData;
        
        // Dessiner la forme d'onde
        this.mixer.waveform.drawWaveform(name);
    }
    
    /**
     * Configurer les nœuds audio pour un stem
     * @param {string} name - Nom du stem
     */
    setupAudioNodes(name) {
        const stem = this.mixer.stems[name];
        if (!stem || !stem.buffer) return null;
        
        // Créer la source audio
        stem.source = this.audioContext.createBufferSource();
        stem.source.buffer = stem.buffer;
        const playbackRate = window.simplePitchTempo?.cachedPlaybackRate || 1.0;
        stem.source.playbackRate.value = playbackRate;
        
        
        // Créer le nœud de gain
        stem.gainNode = this.audioContext.createGain();
        stem.gainNode.gain.value = stem.muted ? 0 : stem.volume;
        
        // Créer le nœud de panoramique
        stem.panNode = this.audioContext.createStereoPanner();
        stem.panNode.pan.value = stem.pan;
        
        // Tenter d'ajouter SoundTouch si disponible
        if (window.simplePitchTempo && window.simplePitchTempo.workletLoaded) {
            try {
                // Créer un nœud SoundTouch pour ce stem
                stem.soundTouchNode = new AudioWorkletNode(this.audioContext, 'soundtouch-processor');

                // Use cached parameters from SimplePitchTempo if available
                // This ensures changes made before playback are applied
                const tempoRatio = window.simplePitchTempo.cachedTempoRatio ||
                                 (window.simplePitchTempo.currentBPM / window.simplePitchTempo.originalBPM);
                const pitchRatio = window.simplePitchTempo.cachedPitchRatio ||
                                 Math.pow(2, window.simplePitchTempo.currentPitchShift / 12);

                // Apply SoundTouch parameters for independent tempo/pitch control
                // - tempo: changes speed WITHOUT affecting pitch
                // - pitch: changes pitch WITHOUT affecting tempo
                // - rate: must stay at 1.0 for independent control
                stem.soundTouchNode.parameters.get('tempo').value = window.simplePitchTempo.cachedTempoRatio || tempoRatio;
                stem.soundTouchNode.parameters.get('pitch').value = window.simplePitchTempo.cachedPitchRatio || pitchRatio;
                stem.soundTouchNode.parameters.get('rate').value = 1.0;

                // Connecter : source -> SoundTouch -> gain -> pan -> master
                stem.source.connect(stem.soundTouchNode);
                stem.soundTouchNode.connect(stem.gainNode);
                stem.gainNode.connect(stem.panNode);
                stem.panNode.connect(this.masterGainNode);

                console.log(`[AudioEngine] ✓ SoundTouch enabled for ${name} (tempo: ${(window.simplePitchTempo.cachedTempoRatio || tempoRatio).toFixed(3)}, pitch: ${(window.simplePitchTempo.cachedPitchRatio || pitchRatio).toFixed(3)}, playbackRate: ${playbackRate.toFixed(3)})`);
            } catch (error) {
                console.warn(`[AudioEngine] ✗ SoundTouch failed for ${name}, using direct connection:`, error);
                // Connexion normale en cas d'error
                stem.source.connect(stem.gainNode);
                stem.gainNode.connect(stem.panNode);
                stem.panNode.connect(this.masterGainNode);
            }
        } else {
            // Connexion normale sans SoundTouch
            console.log(`[AudioEngine] No SoundTouch for ${name} - using direct connection (workletLoaded: ${window.simplePitchTempo?.workletLoaded})`);
            stem.source.connect(stem.gainNode);
            stem.gainNode.connect(stem.panNode);
            stem.panNode.connect(this.masterGainNode);
        }
        
        // Configurer l'événement de fin de lecture
        stem.source.onended = () => {
            this.handleStemEnded(name);
        };
        
        
        return stem.source;
    }
    
    /**
     * Gérer la fin de lecture d'un stem
     * @param {string} name - Nom du stem
     */
    handleStemEnded(name) {
        this.mixer.log(`Lecture terminée pour ${name}`);
        
        // Clean up la source
        this.mixer.stems[name].source = null;
        
        // Si nous sommes en train de mettre en pause, ne pas réinitialiser la position
        if (this.isPausing) {
            return;
        }
        
        // Vérifier si toutes les sources actives ont terminé leur lecture
        const allEnded = Object.values(this.mixer.stems).every(stem => 
            !stem.active || !stem.source
        );
        
        if (allEnded) {
            this.mixer.log('Toutes les tracks ont terminé leur lecture');
            this.mixer.isPlaying = false;
            this.setPlaybackPosition(0);
            this.mixer.updatePlayPauseButton();
            this.stopPlaybackAnimation();
            this.mixer.timeline.updatePlayhead(0);
        }
    }
    
    /**
     * Démarrer la lecture
     */
    play() {
        // Réinitialiser l'state du contexte audio si nécessaire
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        // Update precise playback tracking
        this.playbackPosition = Math.max(0, Math.min(this.mixer.currentTime || 0, this.mixer.maxDuration));
        this.lastRealTime = this.audioContext.currentTime;
        
        // Effectuer un nettoyage explicite des sources existing avant d'en créer de news
        Object.values(this.mixer.stems).forEach(stem => {
            if (stem.source) {
                try {
                    // Remove l'événement onended avant d'arrêter la source
                    stem.source.onended = null;
                    stem.source.stop();
                } catch (e) {
                    // Ignorer les errors si la source est déjà arrêtée
                }
                stem.source = null;
            }
        });
        
        // Log pour débogage
        // this.mixer.log(`Démarrage de la lecture à partir de la position ${this.mixer.currentTime.toFixed(2)}s`);
        
        // Démarrer la lecture de chaque stem actif
        Object.entries(this.mixer.stems).forEach(([name, stem]) => {
            if (stem.active && stem.buffer) {
                // Créer de nouveaux nœuds audio pour éviter les problèmes de réutilisation
                this.setupAudioNodes(name);
                
                // Démarrer la lecture à la position actuelle précise
                if (stem.source) {
                    try {
                        // Utiliser un offset exact pour commencer à la bonne position
                        const offset = Math.min(this.mixer.currentTime, stem.buffer.duration);
                        stem.source.start(0, offset);
                        // this.mixer.log(`Lecture du stem ${name} à partir de la position ${offset.toFixed(2)}s`);
                    } catch (e) {
                        this.mixer.log(`Error lors du démarrage du stem ${name}: ${e.message}`);
                    }
                }
            }
        });
        
        // Update l'state de lecture
        this.mixer.isPlaying = true;
        
        // Update l'affichage du button
        this.mixer.updatePlayPauseButton();
        
        // Démarrer l'animation de la tête de lecture
        this.startPlaybackAnimation();
    }
    
    /**
     * Mettre en pause la lecture
     */
    pause() {
        // Sauvegarder la position actuelle avant d'arrêter les sources
        if (this.mixer.isPlaying) {
            this.updatePlaybackClock();
            this.mixer.log(`Pause à la position: ${this.mixer.currentTime.toFixed(2)}s`);
        }
        
        // Arrêter la lecture de chaque stem en désactivant d'abord les événements onended
        Object.entries(this.mixer.stems).forEach(([name, stem]) => {
            if (stem.source) {
                // Remove l'événement onended pour éviter le déclenchement lors de la pause
                stem.source.onended = null;
                
                try {
                    stem.source.stop();
                } catch (e) {
                    // Ignorer les errors si la source est déjà arrêtée
                }
                
                stem.source = null;
            }
        });
        
        // Update l'state de lecture
        this.mixer.isPlaying = false;
        
        // Update l'affichage du button
        this.mixer.updatePlayPauseButton();
        
        // Arrêter l'animation de la tête de lecture
        this.stopPlaybackAnimation();
        
        // Update l'affichage du temps et la position du playhead pour refléter la position actuelle
        this.mixer.updateTimeDisplay();
        this.mixer.timeline.updatePlayhead(this.mixer.currentTime);
    }
    
    /**
     * Arrêter la lecture
     */
    stop() {
        // Arrêter la lecture de chaque stem
        Object.values(this.mixer.stems).forEach(stem => {
            if (stem.source) {
                // On peut garder onended ici car on veut vraiment réinitialiser
                try {
                    stem.source.stop();
                } catch (e) {
                    // Ignorer les errors si la source est déjà arrêtée
                }
                
                stem.source = null;
            }
        });
        
        // Update l'state de lecture
        this.mixer.isPlaying = false;
        
        // Update l'affichage du button
        this.mixer.updatePlayPauseButton();
        
        // Réinitialiser la position actuelle
        this.setPlaybackPosition(0);
        
        // Arrêter l'animation de la tête de lecture
        this.stopPlaybackAnimation();
        
        // Réinitialiser la position de la tête de lecture
        this.mixer.timeline.updatePlayhead(0);

        // Update l'affichage du temps
        this.mixer.updateTimeDisplay();

        // Réinitialiser l'affichage des accords
        if (this.mixer.chordDisplay) {
            this.mixer.chordDisplay.reset();
        }

        this.mixer.log('Lecture arrêtée et position réinitialisée à 0');
    }
    
    /**
     * Démarrer l'animation de la tête de lecture
     */
    startPlaybackAnimation() {
        // Arrêter l'animation existante si nécessaire
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        // Fonction d'animation
        const animate = () => {
            this.updatePlaybackPositions();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        
        // Démarrer l'animation
        this.animationFrameId = requestAnimationFrame(animate);
    }
    
    /**
     * Arrêter l'animation de la tête de lecture
     */
    stopPlaybackAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    
    /**
     * Update les positions de lecture
     */
    updatePlaybackPositions() {
        if (!this.mixer.isPlaying) return;

        // Calculer la position actuelle en tenant compte des changements de tempo
        this.updatePlaybackClock();

        // Check for loop
        if (this.loopEnabled && this.playbackPosition >= this.loopEnd) {
            // Loop back to the start of the section
            this.seekToPosition(this.loopStart);
            return;
        }

        // Limiter à la durée maximale
        if (this.playbackPosition >= this.mixer.maxDuration) {
            this.stop();
            return;
        }

        // Update la position des têtes de lecture
        this.mixer.timeline.updatePlayhead(this.playbackPosition);

        // Update l'affichage du temps
        this.mixer.updateTimeDisplay();

        // Update l'affichage des accords
        if (this.mixer.chordDisplay) {
            this.mixer.chordDisplay.sync(this.playbackPosition);
        }

        // Update l'affichage de la structure
        if (this.mixer.structureDisplay) {
            this.mixer.structureDisplay.sync(this.playbackPosition);
        }

        // Update l'affichage karaoké
        if (this.mixer.karaokeDisplay) {
            this.mixer.karaokeDisplay.sync(this.playbackPosition);
        }
    }

    /**
     * Get the effective tempo ratio between real time and playback timeline
     */
    getEffectiveSyncRatio() {
        const controller = window.simplePitchTempo;
        if (controller) {
            if (typeof controller.cachedSyncRatio === 'number') {
                return controller.cachedSyncRatio;
            }
            if (typeof controller.cachedPlaybackRate === 'number' && controller.cachedPlaybackRate > 0) {
                return controller.cachedPlaybackRate;
            }
            if (typeof controller.cachedTempoRatio === 'number' && controller.cachedTempoRatio > 0) {
                return controller.cachedTempoRatio;
            }
        }
        return 1.0;
    }

    /**
     * Update playbackPosition according to elapsed real time and tempo ratio
     */
    updatePlaybackClock() {
        const now = this.audioContext ? this.audioContext.currentTime : performance.now() / 1000;
        if (this.lastRealTime === null) {
            this.lastRealTime = now;
        }

        if (this.mixer.isPlaying) {
            const delta = now - this.lastRealTime;
            const ratio = this.getEffectiveSyncRatio();
            this.playbackPosition += delta * ratio;
            if (this.playbackPosition < 0) this.playbackPosition = 0;
            const maxDuration = (typeof this.mixer.maxDuration === 'number' && this.mixer.maxDuration > 0)
                ? this.mixer.maxDuration
                : null;
            if (maxDuration !== null) {
                this.playbackPosition = Math.min(this.playbackPosition, maxDuration);
            }
            this.mixer.currentTime = this.playbackPosition;
        }

        this.lastRealTime = now;
        return this.playbackPosition;
    }

    /**
     * Force playback position to a specific value
     */
    setPlaybackPosition(position) {
        const maxDuration = (typeof this.mixer.maxDuration === 'number' && this.mixer.maxDuration > 0)
            ? this.mixer.maxDuration
            : null;
        const clamped = maxDuration !== null ? Math.min(position, maxDuration) : position;
        this.playbackPosition = Math.max(0, clamped);
        this.mixer.currentTime = this.playbackPosition;
        this.lastRealTime = this.audioContext ? this.audioContext.currentTime : performance.now() / 1000;
    }
    
    /**
     * Chercher une position spécifique dans l'audio
     * @param {number} position - Position en secondes
     */
    seekToPosition(position) {
        // Limiter la position entre 0 et la durée maximale
        const newPosition = Math.max(0, Math.min(position, this.mixer.maxDuration));
        
        // this.mixer.log(`Navigation vers la position ${newPosition.toFixed(2)}s`);
        
        // Sauvegarder l'state de lecture avant l'interruption
        const wasPlaying = this.mixer.isPlaying;
        
        // Arrêter toutes les sources audio actuelles en désactivant d'abord les événements onended
        Object.values(this.mixer.stems).forEach(stem => {
            if (stem.source) {
                // Remove l'événement onended pour éviter le déclenchement lors de la navigation
                stem.source.onended = null;
                
                try {
                    stem.source.stop();
                } catch (e) {
                    // Ignorer les errors si la source est déjà arrêtée
                }
                
                stem.source = null;
            }
        });
        
        // Update immédiatement la position
        this.mixer.currentTime = newPosition;
        this.playbackPosition = newPosition;
        this.lastRealTime = this.audioContext.currentTime;

        // Update la position des têtes de lecture
        this.mixer.timeline.updatePlayhead(newPosition);

        // Update l'affichage du temps
        this.mixer.updateTimeDisplay();

        // Update l'affichage des accords
        if (this.mixer.chordDisplay) {
            this.mixer.chordDisplay.sync(newPosition);
        }

        // Update l'affichage de la structure
        if (this.mixer.structureDisplay) {
            this.mixer.structureDisplay.sync(newPosition);
        }

        // Update l'affichage karaoké
        if (this.mixer.karaokeDisplay) {
            this.mixer.karaokeDisplay.sync(newPosition);
        }

        // Si on était en train de jouer, reprendre automatiquement
        if (wasPlaying) {
            // Redémarrer immédiatement la lecture depuis la new position
            setTimeout(() => {
                this.play();
            }, 10);
        }
    }
    
    /**
     * Update les states solo/mute
     */
    updateSoloMuteStates() {
        // Vérifier si au moins une track est en solo
        const hasSolo = Object.values(this.mixer.stems).some(stem => stem.solo);
        
        // Update le gain de chaque track en fonction de son state
        Object.entries(this.mixer.stems).forEach(([name, stem]) => {
            if (!stem.gainNode) return;
            
            // Si une track est en solo, toutes les autres sont muettes sauf si elles sont aussi en solo
            if (hasSolo) {
                stem.gainNode.gain.value = (stem.solo) ? stem.volume : 0;
            } else {
                // Sinon, appliquer l'state mute normal
                stem.gainNode.gain.value = stem.muted ? 0 : stem.volume;
            }
            
            // Update l'indicateur d'state actif
            this.mixer.trackControls.updateTrackStatus(name, hasSolo ? stem.solo : !stem.muted);
        });
    }
    
    /**
     * Permet de "scratcher" l'audio à une position spécifique pendant un glissement
     * @param {number} position - Position en secondes
     */
    scratchAt(position) {
        // Limiter la position entre 0 et la durée maximale
        const newPosition = Math.max(0, Math.min(position, this.mixer.maxDuration));
        
        // Update la position des têtes de lecture (always update visuals)
        this.mixer.timeline.updatePlayhead(newPosition);
        
        // Update la position actuelle
        this.mixer.currentTime = newPosition;
        
        // Update l'affichage du temps
        this.mixer.updateTimeDisplay();
        
        // Throttled audio feedback for scratching
        const now = Date.now();
        if (now - this.lastScratchTime >= this.scratchThrottle) {
            this.lastScratchTime = now;
            // Play lightweight scratch segment
            this.playScratchSegment(newPosition);
        }
        
        return newPosition;
    }
    
    /**
     * Joue un court segment audio pour l'effet de scratching (LIGHTWEIGHT VERSION)
     * @param {number} position - Position en secondes
     */
    playScratchSegment(position) {
        Object.entries(this.mixer.stems).forEach(([name, stem]) => {
            if (stem.active && stem.buffer) {
                // LIGHTWEIGHT: Create simple audio nodes without SoundTouch for scratching
                const source = this.audioContext.createBufferSource();
                source.buffer = stem.buffer;
                
                // Simple gain and pan nodes (no SoundTouch during scratch)
                const gainNode = this.audioContext.createGain();
                gainNode.gain.value = stem.muted ? 0 : stem.volume;
                
                const panNode = this.audioContext.createStereoPanner();
                panNode.pan.value = stem.pan;
                
                // Simple connection chain for scratch
                source.connect(gainNode);
                gainNode.connect(panNode);
                panNode.connect(this.masterGainNode);
                
                try {
                    // Calculer l'offset en fonction de la position
                    const offset = Math.min(position, stem.buffer.duration);
                    const scratchDuration = 0.15; // 150ms
                    
                    // Démarrer la lecture with un offset et une durée fixe
                    source.start(0, offset, scratchDuration);
                    
                    // Auto-cleanup
                    setTimeout(() => {
                        try {
                            source.stop();
                        } catch (e) {
                            // Ignorer les errors
                        }
                    }, scratchDuration * 1000 - 10);
                    
                } catch (e) {
                    console.warn(`Scratch error for ${name}:`, e.message);
                }
            }
        });
    }
    
    /**
     * Démarrer le mode scratching
     */
    startScratchMode() {
        this.isScratchMode = true;
        
        // Sauvegarder l'state de lecture avant le scratch
        this.wasPlayingBeforeScratching = this.mixer.isPlaying;
        
        // Arrêter la lecture normale si elle est en cours (preserve SoundTouch nodes)
        if (this.mixer.isPlaying) {
            this.mixer.isPlaying = false;
            this.stopPlaybackAnimation();
            
            // Arrêter toutes les sources audio actuelles (SoundTouch will be recreated on resume)
            Object.values(this.mixer.stems).forEach(stem => {
                if (stem.source) {
                    stem.source.onended = null;
                    try {
                        stem.source.stop();
                    } catch (e) {
                        // Ignorer les errors
                    }
                    stem.source = null;
                }
            });
        }
        
        // Reset scratch throttling
        this.lastScratchTime = 0;
    }
    
    /**
     * Arrêter le mode scratching
     */
    stopScratchMode() {
        this.isScratchMode = false;
        
        // Clear any pending scratch audio (lightweight cleanup)
        // Note: scratch segments auto-cleanup, no need for heavy operations here
        
        // Si on était en train de jouer avant le scratch, reprendre la lecture with SoundTouch
        if (this.wasPlayingBeforeScratching) {
            // Small delay to ensure smooth transition
            setTimeout(() => {
                this.play(); // This will recreate SoundTouch nodes properly
            }, 30);
        }
        
        this.wasPlayingBeforeScratching = false;
    }

    /**
     * Set loop section
     * @param {number} start - Loop start time in seconds
     * @param {number} end - Loop end time in seconds
     */
    setLoopSection(start, end) {
        this.loopEnabled = true;
        this.loopStart = start;
        this.loopEnd = end;

        this.mixer.log(`Loop section set: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
    }

    /**
     * Disable loop
     */
    disableLoop() {
        this.loopEnabled = false;
        this.loopStart = 0;
        this.loopEnd = 0;

        this.mixer.log('Loop disabled');
    }
}
