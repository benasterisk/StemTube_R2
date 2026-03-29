/**
 * StemTube Web - Settings & Utilities Module
 * Settings, toast, helpers, display functions, left panel
 * Depends on: app-core.js (globals, getCsrfToken)
 */

// Spectrum picker instances (desktop only)
var _accentPicker = null;
var _bgPicker = null;
var _textPicker = null;

// Theme application — removes all theme classes, adds the active one
function applyTheme(theme, customColor, customBgColor, customTextColor) {
    // Clear any previous custom theme inline styles
    clearCustomThemeVariables(document.body);

    document.body.classList.remove('light-theme', 'neumorphic-white', 'neumorphic-anthracite', 'neumorphic-custom', 'glassmorphism', 'cyberpunk-neon');
    if (theme && theme !== 'dark') {
        document.body.classList.add(theme);
    }

    // Apply custom palette if neumorphic-custom
    if (theme === 'neumorphic-custom') {
        var accent = customColor || '#e63950';
        var bg = customBgColor || '#2a2d35';
        var txt = customTextColor || '#e0e0e0';
        applyCustomThemeVariables(document.body, accent, bg, txt);
    }

    // Persist to localStorage for instant restore across sessions
    try {
        localStorage.setItem('stemtube_theme', theme || 'dark');
        if (theme === 'neumorphic-custom') {
            localStorage.setItem('stemtube_custom_color', customColor || '#e63950');
            localStorage.setItem('stemtube_custom_bg', customBgColor || '#2a2d35');
            localStorage.setItem('stemtube_custom_text', customTextColor || '#e0e0e0');
        }
    } catch (e) { /* localStorage unavailable */ }

    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = theme || 'dark';

    // Show/hide color picker rows
    const customColorRow = document.getElementById('customColorRow');
    if (customColorRow) {
        customColorRow.style.display = (theme === 'neumorphic-custom') ? 'block' : 'none';
    }
    const colorInput = document.getElementById('customThemeColor');
    if (colorInput && customColor) colorInput.value = customColor;
    const bgColorInput = document.getElementById('customThemeBgColor');
    if (bgColorInput && customBgColor) bgColorInput.value = customBgColor;
    const textColorInput = document.getElementById('customThemeTextColor');
    if (textColorInput && customTextColor) textColorInput.value = customTextColor;

    // Sync spectrum pickers if they exist
    if (_accentPicker && customColor) _accentPicker.setColor(customColor);
    if (_bgPicker && customBgColor) _bgPicker.setColor(customBgColor);
    if (_textPicker && customTextColor) _textPicker.setColor(customTextColor);

    // Propagate to mixer iframe
    const mixerFrame = document.getElementById('mixerFrame');
    if (mixerFrame && mixerFrame.contentWindow) {
        mixerFrame.contentWindow.postMessage({
            type: 'theme_change',
            theme: theme || 'dark',
            customColor: customColor || null,
            customBgColor: customBgColor || null,
            customTextColor: customTextColor || null
        }, '*');
    }
}

// Restore theme from localStorage immediately (before API call)
(function() {
    try {
        var saved = localStorage.getItem('stemtube_theme');
        if (saved && saved !== 'dark') {
            document.body.classList.add(saved);
        }
    } catch (e) { /* localStorage unavailable */ }
})();

// Settings Functions - User settings (theme only)
function saveSettings() {
    const theme = document.getElementById('themeSelect').value;
    const settings = { theme: theme };

    // Include custom colors if neumorphic-custom
    if (theme === 'neumorphic-custom') {
        const colorInput = document.getElementById('customThemeColor');
        const bgColorInput = document.getElementById('customThemeBgColor');
        const textColorInput = document.getElementById('customThemeTextColor');
        settings.custom_theme_color = colorInput ? colorInput.value : '#e63950';
        settings.custom_theme_bg_color = bgColorInput ? bgColorInput.value : '#2a2d35';
        settings.custom_theme_text_color = textColorInput ? textColorInput.value : '#e0e0e0';
    }

    fetch('/api/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify(settings)
    })
    .then(response => {
        if (!response.ok) throw new Error('Save failed: ' + response.status);
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showToast('Settings saved', 'success');
            applyTheme(settings.theme, settings.custom_theme_color, settings.custom_theme_bg_color, settings.custom_theme_text_color);

            // Close modal
            document.getElementById('settingsModal').style.display = 'none';

            // Update app config
            appConfig = { ...appConfig, ...settings };
        } else {
            showToast('Error saving settings', 'error');
        }
    })
    .catch(error => {
        console.error('Error saving settings:', error);
        showToast('Error saving settings', 'error');
    });
}

// Spectrum pickers: show/hide on theme change + live preview
document.addEventListener('DOMContentLoaded', function() {
    const themeSelect = document.getElementById('themeSelect');
    const customColorRow = document.getElementById('customColorRow');
    if (themeSelect && customColorRow) {
        themeSelect.addEventListener('change', function() {
            customColorRow.style.display = (themeSelect.value === 'neumorphic-custom') ? 'block' : 'none';
        });
    }

    const colorInput = document.getElementById('customThemeColor');
    const bgColorInput = document.getElementById('customThemeBgColor');
    const textColorInput = document.getElementById('customThemeTextColor');

    function livePreviewCustomTheme() {
        if (themeSelect && themeSelect.value === 'neumorphic-custom') {
            var accent = colorInput ? colorInput.value : '#e63950';
            var bg = bgColorInput ? bgColorInput.value : '#2a2d35';
            var txt = textColorInput ? textColorInput.value : '#e0e0e0';
            applyCustomThemeVariables(document.body, accent, bg, txt);
            const mixerFrame = document.getElementById('mixerFrame');
            if (mixerFrame && mixerFrame.contentWindow) {
                mixerFrame.contentWindow.postMessage({
                    type: 'theme_change',
                    theme: 'neumorphic-custom',
                    customColor: accent,
                    customBgColor: bg,
                    customTextColor: txt
                }, '*');
            }
        }
    }

    // Instantiate spectrum pickers
    if (typeof SpectrumPicker !== 'undefined') {
        var accentContainer = document.getElementById('accentPickerContainer');
        if (accentContainer) {
            _accentPicker = new SpectrumPicker(accentContainer, {
                color: (colorInput && colorInput.value) || '#e63950',
                onChange: function(hex) {
                    if (colorInput) colorInput.value = hex;
                    livePreviewCustomTheme();
                }
            });
        }
        var bgContainer = document.getElementById('bgPickerContainer');
        if (bgContainer) {
            _bgPicker = new SpectrumPicker(bgContainer, {
                color: (bgColorInput && bgColorInput.value) || '#2a2d35',
                onChange: function(hex) {
                    if (bgColorInput) bgColorInput.value = hex;
                    livePreviewCustomTheme();
                }
            });
        }
        var textContainer = document.getElementById('textPickerContainer');
        if (textContainer) {
            _textPicker = new SpectrumPicker(textContainer, {
                color: (textColorInput && textColorInput.value) || '#e0e0e0',
                onChange: function(hex) {
                    if (textColorInput) textColorInput.value = hex;
                    livePreviewCustomTheme();
                }
            });
        }
    }

    // Build preset pastilles
    buildPresetPastilles(document.getElementById('presetPastilles'), function(preset) {
        if (colorInput) colorInput.value = preset.accent;
        if (bgColorInput) bgColorInput.value = preset.bg;
        if (textColorInput) textColorInput.value = preset.text;
        if (_accentPicker) _accentPicker.setColor(preset.accent);
        if (_bgPicker) _bgPicker.setColor(preset.bg);
        if (_textPicker) _textPicker.setColor(preset.text);
        livePreviewCustomTheme();
    });
});

function checkFfmpegStatus() {
    // Note: FFmpeg status is now in Admin > System Settings
    // This function is kept for backwards compatibility
    const ffmpegStatus = document.getElementById('ffmpegStatus');
    const downloadFfmpegButton = document.getElementById('downloadFfmpegButton');

    // Skip if elements don't exist (moved to Admin System Settings)
    if (!ffmpegStatus) return;

    fetch('/api/config/ffmpeg/check', {
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
        .then(response => response.json())
        .then(data => {
            if (data.ffmpeg_available && data.ffprobe_available) {
                ffmpegStatus.innerHTML = `
                    <p class="status-ok">FFmpeg is available</p>
                    <p>FFmpeg path: ${data.ffmpeg_path}</p>
                    <p>FFprobe path: ${data.ffprobe_path}</p>
                `;
                if (downloadFfmpegButton) downloadFfmpegButton.classList.add('hidden');
            } else {
                ffmpegStatus.innerHTML = `
                    <p class="status-error">FFmpeg is not available</p>
                    <p>FFmpeg ${data.ffmpeg_available ? 'is' : 'is not'} available</p>
                    <p>FFprobe ${data.ffprobe_available ? 'is' : 'is not'} available</p>
                `;
                if (downloadFfmpegButton) downloadFfmpegButton.classList.remove('hidden');
            }
        })
        .catch(error => {
            console.error('Error checking FFmpeg status:', error);
            if (ffmpegStatus) ffmpegStatus.innerHTML = '<p class="status-error">Error checking FFmpeg status</p>';
        });
}

function downloadFfmpeg() {
    // Note: FFmpeg download is now in Admin > System Settings
    const ffmpegStatus = document.getElementById('ffmpegStatus');
    const downloadFfmpegButton = document.getElementById('downloadFfmpegButton');

    // Skip if elements don't exist
    if (!ffmpegStatus || !downloadFfmpegButton) return;

    ffmpegStatus.innerHTML = '<p>Downloading FFmpeg...</p>';
    downloadFfmpegButton.disabled = true;

    fetch('/api/config/ffmpeg/download', {
        method: 'POST',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            ffmpegStatus.innerHTML = `
                <p class="status-ok">FFmpeg downloaded successfully</p>
                <p>${data.message}</p>
            `;
            downloadFfmpegButton.classList.add('hidden');
            showToast('FFmpeg downloaded successfully', 'success');
        } else {
            ffmpegStatus.innerHTML = `
                <p class="status-error">Error downloading FFmpeg</p>
                <p>${data.message}</p>
            `;
            downloadFfmpegButton.disabled = false;
            showToast('Error downloading FFmpeg', 'error');
        }
    })
    .catch(error => {
        console.error('Error downloading FFmpeg:', error);
        if (ffmpegStatus) ffmpegStatus.innerHTML = '<p class="status-error">Error downloading FFmpeg</p>';
        if (downloadFfmpegButton) downloadFfmpegButton.disabled = false;
        showToast('Error downloading FFmpeg', 'error');
    });
}

function updateGpuStatus() {
    // Note: GPU status is now in Admin > System Settings
    const gpuStatus = document.getElementById('gpuStatus');

    // Skip if element doesn't exist
    if (!gpuStatus) return;

    if (appConfig.using_gpu) {
        gpuStatus.innerHTML = '<p class="status-ok">GPU acceleration is available and enabled</p>';
    } else {
        gpuStatus.innerHTML = '<p class="status-warning">GPU acceleration is not available</p>';
    }
}

// Function to display the list of files in a folder
function showFilesModal(folderPath, title) {
    // Create or retrieve the modal window
    let filesModal = document.getElementById('filesModal');

    if (!filesModal) {
        // Create the modal if it doesn't exist yet
        filesModal = document.createElement('div');
        filesModal.id = 'filesModal';
        filesModal.className = 'modal';
        
        filesModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2 id="filesModalTitle">Files</h2>
                    <span class="close-button">&times;</span>
                </div>
                <div class="modal-body">
                    <div id="filesContainer" class="files-container">
                        <div class="loading">Loading files...</div>
                    </div>
                </div>
            </div>
        `;


        document.body.appendChild(filesModal);

        // Event handler to close the modal
        filesModal.querySelector('.close-button').addEventListener('click', () => {
            filesModal.style.display = 'none';
        });

        // Close the modal by clicking outside
        filesModal.addEventListener('click', (e) => {
            if (e.target === filesModal) {
                filesModal.style.display = 'none';
            }
        });
    }

    // Update the title
    filesModal.querySelector('#filesModalTitle').textContent = title ? `Files - ${title}` : 'Files';

    // Show the modal
    filesModal.style.display = 'flex';

    // Load the file list
    fetch('/api/list-files', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken(),
            'X-Requested-With': 'XMLHttpRequest'  // Added to indicate an AJAX request
        },
        body: JSON.stringify({ folder_path: folderPath }),
        credentials: 'same-origin'  // Include cookies for authentication
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        const filesContainer = filesModal.querySelector('#filesContainer');
        
        if (!data.success) {
            filesContainer.innerHTML = `<div class="error-message">${data.message}</div>`;
            return;
        }
        
        if (data.files.length === 0) {
            filesContainer.innerHTML = '<div class="no-items">No files found</div>';
            return;
        }

        // Sort files by name
        data.files.sort((a, b) => a.name.localeCompare(b.name));

        // Create the file list
        let filesHtml = '<ul class="files-list">';
        
        data.files.forEach(file => {
            const fileSize = formatFileSize(file.size);
            const encodedPath = encodeURIComponent(file.path);
            
            filesHtml += `
                <li class="file-item">
                    <div class="file-info">
                        <span class="file-name">${file.name}</span>
                        <span class="file-size">${fileSize}</span>
                    </div>
                    <a href="/api/download-file?file_path=${encodedPath}" 
                       class="item-button download-button" 
                       download="${file.name}">
                        <i class="fas fa-download"></i> Download
                    </a>
                </li>
            `;
        });
        
        filesHtml += '</ul>';
        filesContainer.innerHTML = filesHtml;
    })
    .catch(error => {
        console.error('Error loading files:', error);
        filesModal.querySelector('#filesContainer').innerHTML = 
            `<div class="error-message">Error loading files: ${error.message}</div>`;
    });
}

// Function to format file size
function formatFileSize(bytes) {
    if (bytes < 1024) {
        return bytes + ' B';
    } else if (bytes < 1024 * 1024) {
        return (bytes / 1024).toFixed(1) + ' KB';
    } else if (bytes < 1024 * 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    } else {
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }
}

// Function to create ZIP archive for extraction on demand
function createZipForExtraction(extractionId) {
    fetch(`/api/extractions/${encodeURIComponent(extractionId)}/create-zip`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.zip_path) {
            showToast('ZIP archive created successfully', 'success');
            // Immediately download the ZIP
            window.location.href = `/api/download-file?file_path=${encodeURIComponent(data.zip_path)}`;
        } else {
            showToast(`Error creating ZIP: ${data.error || 'Unknown error'}`, 'error');
        }
    })
    .catch(error => {
        console.error('Error creating ZIP:', error);
        showToast('Error creating ZIP archive', 'error');
    });
}

// Helper function to get the first output path or construct one
function getFirstOutputPath(item) {
    // Try to get the first output path
    if (item.output_paths && Object.keys(item.output_paths).length > 0) {
        return Object.values(item.output_paths)[0];
    }
    
    // Fallback: try to construct path from audio_path
    if (item.audio_path) {
        // Remove filename and add stems directory
        const lastSlash = Math.max(item.audio_path.lastIndexOf('/'), item.audio_path.lastIndexOf('\\'));
        if (lastSlash !== -1) {
            const directory = item.audio_path.substring(0, lastSlash);
            // Go up one level (from audio to parent) and add stems
            const parentSlash = Math.max(directory.lastIndexOf('/'), directory.lastIndexOf('\\'));
            if (parentSlash !== -1) {
                const parentDir = directory.substring(0, parentSlash);
                return parentDir + '/stems/vocals.mp3'; // Use vocals as default
            }
        }
    }
    
    return ''; // Fallback to empty if nothing works
}

// Utility Functions
function getStatusClass(status) {
    switch (status) {
        case 'queued':
            return 'status-queued';
        case 'downloading':
        case 'extracting':
            return 'status-downloading';
        case 'completed':
            return 'status-completed';
        case 'error':
        case 'failed':
        case 'cancelled':
            return 'status-error';
        case undefined:
        case null:
        case '':
        case 'undefined':
            return 'status-error';
        default:
            return 'status-error';
    }
}

function getStatusText(status) {
    switch (status) {
        case 'queued':
            return 'Queued';
        case 'downloading':
            return 'Downloading';
        case 'extracting':
            return 'Extracting';
        case 'completed':
            return 'Completed';
        case 'error':
        case 'failed':
            return 'Error';
        case 'cancelled':
            return 'Cancelled';
        case undefined:
        case null:
        case '':
        case 'undefined':
            return 'Failed';
        default:
            return 'Failed';
    }
}

function getFileNameFromPath(path) {
    if (!path) return '';
    return path.split('\\').pop().split('/').pop();
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    // Remove toast after 3 seconds
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// Helper function to validate YouTube video ID
function isValidYouTubeVideoId(videoId) {
    if (!videoId || typeof videoId !== 'string') {
        return false;
    }
    
    // YouTube video IDs are exactly 11 characters
    if (videoId.length !== 11) {
        return false;
    }
    
    // Only alphanumeric, hyphen, and underscore are allowed
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return false;
    }
    
    return true;
}

// Helper function to extract video ID from YouTube URL
function extractVideoId(url) {
    // Check if it's already a video ID (11 characters)
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
        return url;
    }
    
    // Try to extract from URL
    const regExp = /^.*(youtu.be\/|v\/|e\/|u\/\w+\/|embed\/|v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    
    if (match && match[2]) {
        // Validate the extracted video ID
        const extractedId = match[2];
        return isValidYouTubeVideoId(extractedId) ? extractedId : null;
    }
    
    return null;
}

// Display search results
function displaySearchResults(data) {
    console.log('Received search results data:', data);
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '';
    
    // Check if we have valid data
    if (!data || (Array.isArray(data) && data.length === 0) || 
        (data.items && data.items.length === 0)) {
        console.log('No results found in data');
        resultsContainer.innerHTML = '<div class="no-results">No results found</div>';
        return;
    }
    
    // Normalize data format
    let items = [];
    if (Array.isArray(data)) {
        console.log('Data is an array');
        items = data;
    } else if (data.items && Array.isArray(data.items)) {
        console.log('Data has items array');
        items = data.items;
    } else {
        console.error('Unexpected data format:', data);
        resultsContainer.innerHTML = '<div class="error-message">Error processing search results</div>';
        return;
    }
    
    console.log('Processing', items.length, 'items');
    
    // Add results counter at the top
    const counterElement = document.createElement('div');
    counterElement.className = 'results-counter';
    counterElement.innerHTML = `<strong>Showing ${items.length} results</strong>`;
    resultsContainer.appendChild(counterElement);
    
    // Create result elements
    items.forEach((item, index) => {
        console.log(`Processing item ${index}:`, item);
        
        // Extract video ID
        let videoId;
        if (item.id && typeof item.id === 'object' && item.id.videoId) {
            videoId = item.id.videoId;
        } else if (item.id && typeof item.id === 'string') {
            videoId = item.id;
        } else {
            videoId = item.videoId || '';
        }
        
        // VALIDATE VIDEO ID
        if (!isValidYouTubeVideoId(videoId)) {
            console.warn(`[FRONTEND DEBUG] Invalid video ID found: '${videoId}' (length: ${videoId ? videoId.length : 0}) - skipping result`);
            console.warn(`[FRONTEND DEBUG] Item data:`, item);
            return; // Skip this invalid result
        }
        
        console.log(`[FRONTEND DEBUG] Extracted valid videoId: ${videoId} for title: ${item.snippet?.title || item.title || 'Unknown'}`);
        
        // Extract other information
        const title = item.snippet?.title || item.title || 'Unknown Title';
        const channelTitle = item.snippet?.channelTitle || item.channel?.name || 'Unknown Channel';
        const thumbnailUrl = getThumbnailUrl(item);
        const duration = formatDuration(item.contentDetails?.duration || item.duration);
        const inLibrary = item.already_in_library === true;

        // Music metadata from YouTube Music results
        const musicMeta = item.musicMetadata;
        const artistLine = (searchSource === 'ytmusic' && musicMeta)
            ? (musicMeta.artist || '') + (musicMeta.album ? ' &middot; ' + musicMeta.album : '')
            : '';

        console.log(`Title: ${title}, Channel: ${channelTitle}, Thumbnail: ${thumbnailUrl}`);

        // Create result element
        const resultElement = document.createElement('div');
        resultElement.className = 'search-result';
        resultElement.innerHTML = `
            <img class="result-thumbnail" src="${thumbnailUrl}" alt="${title}">
            <div class="result-info">
                <div class="result-title">${title}${inLibrary ? '<span class="in-library-badge">In Library</span>' : ''}</div>
                <div class="result-channel">${channelTitle}</div>
                ${artistLine ? '<div class="result-channel" style="color:var(--accent-color)">' + artistLine + '</div>' : ''}
                <div class="result-duration">${duration}</div>
                <div class="result-actions">
                    <button class="result-button play-button" data-video-id="${videoId}">
                        <i class="fas fa-play"></i> Play
                    </button>
                    <button class="result-button download-button" data-video-id="${videoId}" data-title="${title}" data-thumbnail="${thumbnailUrl}">
                        <i class="fas fa-download"></i> Download
                    </button>
                </div>
            </div>
        `;
        
        resultsContainer.appendChild(resultElement);
    });
    
    console.log('Added event listeners to buttons');
    
    // Add event listeners to buttons
    document.querySelectorAll('.play-button').forEach(button => {
        button.addEventListener('click', () => {
            const videoId = button.dataset.videoId;
            window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
        });
    });
    
    document.querySelectorAll('.download-button').forEach(button => {
        button.addEventListener('click', () => {
            const videoId = button.dataset.videoId;
            openDownloadModal(videoId, button.dataset.title, button.dataset.thumbnail);
        });
    });
}

// Helper function to get the best thumbnail URL
function getThumbnailUrl(item) {
    // Handle different API response structures
    if (item.snippet && item.snippet.thumbnails) {
        const thumbnails = item.snippet.thumbnails;
        return thumbnails.medium?.url || thumbnails.default?.url || '';
    } else if (item.thumbnails && Array.isArray(item.thumbnails)) {
        // Find a thumbnail with width between 200 and 400px
        const mediumThumbnail = item.thumbnails.find(thumb => 
            thumb.width >= 200 && thumb.width <= 400
        );
        
        if (mediumThumbnail) {
            return mediumThumbnail.url;
        }
        
        // Fallback to the first thumbnail
        return item.thumbnails[0]?.url || '';
    } else if (item.thumbnail) {
        return item.thumbnail;
    }
    
    return '';
}
