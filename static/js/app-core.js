/**
 * StemTube Web - Core Module
 * Global variables, Socket.IO init, config loading, event listeners
 * Depends on: (none — loaded first)
 */

// Global variables
let socket;
let currentVideoId = null;
let currentExtractionItem = null;
let appConfig = {};

// Extraction polling for concurrent user scenarios
let waitingForExtraction = false;
let extractionPollInterval = null;

// Function to start polling when user gets "extraction in progress by another user" message
function startExtractionPolling() {
    if (waitingForExtraction) return; // Already polling
    
    waitingForExtraction = true;
    console.log('[EXTRACTION POLL] Starting periodic refresh while waiting for another user\'s extraction to complete');
    
    // Poll every 10 seconds while waiting
    extractionPollInterval = setInterval(() => {
        console.log('[EXTRACTION POLL] Refreshing extraction list...');
        loadExtractions();
    }, 10000); // 10 seconds
    
    // Stop polling after 5 minutes max (extraction should be done by then)
    setTimeout(() => {
        stopExtractionPolling();
        console.log('[EXTRACTION POLL] Stopped polling after 5 minute timeout');
    }, 300000); // 5 minutes
}

// Function to stop polling 
function stopExtractionPolling() {
    if (!waitingForExtraction) return;
    
    waitingForExtraction = false;
    if (extractionPollInterval) {
        clearInterval(extractionPollInterval);
        extractionPollInterval = null;
        console.log('[EXTRACTION POLL] Stopped periodic refresh');
    }
}
let searchResults = [];
let searchResultsPage = 1;
let searchResultsPerPage = 10;
let totalSearchResults = 0;
let searchQuery = '';
// Default to 'url' (upload) mode if YouTube features are disabled
let searchMode = (typeof enableYoutube !== 'undefined' && enableYoutube) ? 'search' : 'url';

// CSRF protection has been disabled for this application
function getCsrfToken() {
    // Return empty string since CSRF is disabled
    return '';
}

// DOM Elements
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Socket.IO
    initializeSocketIO();
    
    // Load initial configuration
    loadConfig();
    
    // Initialize UI event listeners
    initializeEventListeners();
    
    // Load existing downloads and extractions
    loadDownloads();
    loadExtractions();
});

// Cleanup polling on page unload
window.addEventListener('beforeunload', () => {
    stopExtractionPolling();
});

// Socket.IO Initialization
function initializeSocketIO() {
    // Optimized configuration for connection stability
    socket = io({
        transports: ['polling', 'websocket'],
        upgrade: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        timeout: 60000
    });

    // Socket event listeners
    socket.on('connect', () => {
        console.log('Connected to server via WebSocket');
        showToast('Connected to server', 'success');

        // Reload downloads and extractions on reconnection
        loadDownloads();
        loadExtractions();
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        showToast('Connection error: ' + error.message, 'error');
    });
    
    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        showToast('Disconnected from server', 'warning');
    });
    
    // Set up authentication error handling
    if (window.setupSocketAuthHandling) {
        window.setupSocketAuthHandling(socket);
    }
    
    // Download events
    socket.on('download_progress', (data) => {
        console.log('Download progress:', data);
        updateDownloadProgress(data);
    });
    
    socket.on('download_complete', (data) => {
        console.log('Download complete:', data);
        updateDownloadComplete(data);
    });
    
    socket.on('download_error', (data) => {
        console.error('Download error:', data);
        updateDownloadError(data);
    });
    
    // Extraction events
    socket.on('extraction_progress', (data) => {
        console.log('Extraction progress:', data);
        updateExtractionProgress(data);
    });
    
    socket.on('extraction_complete', (data) => {
        console.log('Extraction complete:', data);
        updateExtractionComplete(data);
    });
    
    // Handle global extraction completion notifications
    // This refreshes extraction lists for all users when ANY user completes an extraction
    socket.on('extraction_completed_global', (data) => {
        console.log('[FRONTEND DEBUG] Global extraction completed event received:', data);
        console.log('[FRONTEND DEBUG] Current user should refresh extraction lists');
        
        try {
            // Refresh the extractions list to show the new extraction
            console.log('[FRONTEND DEBUG] Calling loadExtractions()');
            loadExtractions();
            
            // Also refresh downloads list to update "Extract Stems" buttons
            console.log('[FRONTEND DEBUG] Calling loadDownloads()');
            loadDownloads();
            
            // Show a subtle notification
            console.log('[FRONTEND DEBUG] Showing toast notification');
            showToast(`New extraction available: ${data.title}`, 'info');
            
            console.log('[FRONTEND DEBUG] Global extraction refresh completed successfully');
        } catch (error) {
            console.error('[FRONTEND DEBUG] Error handling global extraction completion:', error);
        }
    });
    
    // Alternative global extraction refresh event handler
    socket.on('extraction_refresh_needed', (data) => {
        console.log('[FRONTEND DEBUG] Extraction refresh needed event received:', data);
        console.log('[FRONTEND DEBUG] This is the backup global broadcast method');
        
        try {
            // Refresh the extractions list to show the new extraction  
            console.log('[FRONTEND DEBUG] Calling loadExtractions() from backup handler');
            loadExtractions();
            
            // Also refresh downloads list
            console.log('[FRONTEND DEBUG] Calling loadDownloads() from backup handler');
            loadDownloads();
            
            // Show notification
            showToast(data.message || `New extraction available: ${data.title}`, 'success');
            
            console.log('[FRONTEND DEBUG] Backup extraction refresh completed');
        } catch (error) {
            console.error('[FRONTEND DEBUG] Error in backup extraction refresh:', error);
        }
    });
    
    socket.on('extraction_error', (data) => {
        console.error('Extraction error:', data);
        updateExtractionError(data);
    });
}

// Load Configuration
function loadConfig() {
    fetch('/api/config', {
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
        .then(response => response.json())
        .then(data => {
            appConfig = data;

            // Apply theme
            if (appConfig.theme === 'light') {
                document.body.classList.add('light-theme');
                const themeSelect = document.getElementById('themeSelect');
                if (themeSelect) themeSelect.value = 'light';
            } else {
                document.body.classList.remove('light-theme');
                const themeSelect = document.getElementById('themeSelect');
                if (themeSelect) themeSelect.value = 'dark';
            }

            // Apply quality settings if elements exist (for download functionality)
            const videoQuality = document.getElementById('preferredVideoQuality');
            const audioQuality = document.getElementById('preferredAudioQuality');
            if (videoQuality) videoQuality.value = appConfig.preferred_video_quality || '720p';
            if (audioQuality) audioQuality.value = appConfig.preferred_audio_quality || 'best';

            // Note: System settings (downloads_directory, GPU, etc.) are now in Admin > System Settings
        })
        .catch(error => {
            console.error('Error loading configuration:', error);
            showToast('Error loading configuration', 'error');
        });
}

// Initialize Event Listeners
function initializeEventListeners() {
    // Search mode toggle
    document.querySelectorAll('#searchMode .segment').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('#searchMode .segment').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
            searchMode = button.dataset.mode;

            // Toggle between search and file upload UI
            if (searchMode === 'search') {
                document.getElementById('searchInputContainer').style.display = 'flex';
                document.getElementById('fileUploadContainer').style.display = 'none';
            } else {
                document.getElementById('searchInputContainer').style.display = 'none';
                document.getElementById('fileUploadContainer').style.display = 'block';
            }
        });
    });

    // File upload area click
    document.getElementById('fileUploadArea').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    // File input change
    document.getElementById('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleFileSelection(file);
        }
    });

    // Drag and drop
    const uploadArea = document.getElementById('fileUploadArea');
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) {
            handleFileSelection(file);
        }
    });

    // Upload button
    document.getElementById('uploadButton').addEventListener('click', () => {
        uploadFile();
    });

    // Clear file button
    document.getElementById('clearFileButton').addEventListener('click', () => {
        clearFileSelection();
    });
    
    // Search button (only if YouTube search is enabled)
    const searchButton = document.getElementById('searchButton');
    if (searchButton) {
        searchButton.addEventListener('click', () => {
            performSearch();
        });
    }

    // Search input (Enter key) - only if YouTube search is enabled
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
    }
    
    // Tab switching
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.dataset.tab;
            if (typeof switchToTab === 'function') {
                switchToTab(tabId);
            }
        });
    });
    
    // Settings button
    document.getElementById('settingsButton').addEventListener('click', () => {
        document.getElementById('settingsModal').style.display = 'flex';
    });
    
    // Logout button
    document.getElementById('logoutButton').addEventListener('click', () => {
        if (confirm('Are you sure you want to logout?')) {
            window.location.href = '/logout';
        }
    });
    
    // Add global function to clear all downloads (for console testing)
    window.clearAllDownloads = function() {
        if (confirm('Are you sure you want to clear ALL downloads and stems? This cannot be undone!')) {
            fetch('/api/downloads/clear-all', {
                method: 'DELETE',
                headers: {
                    'X-CSRF-Token': getCsrfToken()
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('Clear all downloads result:', data);
                    showToast(`Cleared ${data.cleared.total} items successfully`, 'success');
                    // Refresh the downloads list
                    loadDownloads();
                    loadExtractions();
                } else {
                    showToast('Error clearing downloads: ' + (data.error || 'Unknown error'), 'error');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                showToast('Error clearing downloads: ' + error.message, 'error');
            });
        }
    };
    
    // Close buttons for modals
    document.querySelectorAll('.close-button').forEach(button => {
        button.addEventListener('click', () => {
            button.closest('.modal').style.display = 'none';
        });
    });
    
    // Close modals when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
    
    // Save settings button (user settings - theme only)
    const saveSettingsBtn = document.getElementById('saveSettingsButton');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            saveSettings();
        });
    }

    // Download FFmpeg button - now in Admin System Settings
    const downloadFfmpegBtn = document.getElementById('downloadFfmpegButton');
    if (downloadFfmpegBtn) {
        downloadFfmpegBtn.addEventListener('click', () => {
            downloadFfmpeg();
        });
    }

    // Download type change (audio/video) - only if YouTube download is enabled
    const downloadTypeSelect = document.getElementById('downloadType');
    if (downloadTypeSelect) {
        downloadTypeSelect.addEventListener('change', () => {
            const downloadType = downloadTypeSelect.value;

            if (downloadType === 'audio') {
                document.getElementById('videoQualityContainer').style.display = 'none';
                document.getElementById('audioQualityContainer').style.display = 'block';
            } else {
                document.getElementById('videoQualityContainer').style.display = 'block';
                document.getElementById('audioQualityContainer').style.display = 'none';
            }
        });
    }
    
    // Two-stem mode toggle
    document.getElementById('twoStemMode').addEventListener('change', () => {
        const twoStemMode = document.getElementById('twoStemMode').checked;
        
        if (twoStemMode) {
            document.getElementById('primaryStemContainer').style.display = 'block';
        } else {
            document.getElementById('primaryStemContainer').style.display = 'none';
        }
    });
    
    // Start download button (only if YouTube download is enabled)
    const startDownloadButton = document.getElementById('startDownloadButton');
    if (startDownloadButton) {
        startDownloadButton.addEventListener('click', () => {
            startDownload();
        });
    }

    // Start extraction button
    document.getElementById('startExtractionButton').addEventListener('click', () => {
        startExtraction();
    });
    
    // Model selection change event
    document.getElementById('stemModel').addEventListener('change', () => {
        updateStemOptions();
        updateModelDescription();
    });
}
