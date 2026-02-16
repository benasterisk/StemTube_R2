/**
 * StemTube Web - Settings & Utilities Module
 * Settings, toast, helpers, display functions, left panel
 * Depends on: app-core.js (globals, getCsrfToken)
 */

// Settings Functions - User settings (theme only)
function saveSettings() {
    const settings = {
        theme: document.getElementById('themeSelect').value
    };

    fetch('/api/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify(settings)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast('Settings saved', 'success');

            // Apply theme
            if (settings.theme === 'light') {
                document.body.classList.add('light-theme');
            } else {
                document.body.classList.remove('light-theme');
            }

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
        
        console.log(`Title: ${title}, Channel: ${channelTitle}, Thumbnail: ${thumbnailUrl}`);
        
        // Create result element
        const resultElement = document.createElement('div');
        resultElement.className = 'search-result';
        resultElement.innerHTML = `
            <img class="result-thumbnail" src="${thumbnailUrl}" alt="${title}">
            <div class="result-info">
                <div class="result-title">${title}</div>
                <div class="result-channel">${channelTitle}</div>
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
