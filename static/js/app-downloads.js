/**
 * StemTube Web - Downloads & Extractions Module
 * Search, upload, download/extraction management, progress updates
 * Depends on: app-core.js (globals, getCsrfToken, showToast, switchToTab)
 */

// Search Functions
function performSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) {
        showToast('Please enter a search query', 'warning');
        return;
    }
    
    console.log('Performing search for query:', query);
    console.log('Search mode:', searchMode);
    
    // Show loading state
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '<div class="loading-indicator">Searching...</div>';
    
    // Determine search mode (search or URL)
    const searchParams = new URLSearchParams();
    
    if (searchMode === 'search') {
        // Regular search
        const maxResults = document.getElementById('resultsCount').value;
        console.log('Selected max results:', maxResults);
        console.log('Query:', query);
        searchParams.append('query', query);
        searchParams.append('max_results', maxResults);
        
        const searchUrl = `/api/search?${searchParams.toString()}`;
        console.log('Fetching from URL:', searchUrl);
        
        fetch(searchUrl, {
            headers: {
                'X-CSRF-Token': getCsrfToken()
            }
        })
            .then(response => {
                console.log('Search API response status:', response.status);
                if (!response.ok) {
                    if (response.status === 401) {
                        // Handle authentication error
                        return response.json().then(data => {
                            throw new Error('Authentication required');
                        });
                    }
                    throw new Error(`Search failed with status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('Search API response data:', data);
                displaySearchResults(data);
            })
            .catch(error => {
                console.error('Search error:', error);
                resultsContainer.innerHTML = `<div class="error-message">Search error: ${error.message}</div>`;
                showToast(`Search error: ${error.message}`, 'error');
            });
    } else {
        // URL/ID mode - direct video lookup
        const videoId = extractVideoId(query);
        if (videoId) {
            const videoUrl = `/api/video/${videoId}`;
            console.log('Fetching video info from URL:', videoUrl);
            
            fetch(videoUrl, {
                headers: {
                    'X-CSRF-Token': getCsrfToken()
                }
            })
                .then(response => {
                    console.log('Video API response status:', response.status);
                    if (!response.ok) {
                        if (response.status === 401) {
                            // Handle authentication error
                            return response.json().then(data => {
                                throw new Error('Authentication required');
                            });
                        }
                        throw new Error(`Video lookup failed with status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('Video API response data:', data);
                    // Format the response to match search results format
                    const formattedData = {
                        items: [data]
                    };
                    displaySearchResults(formattedData);
                })
                .catch(error => {
                    console.error('Video lookup error:', error);
                    resultsContainer.innerHTML = `<div class="error-message">Video lookup error: ${error.message}</div>`;
                    showToast(`Video lookup error: ${error.message}`, 'error');
                });
        } else {
            resultsContainer.innerHTML = '<div class="error-message">Invalid YouTube URL or video ID</div>';
            showToast('Invalid YouTube URL or video ID', 'error');
        }
    }
}

// File upload functions
let selectedFile = null;

function handleFileSelection(file) {
    selectedFile = file;
    document.getElementById('fileUploadArea').style.display = 'none';
    document.getElementById('fileSelectedInfo').style.display = 'flex';
    document.getElementById('selectedFileName').textContent = file.name;
}

function clearFileSelection() {
    selectedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileUploadArea').style.display = 'flex';
    document.getElementById('fileSelectedInfo').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'none';
}

function uploadFile() {
    if (!selectedFile) {
        showToast('No file selected', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    // Show progress
    document.getElementById('fileSelectedInfo').style.display = 'none';
    document.getElementById('uploadProgress').style.display = 'block';
    document.getElementById('uploadProgressText').textContent = 'Uploading...';

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            document.getElementById('uploadProgressFill').style.width = percentComplete + '%';
            document.getElementById('uploadProgressText').textContent = `Uploading... ${Math.round(percentComplete)}%`;
        }
    });

    xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
            try {
                const data = JSON.parse(xhr.responseText);
                if (data.error) {
                    showToast(`Upload error: ${data.error}`, 'error');
                    clearFileSelection();
                } else {
                    showToast('File uploaded successfully!', 'success');
                    clearFileSelection();
                    // Refresh downloads list to show the uploaded file
                    loadDownloads();
                    // Switch to Downloads tab
                    switchToTab('downloads');
                }
            } catch (e) {
                showToast('Error processing server response', 'error');
                clearFileSelection();
            }
        } else {
            try {
                const data = JSON.parse(xhr.responseText);
                showToast(`Upload failed: ${data.error || 'Unknown error'}`, 'error');
            } catch (e) {
                showToast(`Upload failed: HTTP ${xhr.status}`, 'error');
            }
            clearFileSelection();
        }
    });

    xhr.addEventListener('error', () => {
        showToast('Upload failed: Network error', 'error');
        clearFileSelection();
    });

    xhr.open('POST', '/api/upload-file');
    xhr.setRequestHeader('X-CSRF-Token', getCsrfToken());
    xhr.send(formData);
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

// Helper function to format duration
function formatDuration(duration) {
    if (!duration) return 'Unknown';
    
    // Handle ISO 8601 duration format (PT1H2M3S)
    if (typeof duration === 'string' && duration.startsWith('PT')) {
        const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        
        if (matches) {
            const hours = matches[1] ? parseInt(matches[1]) : 0;
            const minutes = matches[2] ? parseInt(matches[2]) : 0;
            const seconds = matches[3] ? parseInt(matches[3]) : 0;
            
            if (hours > 0) {
                return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
                return `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        }
    }
    
    // Handle seconds format
    if (!isNaN(duration)) {
        const totalSeconds = parseInt(duration);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    // Handle MM:SS format that might be incorrectly formatted (e.g., 0:296)
    if (typeof duration === 'string' && duration.includes(':')) {
        const parts = duration.split(':');
        if (parts.length === 2) {
            let minutes = parseInt(parts[0]);
            let seconds = parseInt(parts[1]);

            // Convert excess seconds to minutes
            if (seconds >= 60) {
                minutes += Math.floor(seconds / 60);
                seconds = seconds % 60;
            }
            
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    
    return duration;
}

// Download Modal Functions
function openDownloadModal(videoId, title, thumbnailUrl) {
    console.log('Opening download modal with:', { videoId, title, thumbnailUrl });
    
    // Validate video ID before proceeding
    if (!isValidYouTubeVideoId(videoId)) {
        showToast(`Invalid YouTube video ID: "${videoId}" (length: ${videoId ? videoId.length : 0})`, 'error');
        console.error('Invalid video ID provided to download modal:', videoId);
        return;
    }

    // Store the decoded ID
    currentVideoId = videoId;
    console.log('Set currentVideoId to:', currentVideoId);
    
    document.getElementById('downloadTitle').textContent = title;
    document.getElementById('downloadThumbnail').src = thumbnailUrl;
    
    // Set default values from settings
    document.getElementById('downloadType').value = 'audio';
    document.getElementById('videoQuality').value = appConfig.preferred_video_quality || '720p';
    document.getElementById('audioQuality').value = appConfig.preferred_audio_quality || 'best';
    
    // Show/hide quality options based on download type
    document.getElementById('videoQualityContainer').style.display = 'none';
    document.getElementById('audioQualityContainer').style.display = 'block';
    
    // Show modal
    document.getElementById('downloadModal').style.display = 'flex';
}

function startDownload() {
    console.log('Starting download with currentVideoId:', currentVideoId);

    if (!currentVideoId) {
        showToast('No video selected', 'error');
        return;
    }

    const downloadType = document.getElementById('downloadType').value;
    const quality = downloadType === 'audio'
        ? document.getElementById('audioQuality').value
        : document.getElementById('videoQuality').value;
    const title = document.getElementById('downloadTitle').textContent;
    let thumbnailUrl = document.getElementById('downloadThumbnail').src;

    // Fallback: Generate YouTube thumbnail URL from video_id if missing
    if (!thumbnailUrl || thumbnailUrl.includes('data:image') || thumbnailUrl === window.location.href) {
        thumbnailUrl = `https://i.ytimg.com/vi/${currentVideoId}/mqdefault.jpg`;
        console.log('[THUMBNAIL FALLBACK] Generated thumbnail URL:', thumbnailUrl);
    }
    
    console.log('Download parameters:', { 
        downloadType, 
        quality, 
        title, 
        thumbnailUrl 
    });
    
    // Create download item
    // DEBUG: Log the video_id being sent to API
    console.log(`[FRONTEND DEBUG] Sending video_id: '${currentVideoId}' (length: ${currentVideoId.length})`);
    console.log(`[FRONTEND DEBUG] Title: '${title}'`);
    
    const downloadItem = {
        video_id: currentVideoId,
        title: title,
        thumbnail_url: thumbnailUrl,
        download_type: downloadType,
        quality: quality
    };
    
    console.log('Sending download request with data:', downloadItem);
    
    // Add to queue
    fetch('/api/downloads', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify(downloadItem)
    })
    .then(response => {
        console.log('Download API response status:', response.status);

        // Check if the response is OK
        if (!response.ok) {
            if (response.status === 401) {
                // Authentication error
                return response.json().then(data => {
                    throw new Error('Authentication required');
                }).catch(e => {
                    // If JSON parsing fails, it's probably an HTML page
                    throw new Error(`Authentication required (${response.status})`);
                });
            }

            // Other errors
            return response.text().then(text => {
                // Try to parse as JSON if possible
                try {
                    const data = JSON.parse(text);
                    throw new Error(data.error || `Server error: ${response.status}`);
                } catch (e) {
                    // If it's not JSON, it's probably an HTML page
                    console.error('Response is not JSON:', text.substring(0, 100) + '...');
                    throw new Error(`Server error: ${response.status}`);
                }
            });
        }
        
        return response.json();
    })
    .then(data => {
        if (data.error) {
            showToast(`Error: ${data.error}`, 'error');
            return;
        }
        
        // Close modal first
        document.getElementById('downloadModal').style.display = 'none';
        
        if (data.existing) {
            // Video already exists - show appropriate message based on source
            const messageType = data.global ? 'success' : 'info';
            const defaultMessage = data.global ? 
                'File found on server - instant access granted!' : 
                'Video already downloaded - showing existing download';
            showToast(data.message || defaultMessage, messageType);
            loadDownloads(); // Refresh the list to show the existing download
            loadExtractions(); // Also refresh extractions in case user was granted access to existing extraction
        } else {
            // New download - add to UI immediately
            const downloadElement = createDownloadElement({
                download_id: data.download_id,
                video_id: currentVideoId,
                title: title,
                status: 'queued',
                progress: 0,
                speed: '0 KB/s',
                eta: 'Unknown',
                file_path: '',
                error_message: ''
            });
            
            document.getElementById('downloadsContainer').appendChild(downloadElement);
            showToast('Download added to queue', 'success');
        }
        
        // Switch to downloads tab
        switchToTab('downloads');
    })
    .catch(error => {
        console.error('Error adding download:', error);
        showToast(`Error adding download: ${error.message}`, 'error');
    });
}

// Extraction Modal Functions
function openExtractionModal(downloadId, title, filePath, videoId) {
    console.log('[EXTRACTION MODAL] Opening modal with:', {
        downloadId,
        title,
        filePath,
        videoId
    });

    currentExtractionItem = {
        download_id: downloadId,
        title: title,
        audio_path: filePath,
        video_id: videoId  // Store video_id for deduplication
    };

    document.getElementById('extractionTitle').textContent = title;
    document.getElementById('extractionPath').textContent = filePath;

    // Set default values from settings
    document.getElementById('stemModel').value = appConfig.default_stem_model || 'htdemucs';

    // Update available stems based on the model
    updateStemOptions();

    // Update the model description
    updateModelDescription();

    document.getElementById('twoStemMode').checked = false;
    document.getElementById('primaryStemContainer').style.display = 'none';
    document.getElementById('primaryStem').value = 'vocals';

    // Show modal
    document.getElementById('extractionModal').style.display = 'flex';
    console.log('[EXTRACTION MODAL] Modal displayed successfully');
}

// Function to load the selected model description
function updateModelDescription() {
    const modelSelect = document.getElementById('stemModel');
    const selectedModel = modelSelect.value;
    const modelDescriptionElement = document.getElementById('modelDescription');

    // Dictionary of model descriptions
    const modelDescriptions = {
        'htdemucs': 'High quality 4-stem separation (vocals, drums, bass, other) - Recommended for most users',
        'htdemucs_ft': 'Fine-tuned HTDemucs model with enhanced quality for 4-stem separation',
        'htdemucs_6s': 'Advanced 6-stem separation (vocals, drums, bass, guitar, piano, other)',
        'mdx_extra': 'MDX model with enhanced vocal separation capabilities',
        'mdx_extra_q': 'Optimized MDX model requiring diffq package (currently unavailable on Windows)'
    };

    // Update the description
    modelDescriptionElement.textContent = modelDescriptions[selectedModel] || '';
}

// Function to update stem options based on the selected model
function updateStemOptions() {
    const modelSelect = document.getElementById('stemModel');
    const selectedModel = modelSelect.value;
    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    const stemCheckboxes = document.getElementById('stemCheckboxes');

    // Get available stems from the data-stems attribute
    const availableStems = selectedOption.getAttribute('data-stems') ? 
                          selectedOption.getAttribute('data-stems').split(',') : 
                          ['vocals', 'drums', 'bass', 'other'];

    // Clear the checkboxes container
    stemCheckboxes.innerHTML = '';

    // Create checkboxes for each available stem
    availableStems.forEach(stem => {
        const stemId = `${stem}Checkbox`;
        const checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'stem-checkbox';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = stemId;
        checkbox.checked = true;
        
        const label = document.createElement('label');
        label.htmlFor = stemId;
        label.textContent = stem.charAt(0).toUpperCase() + stem.slice(1); // Capitalize first letter
        
        checkboxDiv.appendChild(checkbox);
        checkboxDiv.appendChild(label);
        stemCheckboxes.appendChild(checkboxDiv);
    });

    // Also update the options in the primaryStem selector
    const primaryStemSelect = document.getElementById('primaryStem');
    primaryStemSelect.innerHTML = '';
    
    availableStems.forEach(stem => {
        const option = document.createElement('option');
        option.value = stem;
        option.textContent = stem.charAt(0).toUpperCase() + stem.slice(1);
        primaryStemSelect.appendChild(option);
    });

    // Select 'vocals' by default if available
    if (availableStems.includes('vocals')) {
        primaryStemSelect.value = 'vocals';
    }
}

function startExtraction() {
    console.log('[START EXTRACTION] Function called, currentExtractionItem:', currentExtractionItem);

    if (!currentExtractionItem) {
        console.error('[START EXTRACTION] No currentExtractionItem!');
        showToast('No audio file selected', 'error');
        return;
    }

    const modelName = document.getElementById('stemModel').value;
    const twoStemMode = document.getElementById('twoStemMode').checked;
    const primaryStem = document.getElementById('primaryStem').value;

    // Get selected stems from dynamically created checkboxes
    const selectedStems = [];
    const checkboxes = document.querySelectorAll('#stemCheckboxes input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            // Extract stem name from ID (remove 'Checkbox' suffix)
            const stemName = checkbox.id.replace('Checkbox', '');
            selectedStems.push(stemName);
        }
    });

    console.log('[START EXTRACTION] Selected stems:', selectedStems);

    if (selectedStems.length === 0) {
        console.error('[START EXTRACTION] No stems selected!');
        showToast('Please select at least one stem to extract', 'warning');
        return;
    }

    // Use video_id from the extraction item (passed from the download)
    const video_id = currentExtractionItem.video_id || "";

    // Create extraction item
    const extractionItem = {
        audio_path: currentExtractionItem.audio_path,
        model_name: modelName,
        selected_stems: selectedStems,
        two_stem_mode: twoStemMode,
        primary_stem: primaryStem,
        video_id: video_id,  // Add video_id for deduplication
        title: currentExtractionItem.title  // Add title for database storage
    };

    console.log('[START EXTRACTION] Sending POST to /api/extractions with:', extractionItem);

    // Add to queue
    fetch('/api/extractions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify(extractionItem)
    })
    .then(response => {
        console.log('[START EXTRACTION] Received response status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('[START EXTRACTION] Response data:', data);

        if (data.error) {
            console.error('[START EXTRACTION] Error from API:', data.error);
            showToast(`Error: ${data.error}`, 'error');
            return;
        }

        // Check if extraction is in progress by another user
        if (data.in_progress && data.extraction_id === 'in_progress') {
            console.log('[EXTRACTION POLL] Detected extraction in progress by another user, starting polling...');
            showToast(data.message || 'Extraction in progress by another user. Will auto-refresh when complete.', 'warning');
            startExtractionPolling();
            return;
        }

        // Close modal first
        document.getElementById('extractionModal').style.display = 'none';

        if (data.existing) {
            // Extraction already exists - show message and refresh My Library
            console.log('[START EXTRACTION] Extraction already exists');
            showToast(data.message || 'Stems already extracted - showing existing extraction', 'info');
        } else {
            // New extraction - it will appear in My Library when complete
            console.log('[START EXTRACTION] New extraction started successfully');
            showToast('Extraction added to queue - check My Library when complete', 'success');

            // IMPORTANT: Immediately update the existing DOM element with extraction_id
            // This prevents race condition where WebSocket events arrive before loadDownloads() completes
            if (data.extraction_id && currentExtractionItem.video_id) {
                const existingElement = document.querySelector(`#downloadsContainer .download-item[data-video-id="${currentExtractionItem.video_id}"]`);
                if (existingElement) {
                    existingElement.setAttribute('data-extraction-id', data.extraction_id);
                    console.log('[START EXTRACTION] Immediately updated element with extraction_id:', data.extraction_id);
                }
            }
        }

        // Switch to My Library tab and refresh the list to show extraction status
        console.log('[START EXTRACTION] Switching to downloads tab and refreshing list');
        switchToTab('downloads');
        loadDownloads(); // Refresh to show updated extraction status
    })
    .catch(error => {
        console.error('[START EXTRACTION] Fetch error:', error);
        showToast('Error adding extraction', 'error');
    });
}

// Download and Extraction Management
function loadDownloads() {
    fetch('/api/downloads', {
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
        .then(response => {
            if (!response.ok) {
                if (response.status === 401) {
                    // Handle authentication error
                    return response.json().then(data => {
                        throw new Error('Authentication required');
                    });
                }
                throw new Error(`Failed to load downloads: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            const downloadsContainer = document.getElementById('downloadsContainer');
            downloadsContainer.innerHTML = '';
            
            if (data.length === 0) {
                downloadsContainer.innerHTML = '<div class="empty-state">No downloads yet</div>';
                return;
            }
            
            // Sort downloads by creation time (newest first)
            data.sort((a, b) => {
                // Handle different created_at formats (database timestamp vs Unix timestamp)
                const timeA = isNaN(a.created_at) ? new Date(a.created_at) : new Date(parseInt(a.created_at) * 1000);
                const timeB = isNaN(b.created_at) ? new Date(b.created_at) : new Date(parseInt(b.created_at) * 1000);
                return timeB - timeA;
            });
            
            data.forEach(item => {
                const downloadElement = createDownloadElement(item);
                downloadsContainer.appendChild(downloadElement);
            });

            // Batch fetch extraction statuses for all completed downloads
            const completedVideoIds = data
                .filter(item => item.status === 'completed' && item.video_id)
                .map(item => item.video_id);

            if (completedVideoIds.length > 0) {
                batchUpdateExtractionStatuses(completedVideoIds);
            }

            // Update left panel if we're on extractions tab
            updateDownloadsListForExtraction(data);
            
            // Update user management controls visibility
            updateUserManagementControls();
        })
        .catch(error => {
            console.error('Error loading downloads:', error);
            document.getElementById('downloadsContainer').innerHTML = 
                `<div class="error-message">Failed to load downloads: ${error.message}</div>`;
            showToast(`Failed to load downloads: ${error.message}`, 'error');
        });
}

// Since extractions are now shown in the unified My Library interface,
// loadExtractions() now simply refreshes the downloads list which includes extraction status
function loadExtractions() {
    console.log('[UI REFACTOR] loadExtractions() called - redirecting to loadDownloads() for unified My Library view');

    // Stop extraction polling if active
    if (waitingForExtraction) {
        console.log('[EXTRACTION POLL] Found extractions, stopping polling');
        stopExtractionPolling();
        showToast('Extraction completed! List refreshed automatically.', 'success');
    }

    // Load the unified downloads list which now shows extraction status
    loadDownloads();
}

// Batch fetch extraction statuses for multiple videos at once
async function batchUpdateExtractionStatuses(videoIds) {
    if (!videoIds || videoIds.length === 0) return;

    try {
        const response = await fetch('/api/downloads/batch-extraction-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify({ video_ids: videoIds })
        });

        if (!response.ok) {
            console.error('Batch extraction status failed:', response.status);
            return;
        }

        const data = await response.json();
        const statuses = data.statuses || {};

        // Update all buttons at once
        for (const videoId of videoIds) {
            const status = statuses[videoId] || { exists: false, user_has_access: false, status: 'not_extracted' };
            const extractButton = document.querySelector(`.extract-button[data-video-id="${videoId}"]`);
            if (extractButton) {
                const downloadElement = extractButton.closest('.download-item');
                await updateExtractButton(extractButton, status, downloadElement);
            }
        }
    } catch (error) {
        console.error('Error batch fetching extraction statuses:', error);
    }
}

// Check extraction status for a video (kept for single-item updates)
async function checkExtractionStatus(videoId) {
    try {
        const response = await fetch(`/api/downloads/${encodeURIComponent(videoId)}/extraction-status`, {
            headers: {
                'X-CSRF-Token': getCsrfToken()
            }
        });

        if (!response.ok) {
            return { exists: false, user_has_access: false, status: 'not_extracted' };
        }

        return await response.json();
    } catch (error) {
        console.error('Error checking extraction status:', error);
        return { exists: false, user_has_access: false, status: 'not_extracted' };
    }
}

// Grant access to existing extraction
async function grantExtractionAccess(videoId, button) {
    try {
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Granting Access...';
        button.disabled = true;
        
        const response = await fetch('/api/extractions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify({
                video_id: videoId,
                grant_access_only: true  // Special flag to only grant access
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to grant access');
        }
        
        // Success - update button to mixer
        button.innerHTML = '<i class="fas fa-sliders-h"></i> Open Mixer';
        button.className = 'item-button extract-button extracted';
        button.disabled = false;
        
        // Update click handler
        button.removeEventListener('click', arguments.callee);
        button.addEventListener('click', () => {
            switchToTab('mixer');
            loadExtractionInMixer(`download_${button.dataset.downloadId}`);
        });
        
        showToast('Access granted! You can now use the mixer.', 'success');
        
    } catch (error) {
        console.error('Error granting access:', error);
        button.innerHTML = '<i class="fas fa-key"></i> Already Extracted/Grant me Access';
        button.disabled = false;
        showToast('Failed to grant access. Please try again.', 'error');
    }
}

// Update extract button based on extraction status
async function updateExtractButton(button, extractionStatus, downloadElement) {
    console.log('[EXTRACT BUTTON] Updating button state:', {
        videoId: button.dataset.videoId,
        downloadId: button.dataset.downloadId,
        status: extractionStatus.status,
        title: button.dataset.title
    });

    // Remove loading class
    button.classList.remove('loading');

    // Clone button to remove all existing event listeners
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);

    if (extractionStatus.status === 'not_extracted') {
        // Not extracted - show normal extract button
        console.log('[EXTRACT BUTTON] Setting up Extract Stems button for video_id:', newButton.dataset.videoId);
        newButton.innerHTML = '<i class="fas fa-music"></i> Extract Stems';
        newButton.className = 'item-button extract-button';
        newButton.addEventListener('click', () => {
            // Disable immediately to prevent double-clicks
            newButton.disabled = true;
            newButton.style.opacity = '0.5';
            console.log('[EXTRACT BUTTON] Extract Stems clicked!', {
                downloadId: newButton.dataset.downloadId,
                title: newButton.dataset.title,
                filePath: newButton.dataset.filePath,
                videoId: newButton.dataset.videoId
            });
            openExtractionModal(
                newButton.dataset.downloadId,
                newButton.dataset.title,
                newButton.dataset.filePath,
                newButton.dataset.videoId
            );
        });
    } else if (extractionStatus.status === 'extracted') {
        // User has access - show mixer button with extraction info
        console.log('[EXTRACT BUTTON] Setting up Open Mixer button for video_id:', newButton.dataset.videoId);
        const modelInfo = extractionStatus.extraction_model || 'htdemucs';
        newButton.innerHTML = `<i class="fas fa-sliders-h"></i> Open Mixer <span class="extraction-badge">${modelInfo}</span>`;
        newButton.className = 'item-button extract-button extracted';
        newButton.addEventListener('click', () => {
            console.log('[EXTRACT BUTTON] Open Mixer clicked!', {
                downloadId: newButton.dataset.downloadId,
                videoId: newButton.dataset.videoId
            });
            // Switch to mixer tab and load this extraction
            switchToTab('mixer');
            loadExtractionInMixer(`download_${newButton.dataset.downloadId}`);
        });

        // Populate download dropdown with stems if available
        if (downloadElement && extractionStatus.stems_available) {
            populateDownloadDropdownWithStems(downloadElement, extractionStatus);
        }
    } else if (extractionStatus.status === 'extracted_no_access') {
        // Extracted by someone else - show grant access button
        console.log('[EXTRACT BUTTON] Setting up Grant Access button for video_id:', newButton.dataset.videoId);
        newButton.innerHTML = '<i class="fas fa-key"></i> Already Extracted/Grant me Access';
        newButton.className = 'item-button extract-button grant-access';
        newButton.addEventListener('click', async () => {
            console.log('[EXTRACT BUTTON] Grant Access clicked!', {
                videoId: newButton.dataset.videoId
            });
            await grantExtractionAccess(newButton.dataset.videoId, newButton);
        });
    }
}

// Populate download dropdown menu with available stems
function populateDownloadDropdownWithStems(downloadElement, extractionStatus) {
    const stemsDownloadBtn = downloadElement.querySelector('.stems-downloads');
    const stemsDivider = downloadElement.querySelector('.stems-divider');
    const stemsSubmenu = downloadElement.querySelector('.stems-submenu');
    const stemsList = downloadElement.querySelector('.stems-list');

    if (!stemsDownloadBtn || !stemsList) return;

    // Show stems sections
    stemsDownloadBtn.style.display = 'block';
    stemsDivider.style.display = 'block';
    stemsSubmenu.style.display = 'block';

    // Add ZIP download handler
    stemsDownloadBtn.style.cursor = 'pointer';
    stemsDownloadBtn.addEventListener('click', () => {
        if (extractionStatus.zip_path) {
            window.location.href = `/api/download-file?file_path=${encodeURIComponent(extractionStatus.zip_path)}`;
        } else if (extractionStatus.extraction_id) {
            // Create ZIP on-the-fly
            showToast('Creating ZIP archive...', 'info');
            createZipForExtraction(extractionStatus.extraction_id);
        }
    });

    // Populate individual stems
    if (extractionStatus.stems_paths && typeof extractionStatus.stems_paths === 'object') {
        stemsList.innerHTML = '';

        // Sort stems in logical order
        const stemOrder = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
        const sortedStems = Object.keys(extractionStatus.stems_paths).sort((a, b) => {
            const indexA = stemOrder.indexOf(a.toLowerCase());
            const indexB = stemOrder.indexOf(b.toLowerCase());
            return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
        });

        sortedStems.forEach(stemName => {
            const stemPath = extractionStatus.stems_paths[stemName];
            const stemLink = document.createElement('a');
            stemLink.href = `/api/download-file?file_path=${encodeURIComponent(stemPath)}`;
            stemLink.className = 'dropdown-item stem-item';
            stemLink.innerHTML = `<i class="fas fa-file-audio"></i> ${capitalizeFirstLetter(stemName)}`;
            stemsList.appendChild(stemLink);
        });
    }
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function createDownloadElement(item) {
    // Debug: log the item structure and video_id specifically
    console.log('createDownloadElement item:', item);
    console.log('🔍 [DEBUG] video_id field:', item.video_id);
    console.log('🔍 [DEBUG] Available fields:', Object.keys(item));
    // Use download_id for live downloads, id for database downloads, or fallback to video_id
    const itemId = item.download_id || item.id || item.video_id;

    const downloadElement = document.createElement('div');
    downloadElement.className = 'download-item';
    downloadElement.id = `download-${itemId}`;
    // Add data attributes for finding elements during extraction progress
    downloadElement.setAttribute('data-video-id', item.video_id);
    downloadElement.setAttribute('data-download-id', itemId);
    // Add extraction_id if extraction is in progress
    if (item.extraction_id) {
        downloadElement.setAttribute('data-extraction-id', item.extraction_id);
    }

    const statusClass = getStatusClass(item.status);
    const statusText = getStatusText(item.status);

    // Reset progress bar to 0% when extraction starts (status changes to 'extracting')
    // This ensures the progress bar shows extraction progress from 0% instead of staying at 100% from download
    const displayProgress = (item.status === 'extracting' || item.status === 'queued') ? 0 : item.progress;

    // Debug: Log thumbnail data
    console.log('[DOWNLOAD ITEM] Creating item:', {
        id: itemId,
        title: item.title,
        thumbnail_url: item.thumbnail_url,
        hasThumbnail: !!item.thumbnail_url,
        trimmed: item.thumbnail_url ? item.thumbnail_url.trim() : 'N/A',
        isEmpty: item.thumbnail_url ? item.thumbnail_url.trim() === '' : 'N/A'
    });

    // Prepare audio analysis data display
    const audioAnalysisDisplay = item.detected_bpm || item.detected_key ? `
        <div class="audio-analysis-info">
            ${item.detected_bpm ? `<span class="bpm-info"><i class="fas fa-drum"></i> ${item.detected_bpm} BPM</span>` : ''}
            ${item.detected_key ? `<span class="key-info"><i class="fas fa-music"></i> ${item.detected_key}</span>` : ''}
            ${item.analysis_confidence ? `<span class="confidence-info" title="Analysis confidence">${Math.round(item.analysis_confidence * 100)}%</span>` : ''}
        </div>
    ` : '';

    downloadElement.innerHTML = `
        <div class="item-header">
            <div class="item-thumbnail">
                ${item.thumbnail_url && item.thumbnail_url.trim() !== '' ? `
                    <img src="${item.thumbnail_url}" alt="${item.title}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect fill=%22%23333%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-size=%2240%22 fill=%22%23666%22%3E%E2%99%AA%3C/text%3E%3C/svg%3E';">
                ` : `
                    <div class="item-thumbnail-placeholder">
                        <i class="fas fa-music"></i>
                    </div>
                `}
            </div>
            <div class="item-title-container">
                <input type="checkbox" class="user-item-checkbox" data-video-id="${item.video_id}" value="${item.global_download_id}">
                <div class="item-title">${item.title}</div>
                ${audioAnalysisDisplay}
            </div>
            <div class="item-status ${statusClass}">${statusText}</div>
        </div>
        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${displayProgress}%"></div>
            </div>
            <div class="progress-info">
                <span class="progress-percentage">${displayProgress}%</span>
                <span class="progress-details">${item.speed} - ${item.eta}</span>
            </div>
        </div>
        <div class="item-actions">
            ${item.status === 'completed' ? `
                <button class="item-button extract-button loading" data-download-id="${itemId}" data-title="${item.title}" data-file-path="${item.file_path}" data-video-id="${item.video_id}">
                    <i class="fas fa-spinner fa-spin"></i> Checking...
                </button>
                <div class="download-dropdown">
                    <button class="item-button download-button">
                        <i class="fas fa-download"></i> Download <i class="fas fa-caret-down"></i>
                    </button>
                    <div class="download-dropdown-menu">
                        <a href="/api/download-file?file_path=${encodeURIComponent(item.file_path)}" class="dropdown-item">
                            <i class="fas fa-file-audio"></i> Download MP3 (Original)
                        </a>
                        <div class="dropdown-item stems-downloads" style="display: none;">
                            <i class="fas fa-file-archive"></i> Download All Stems (ZIP)
                        </div>
                        <div class="dropdown-divider stems-divider" style="display: none;"></div>
                        <div class="dropdown-submenu stems-submenu" style="display: none;">
                            <div class="dropdown-item-header">
                                <i class="fas fa-music"></i> Individual Stems:
                            </div>
                            <div class="stems-list"></div>
                        </div>
                    </div>
                </div>
                <button class="item-button remove-from-list" data-video-id="${item.video_id}" title="Remove from my list">
                    <i class="fas fa-eye-slash"></i> Remove from List
                </button>
            ` : ''}
            ${item.status === 'downloading' || item.status === 'queued' ? `
                <button class="item-button cancel cancel-download-button" data-download-id="${itemId}">
                    <i class="fas fa-times"></i> Cancel
                </button>
            ` : ''}
            ${item.status === 'error' || item.status === 'cancelled' || item.status === 'failed' || !item.status || item.status === 'undefined' ? `
                <div class="error-message">${item.error_message || 'Download failed or cancelled'}</div>
                <div class="action-buttons">
                    <button class="item-button retry-button" data-download-id="${itemId}">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                    <button class="item-button delete-button" data-download-id="${itemId}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    <button class="item-button remove-from-list" data-video-id="${item.video_id}" title="Remove from my list">
                        <i class="fas fa-eye-slash"></i> Remove from List
                    </button>
                </div>
            ` : ''}
        </div>
    `;
    
    // Add event listeners (extraction status is now fetched in batch by loadDownloads)
    setTimeout(async () => {
        // Setup download dropdown
        const downloadDropdown = downloadElement.querySelector('.download-dropdown');
        if (downloadDropdown) {
            const dropdownButton = downloadDropdown.querySelector('.download-button');
            const dropdownMenu = downloadDropdown.querySelector('.download-dropdown-menu');

            // Toggle dropdown on button click
            dropdownButton.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close all other dropdowns first
                document.querySelectorAll('.download-dropdown-menu.show').forEach(menu => {
                    if (menu !== dropdownMenu) {
                        menu.classList.remove('show');
                    }
                });
                dropdownMenu.classList.toggle('show');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!downloadDropdown.contains(e.target)) {
                    dropdownMenu.classList.remove('show');
                }
            });
        }
        
        const openFolderButton = downloadElement.querySelector('.open-folder-button');
        if (openFolderButton) {
            openFolderButton.addEventListener('click', () => {
                const filePath = openFolderButton.dataset.filePath;
                // Handle both Windows (\) and Unix (/) path separators
                const lastBackslash = filePath.lastIndexOf('\\');
                const lastForwardslash = filePath.lastIndexOf('/');
                const lastSeparator = Math.max(lastBackslash, lastForwardslash);
                const folderPath = filePath.substring(0, lastSeparator);
                const title = downloadElement.querySelector('.item-title').textContent;

                // Determine if the user is local or remote
                const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

                if (isLocalhost) {
                    // For local users, offer the option to open the folder locally
                    console.log(`Opening folder locally: ${folderPath}`);
                    
                    fetch('/api/open-folder', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': getCsrfToken()
                        },
                        body: JSON.stringify({ folder_path: folderPath })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            console.log('Folder opened successfully');
                            showToast('Folder opened successfully', 'success');
                        } else {
                            // If local opening fails, show the download modal
                            console.error('Error opening folder:', data.message);
                            showToast(`Couldn't open folder locally. Showing file list instead.`, 'warning');
                            showFilesModal(folderPath, title);
                        }
                    })
                    .catch(error => {
                        console.error('Error calling open-folder API:', error);
                        showToast('Error opening folder', 'error');
                        // Show the download modal in case of error
                        showFilesModal(folderPath, title);
                    });
                } else {
                    // For remote users, directly show the download modal
                    console.log(`Showing files list for remote user: ${folderPath}`);
                    showFilesModal(folderPath, title);
                }
            });
        }
        
        const cancelButton = downloadElement.querySelector('.cancel-download-button');
        if (cancelButton) {
            cancelButton.addEventListener('click', () => {
                cancelDownload(cancelButton.dataset.downloadId);
            });
        }
        
        const retryButton = downloadElement.querySelector('.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                retryDownload(retryButton.dataset.downloadId);
            });
        }
        
        const deleteButton = downloadElement.querySelector('.delete-button');
        if (deleteButton) {
            deleteButton.addEventListener('click', () => {
                deleteDownload(deleteButton.dataset.downloadId);
            });
        }
        
        // Add remove from list button event handler
        const removeFromListButton = downloadElement.querySelector('.remove-from-list');
        if (removeFromListButton) {
            console.log('🔍 [DEBUG] Remove button video_id:', removeFromListButton.dataset.videoId);
            removeFromListButton.addEventListener('click', () => {
                console.log('🔴 [DEBUG] Remove clicked with video_id:', removeFromListButton.dataset.videoId);
                if (!removeFromListButton.dataset.videoId || removeFromListButton.dataset.videoId === '' || removeFromListButton.dataset.videoId === 'undefined') {
                    console.error('🔴 [DEBUG] Invalid video_id, using fallback approach');
                    showToast('Error: Invalid video ID. Please refresh the page.', 'error');
                    return;
                }
                removeDownloadFromList(removeFromListButton.dataset.videoId);
            });
        }
    }, 0);
    
    return downloadElement;
}

function createExtractionElement(item) {
    // Debug: log the item structure
    console.log('createExtractionElement item:', item);
    const extractionElement = document.createElement('div');
    extractionElement.className = 'extraction-item';
    extractionElement.id = `extraction-${item.extraction_id}`;
    
    const statusClass = getStatusClass(item.status);
    const statusText = getStatusText(item.status);
    const title = item.title || getFileNameFromPath(item.audio_path);

    // Prepare audio analysis data display
    const audioAnalysisDisplay = item.detected_bpm || item.detected_key ? `
        <div class="audio-analysis-info">
            ${item.detected_bpm ? `<span class="bpm-info"><i class="fas fa-drum"></i> ${item.detected_bpm} BPM</span>` : ''}
            ${item.detected_key ? `<span class="key-info"><i class="fas fa-music"></i> ${item.detected_key}</span>` : ''}
            ${item.analysis_confidence ? `<span class="confidence-info" title="Analysis confidence">${Math.round(item.analysis_confidence * 100)}%</span>` : ''}
        </div>
    ` : '';
    
    extractionElement.innerHTML = `
        <div class="item-header">
            <div class="item-title-container">
                <input type="checkbox" class="user-item-checkbox" data-video-id="${item.video_id}" value="${item.global_download_id}">
                <div class="item-title">${title}</div>
                ${audioAnalysisDisplay}
            </div>
            <div class="item-status ${statusClass}">${statusText}</div>
        </div>
        <div class="item-details">
            <div>Model: ${item.model_name}</div>
            <div>File: ${getFileNameFromPath(item.audio_path)}</div>
        </div>
        <div class="progress-container">
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${item.progress}%"></div>
            </div>
            <div class="progress-info">
                <span class="progress-percentage">${item.progress}%</span>
            </div>
        </div>
        <div class="item-actions">
            ${item.status === 'completed' ? `
                <div class="action-buttons">
                    <button class="item-button open-mixer-button extracted" data-extraction-id="${item.extraction_id}">
                        <i class="fas fa-sliders-h"></i> Open Mixer
                    </button>
                    <button class="item-button open-folder-button" data-file-path="${getFirstOutputPath(item)}" data-extraction-id="${item.extraction_id}">
                        <i class="fas fa-download"></i> Get Tracks
                    </button>
                    <button class="item-button download-zip-button" data-file-path="${item.zip_path || ''}" data-extraction-id="${item.extraction_id}">
                        <i class="fas fa-file-archive"></i> Download All (ZIP)
                    </button>
                    <button class="item-button remove-from-list" data-video-id="${item.video_id}" title="Remove from my list">
                        <i class="fas fa-eye-slash"></i> Remove from List
                    </button>
                </div>
            ` : ''}
            ${item.status === 'extracting' || item.status === 'queued' ? `
                <button class="item-button cancel cancel-extraction-button" data-extraction-id="${item.extraction_id}">
                    <i class="fas fa-times"></i> Cancel
                </button>
            ` : ''}
            ${item.status === 'error' || item.status === 'cancelled' ? `
                <div class="error-message">${item.error_message || 'Extraction cancelled'}</div>
                <div class="action-buttons">
                    <button class="item-button retry-button" data-extraction-id="${item.extraction_id}">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                    <button class="item-button delete-button" data-extraction-id="${item.extraction_id}">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                    <button class="item-button remove-from-list" data-video-id="${item.video_id}" title="Remove from my list">
                        <i class="fas fa-eye-slash"></i> Remove from List
                    </button>
                </div>
            ` : ''}
        </div>
    `;
    
    // Add event listeners
    setTimeout(() => {
        const openMixerButton = extractionElement.querySelector('.open-mixer-button');
        if (openMixerButton) {
            openMixerButton.addEventListener('click', () => {
                const extractionId = openMixerButton.dataset.extractionId;
                
                // Switch to the Mixer tab
                switchToTab('mixer');
                
                // Load extraction in mixer with state persistence
                loadExtractionInMixer(extractionId);
            });
        }
        
        const openFolderButton = extractionElement.querySelector('.open-folder-button');
        if (openFolderButton) {
            openFolderButton.addEventListener('click', () => {
                const filePath = openFolderButton.dataset.filePath;
                const extractionId = openFolderButton.dataset.extractionId;
                const title = extractionElement.querySelector('.item-title').textContent;
                
                let folderPath = '';
                
                if (filePath) {
                    // Handle both Windows (\) and Unix (/) path separators
                    const lastBackslash = filePath.lastIndexOf('\\');
                    const lastForwardslash = filePath.lastIndexOf('/');
                    const lastSeparator = Math.max(lastBackslash, lastForwardslash);
                    folderPath = filePath.substring(0, lastSeparator);
                } else {
                    // Try to find stems folder based on extraction info
                    // This is a fallback for cases where output_paths is not available
                    console.warn('No file path available, trying to construct stems folder path');
                    showToast('Unable to determine stems location', 'warning');
                    return;
                }
                
                // Determine if the user is local or remote
                const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                
                if (isLocalhost) {
                    // For local users, offer the option to open the folder locally
                    console.log(`Opening folder locally: ${folderPath}`);
                    
                    fetch('/api/open-folder', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': getCsrfToken()
                        },
                        body: JSON.stringify({ folder_path: folderPath })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            console.log('Folder opened successfully');
                            showToast('Folder opened successfully', 'success');
                        } else {
                            // If local opening fails, show the download modal
                            console.error('Error opening folder:', data.message);
                            showToast(`Couldn't open folder locally. Showing file list instead.`, 'warning');
                            showFilesModal(folderPath, title);
                        }
                    })
                    .catch(error => {
                        console.error('Error calling open-folder API:', error);
                        showToast('Error opening folder', 'error');
                        // Show the download modal in case of error
                        showFilesModal(folderPath, title);
                    });
                } else {
                    // For remote users, directly show the download modal
                    console.log(`Showing files list for remote user: ${folderPath}`);
                    showFilesModal(folderPath, title);
                }
            });
        }
        
        const downloadZipButton = extractionElement.querySelector('.download-zip-button');
        if (downloadZipButton) {
            downloadZipButton.addEventListener('click', () => {
                const filePath = downloadZipButton.dataset.filePath;
                const extractionId = downloadZipButton.dataset.extractionId;
                
                if (!filePath) {
                    // Try to create a ZIP on the fly
                    showToast('Creating ZIP archive...', 'info');
                    createZipForExtraction(extractionId);
                    return;
                }
                
                // Check if file exists by trying to download it
                window.location.href = `/api/download-file?file_path=${encodeURIComponent(filePath)}`;
            });
        }
        
        const cancelButton = extractionElement.querySelector('.cancel-extraction-button');
        if (cancelButton) {
            cancelButton.addEventListener('click', () => {
                cancelExtraction(cancelButton.dataset.extractionId);
            });
        }
        
        const retryButton = extractionElement.querySelector('.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                retryExtraction(retryButton.dataset.extractionId);
            });
        }
        
        const deleteButton = extractionElement.querySelector('.delete-button');
        if (deleteButton) {
            deleteButton.addEventListener('click', () => {
                deleteExtraction(deleteButton.dataset.extractionId);
            });
        }
        
        // Add remove from list button event handler
        const removeFromListButton = extractionElement.querySelector('.remove-from-list');
        if (removeFromListButton) {
            removeFromListButton.addEventListener('click', () => {
                removeExtractionFromList(removeFromListButton.dataset.videoId);
            });
        }
    }, 0);
    
    return extractionElement;
}

// Update Functions
function updateDownloadProgress(data) {
    console.log('Updating download progress:', data);

    // If the element doesn't exist, reload the downloads list
    const downloadElement = document.getElementById(`download-${data.download_id}`);
    if (!downloadElement) {
        console.warn(`Download element for ID ${data.download_id} not found, refreshing downloads list`);
        return loadDownloads();
    }

    try {
        // Get the DOM elements to update
        const progressFill = downloadElement.querySelector('.progress-fill');
        const progressPercentage = downloadElement.querySelector('.progress-percentage');
        const progressDetails = downloadElement.querySelector('.progress-details');
        const statusElement = downloadElement.querySelector('.item-status');
        
        if (!progressFill || !progressPercentage || !progressDetails || !statusElement) {
            console.error('Required elements not found in download item', downloadElement);
            return;
        }

        // Format progress with 1 decimal place
        const formattedProgress = parseFloat(data.progress).toFixed(1);
        
        console.log(`Updating progress bar to ${formattedProgress}% for download ${data.download_id}`);

        // Update the progress bar in an optimized way
        window.requestAnimationFrame(() => {
            // Update progress bar visually
            progressFill.style.width = `${formattedProgress}%`;
            progressPercentage.textContent = `${formattedProgress}%`;

            // Update speed and ETA
            if (data.speed && data.eta) {
                progressDetails.textContent = `${data.speed} - ${data.eta}`;
            } else if (data.speed) {
                progressDetails.textContent = data.speed;
            } else {
                progressDetails.textContent = 'Downloading...';
            }
            
            // Assurer que le statut est bien "Downloading"
            if (statusElement.textContent !== 'Downloading') {
                statusElement.textContent = 'Downloading';
                statusElement.className = 'item-status status-downloading';
                console.log(`Updated status to Downloading for ${data.download_id}`);
            }
        });
        
        // S'assurer que le button d'annulation existe
        const actionsContainer = downloadElement.querySelector('.item-actions');
        if (!actionsContainer.querySelector('.cancel-download-button')) {
            actionsContainer.innerHTML = `
                <button class="item-button cancel cancel-download-button" data-download-id="${data.download_id}">
                    <i class="fas fa-times"></i> Cancel
                </button>
            `;
            
            const cancelButton = actionsContainer.querySelector('.cancel-download-button');
            cancelButton.addEventListener('click', () => {
                cancelDownload(cancelButton.dataset.downloadId);
            });
        }
    } catch (error) {
        console.error('Error updating download progress:', error);
    }
}

function updateDownloadComplete(data) {
    console.log('🎯 [DEBUG] updateDownloadComplete called with data:', data);
    const downloadElement = document.getElementById(`download-${data.download_id}`);
    if (!downloadElement) {
        console.error('🔴 [DEBUG] Download element not found for ID:', data.download_id);
        return;
    }
    console.log('✅ [DEBUG] Found download element:', downloadElement);
    
    const progressFill = downloadElement.querySelector('.progress-fill');
    const progressPercentage = downloadElement.querySelector('.progress-percentage');
    const progressDetails = downloadElement.querySelector('.progress-details');
    const statusElement = downloadElement.querySelector('.item-status');
    const actionsContainer = downloadElement.querySelector('.item-actions');
    
    progressFill.style.width = '100%';
    progressPercentage.textContent = '100%';
    progressDetails.textContent = 'Completed';
    
    statusElement.textContent = 'Completed';
    statusElement.className = 'item-status status-completed';
    
    // Use the video_id from the WebSocket data (consistent identifier)
    const videoId = data.video_id || '';
    console.log('🔍 [DEBUG] Using video_id from WebSocket data:', videoId);
    
    actionsContainer.innerHTML = `
        <button class="item-button extract-button" data-download-id="${data.download_id}" data-title="${data.title}" data-file-path="${data.file_path}" data-video-id="${data.video_id}">
            <i class="fas fa-music"></i> Extract Stems
        </button>
        <button class="item-button open-folder-button" data-file-path="${data.file_path}">
            <i class="fas fa-download"></i> Get File
        </button>
        <button class="item-button remove-from-list" data-video-id="${videoId}" title="Remove from my list">
            <i class="fas fa-eye-slash"></i> Remove from List
        </button>
    `;
    
    // Add event listeners
    const extractButton = actionsContainer.querySelector('.extract-button');
    extractButton.addEventListener('click', () => {
        openExtractionModal(
            extractButton.dataset.downloadId,
            extractButton.dataset.title,
            extractButton.dataset.filePath,
            extractButton.dataset.videoId
        );
    });
    
    const openFolderButton = actionsContainer.querySelector('.open-folder-button');
    openFolderButton.addEventListener('click', () => {
        const filePath = openFolderButton.dataset.filePath;
        // Handle both Windows (\) and Unix (/) path separators
        const lastBackslash = filePath.lastIndexOf('\\');
        const lastForwardslash = filePath.lastIndexOf('/');
        const lastSeparator = Math.max(lastBackslash, lastForwardslash);
        const folderPath = filePath.substring(0, lastSeparator);
        const title = downloadElement.querySelector('.item-title').textContent;

        // Determine if the user is local or remote
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        if (isLocalhost) {
            // Pour les utilisateurs locaux, offrir l'option d'ouvrir le dossier localement
            console.log(`Opening folder locally: ${folderPath}`);
            
            fetch('/api/open-folder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                body: JSON.stringify({ folder_path: folderPath })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('Folder opened successfully');
                    showToast('Folder opened successfully', 'success');
                } else {
                    // If local opening fails, show the download modal
                    console.error('Error opening folder:', data.message);
                    showToast(`Couldn't open folder locally. Showing file list instead.`, 'warning');
                    showFilesModal(folderPath, title);
                }
            })
            .catch(error => {
                console.error('Error calling open-folder API:', error);
                showToast('Error opening folder', 'error');
                // Show the download modal in case of error
                showFilesModal(folderPath, title);
            });
        } else {
            // For remote users, directly show the download modal
            console.log(`Showing files list for remote user: ${folderPath}`);
            showFilesModal(folderPath, title);
        }
    });
    
    // Add remove from list button event handler
    const removeFromListButton = actionsContainer.querySelector('.remove-from-list');
    if (removeFromListButton) {
        console.log('✅ [DEBUG] Remove button found, adding event listener. video_id:', removeFromListButton.dataset.videoId);
        removeFromListButton.addEventListener('click', () => {
            console.log('🔴 [DEBUG] Remove button clicked! Calling removeDownloadFromList with video_id:', removeFromListButton.dataset.videoId);
            removeDownloadFromList(removeFromListButton.dataset.videoId);
        });
    } else {
        console.error('🔴 [DEBUG] Remove button not found in actionsContainer');
    }
}

function updateDownloadError(data) {
    console.error('💥 Download error received:', data);

    const downloadElement = document.getElementById(`download-${data.download_id}`);
    if (!downloadElement) {
        console.error(`❌ Download element not found: download-${data.download_id}`);
        // Show toast notification for errors on missing elements
        showToast(`Download failed: ${data.error_message}`, 'error');
        return;
    }

    const statusElement = downloadElement.querySelector('.item-status');
    const actionsContainer = downloadElement.querySelector('.item-actions');

    if (statusElement) {
        statusElement.textContent = 'Failed';
        statusElement.className = 'item-status status-error';
        statusElement.title = data.error_message; // Add tooltip with full error
    }

    if (actionsContainer) {
        // Enhanced error display with categorized styling
        let errorClass = 'error-message';
        let errorIcon = 'fas fa-exclamation-triangle';

        if (data.error_message.includes('403') || data.error_message.includes('forbidden')) {
            errorClass += ' error-forbidden';
            errorIcon = 'fas fa-ban';
        } else if (data.error_message.includes('404') || data.error_message.includes('not found')) {
            errorClass += ' error-not-found';
            errorIcon = 'fas fa-question-circle';
        } else if (data.error_message.includes('permission') || data.error_message.includes('access')) {
            errorClass += ' error-permission';
            errorIcon = 'fas fa-lock';
        } else if (data.error_message.includes('network') || data.error_message.includes('connection')) {
            errorClass += ' error-network';
            errorIcon = 'fas fa-wifi';
        }

        actionsContainer.innerHTML = `
            <div class="${errorClass}">
                <i class="${errorIcon}"></i>
                <span>${data.error_message}</span>
            </div>
            <div class="action-buttons">
                <button class="item-button retry-button" data-download-id="${data.download_id}" title="Try downloading again">
                    <i class="fas fa-redo"></i> Retry
                </button>
                <button class="item-button delete-button" data-download-id="${data.download_id}" title="Remove from list">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        `;

        // Add event listeners
        const retryButton = actionsContainer.querySelector('.retry-button');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                retryDownload(retryButton.dataset.downloadId);
            });
        }

        const deleteButton = actionsContainer.querySelector('.delete-button');
        if (deleteButton) {
            deleteButton.addEventListener('click', () => {
                deleteDownload(deleteButton.dataset.downloadId);
            });
        }
    }

    // Show toast notification for the error
    showToast(`Download failed: ${data.error_message}`, 'error');
}

// Timer-based extraction progress: smooth linear fill independent of backend events.
// Ratio from logs: ~0.5s processing per 1s of audio (GPU, htdemucs_6s).
// Total measured: 167s for 333s audio. Default estimate: 180s to have margin.
// Uses asymptotic curve: fast at start, slows near 99% so it never truly stops.
const _extractionTimers = {};  // keyed by video_id or extraction_id

function _startExtractionTimer(element, videoId) {
    if (_extractionTimers[videoId]) return; // already running

    const estimatedDurationSec = 180; // generous estimate to avoid stalling
    const intervalMs = 500; // update every 500ms
    const totalTicks = estimatedDurationSec * 1000 / intervalMs;

    const state = { progress: 0, tick: 0 };
    const fill = element.querySelector('.progress-fill');
    const pct = element.querySelector('.progress-percentage');

    state.interval = setInterval(() => {
        state.tick++;
        // Asymptotic curve: approaches 99% but never reaches it.
        // At tick == totalTicks (~180s), progress is ~63% of remaining = ~99%.
        // If extraction takes longer, it keeps creeping toward 99.9%.
        state.progress = 99 * (1 - Math.exp(-2.5 * state.tick / totalTicks));
        if (fill) fill.style.width = `${state.progress}%`;
        if (pct) {
            const existing = pct.textContent;
            const msgPart = existing.includes(' - ') ? existing.split(' - ').slice(1).join(' - ') : 'Extracting...';
            pct.textContent = `${Math.round(state.progress)}% - ${msgPart}`;
        }
    }, intervalMs);

    _extractionTimers[videoId] = state;
}

function _stopExtractionTimer(videoId) {
    const state = _extractionTimers[videoId];
    if (state) {
        clearInterval(state.interval);
        delete _extractionTimers[videoId];
    }
}

function updateExtractionProgress(data) {
    console.log('[EXTRACTION PROGRESS] Received progress update:', JSON.stringify(data));

    // In the merged My Library view, find download element by video_id
    let downloadElement = null;
    let foundBy = null;

    // PRIMARY: Find by data-video-id attribute (most reliable)
    if (data.video_id) {
        downloadElement = document.querySelector(`#downloadsContainer .download-item[data-video-id="${data.video_id}"]`);
        if (downloadElement) {
            foundBy = 'data-video-id';
            console.log('[EXTRACTION PROGRESS] ✓ Found download element by data-video-id:', data.video_id);
        } else {
            console.log('[EXTRACTION PROGRESS] ✗ Not found by data-video-id:', data.video_id);
        }
    } else {
        console.log('[EXTRACTION PROGRESS] ⚠ No video_id provided in data');
    }

    // SECONDARY: Find by download_id if provided
    if (!downloadElement && data.download_id) {
        downloadElement = document.getElementById(`download-${data.download_id}`);
        if (downloadElement) {
            foundBy = 'download_id';
            console.log('[EXTRACTION PROGRESS] ✓ Found element by download_id:', data.download_id);
        } else {
            console.log('[EXTRACTION PROGRESS] ✗ Not found by download_id:', data.download_id);
        }
    } else if (!downloadElement) {
        console.log('[EXTRACTION PROGRESS] ⚠ No download_id provided in data');
    }

    // TERTIARY: Find by data-extraction-id attribute (for ongoing extractions)
    if (!downloadElement && data.extraction_id) {
        downloadElement = document.querySelector(`#downloadsContainer .download-item[data-extraction-id="${data.extraction_id}"]`);
        if (downloadElement) {
            foundBy = 'data-extraction-id';
            console.log('[EXTRACTION PROGRESS] ✓ Found element by data-extraction-id:', data.extraction_id);
        } else {
            console.log('[EXTRACTION PROGRESS] ✗ Not found by data-extraction-id:', data.extraction_id);
        }
    }

    // FALLBACK: Try legacy extraction-id based lookup
    if (!downloadElement && data.extraction_id) {
        downloadElement = document.getElementById(`extraction-${data.extraction_id}`);
        if (downloadElement) {
            foundBy = 'legacy extraction-id';
            console.log('[EXTRACTION PROGRESS] ✓ Found element using legacy extraction-id');
        } else {
            console.log('[EXTRACTION PROGRESS] ✗ Not found by legacy extraction-id');
        }
    }

    if (!downloadElement) {
        console.error('[EXTRACTION PROGRESS] ❌ ELEMENT NOT FOUND');
        console.error('[EXTRACTION PROGRESS] Extraction ID:', data.extraction_id);
        console.error('[EXTRACTION PROGRESS] Video ID:', data.video_id);
        console.error('[EXTRACTION PROGRESS] Download ID:', data.download_id);
        console.error('[EXTRACTION PROGRESS] Available elements in DOM:');
        const allDownloadElements = document.querySelectorAll('#downloadsContainer .download-item');
        allDownloadElements.forEach((el, idx) => {
            console.error(`  [${idx}] id=${el.id}, data-video-id=${el.getAttribute('data-video-id')}, data-extraction-id=${el.getAttribute('data-extraction-id')}, data-download-id=${el.getAttribute('data-download-id')}`);
        });

        // Try to set data-extraction-id on the first matching video_id element if it exists
        if (data.video_id) {
            const elementByVideoId = document.querySelector(`#downloadsContainer .download-item[data-video-id="${data.video_id}"]`);
            if (elementByVideoId) {
                console.warn('[EXTRACTION PROGRESS] Found element by video_id but it might be missing data-extraction-id. Setting it now...');
                elementByVideoId.setAttribute('data-extraction-id', data.extraction_id);
                downloadElement = elementByVideoId;
                foundBy = 'video_id (with fallback fix)';
            }
        }

        if (!downloadElement) {
            return;
        }
    }

    console.log(`[EXTRACTION PROGRESS] Using element found by: ${foundBy}`);

    const progressFill = downloadElement.querySelector('.progress-fill');
    const progressPercentage = downloadElement.querySelector('.progress-percentage');
    const statusElement = downloadElement.querySelector('.item-status');
    const videoId = data.video_id || data.extraction_id;

    // Real 100% from backend = extraction truly complete
    if (data.progress >= 100) {
        _stopExtractionTimer(videoId);
        if (progressFill) progressFill.style.width = '100%';
        if (progressPercentage) {
            const statusMsg = data.message || data.status_message || 'Extraction completed';
            progressPercentage.textContent = `100% - ${statusMsg}`;
        }
        console.log('[EXTRACTION PROGRESS] Reached 100% — extraction complete');
        return;
    }

    // First event (progress ~0): reset bar and start timer-based linear fill
    if (data.progress < 1) {
        _stopExtractionTimer(videoId); // reset if re-starting
        if (progressFill) progressFill.style.width = '0%';
        if (progressPercentage) progressPercentage.textContent = '0% - Starting extraction...';
        _startExtractionTimer(downloadElement, videoId);
    } else if (!_extractionTimers[videoId]) {
        // Timer not running yet (e.g. page reload mid-extraction) — start it
        _startExtractionTimer(downloadElement, videoId);
    }

    // Backend events only update the STATUS MESSAGE, not the bar width
    // (the timer handles the bar progression independently)
    if (progressPercentage && data.progress > 0) {
        const statusMsg = data.message || data.status_message || data.status || 'Extracting...';
        const currentTimerProgress = _extractionTimers[videoId]?.progress || 0;
        progressPercentage.textContent = `${Math.round(currentTimerProgress)}% - ${statusMsg}`;
    }

    if (statusElement && statusElement.textContent !== 'Extracting') {
        statusElement.textContent = 'Extracting';
        statusElement.className = 'item-status status-extracting';
    }

    // Hide Extract button during extraction
    const extractButton = downloadElement.querySelector('.extract-button');
    if (extractButton && !extractButton.classList.contains('extracted')) {
        extractButton.style.display = 'none';
    }

    console.log('[EXTRACTION PROGRESS] Status update:', data.message || data.status_message);
}

function updateExtractionComplete(data) {
    console.log('[EXTRACTION COMPLETE] Received completion event:', data);

    // In the merged My Library view, find download element by video_id
    let downloadElement = null;

    // PRIMARY: Find by data-video-id attribute (most reliable)
    if (data.video_id) {
        downloadElement = document.querySelector(`#downloadsContainer .download-item[data-video-id="${data.video_id}"]`);
        if (downloadElement) {
            console.log('[EXTRACTION COMPLETE] Found download element by data-video-id:', data.video_id);
        }
    }

    // SECONDARY: Find by download_id if provided
    if (!downloadElement && data.download_id) {
        downloadElement = document.getElementById(`download-${data.download_id}`);
        if (downloadElement) {
            console.log('[EXTRACTION COMPLETE] Found element by download_id:', data.download_id);
        }
    }

    // FALLBACK: Try legacy extraction-id based lookup
    if (!downloadElement) {
        downloadElement = document.getElementById(`extraction-${data.extraction_id}`);
        if (downloadElement) {
            console.log('[EXTRACTION COMPLETE] Found element using legacy extraction-id');
        }
    }

    // Stop extraction timer
    const videoId = data.video_id || data.extraction_id;
    _stopExtractionTimer(videoId);

    if (!downloadElement) {
        console.warn('[EXTRACTION COMPLETE] Could not find element for extraction:', data.extraction_id, 'video_id:', data.video_id, 'download_id:', data.download_id);
        // Refresh the downloads list to show the updated extraction
        console.log('[EXTRACTION COMPLETE] Refreshing downloads list...');
        loadDownloads();
        showToast('Extraction completed successfully!', 'success');
        return;
    }

    // Update progress bar and status
    const progressFill = downloadElement.querySelector('.progress-fill');
    const progressPercentage = downloadElement.querySelector('.progress-percentage');
    const statusElement = downloadElement.querySelector('.item-status');

    if (progressFill) {
        progressFill.style.width = '100%';
    }

    if (progressPercentage) {
        progressPercentage.textContent = '100%';
    }

    if (statusElement) {
        statusElement.textContent = 'Completed';
        statusElement.className = 'item-status status-completed';
    }

    // Update the Extract button to become "Open Mixer" button
    const extractButton = downloadElement.querySelector('.extract-button');
    if (extractButton) {
        extractButton.innerHTML = '<i class="fas fa-sliders-h"></i> Open Mixer';
        extractButton.className = 'item-button extract-button extracted';

        // Remove old event listeners by cloning
        const newButton = extractButton.cloneNode(true);
        extractButton.parentNode.replaceChild(newButton, extractButton);

        // Add new event listener for mixer
        newButton.addEventListener('click', () => {
            switchToTab('mixer');
            loadExtractionInMixer(`download_${newButton.dataset.downloadId}`);
        });

        console.log('[EXTRACTION COMPLETE] Updated Extract button to Open Mixer for video_id:', data.video_id);
    }

    // Show success toast
    showToast(`Extraction completed: ${data.title}`, 'success');

    // Also trigger a refresh to load stems dropdown and other data
    setTimeout(() => {
        console.log('[EXTRACTION COMPLETE] Refreshing downloads to load stems data...');
        loadDownloads();
    }, 1000);

    console.log('[EXTRACTION COMPLETE] UI update complete');
}

function updateDownloadsTabExtractButton(videoId, extractionId) {
    // Find all download elements that match this video_id
    const downloadElements = document.querySelectorAll('#downloadsContainer .download-item');
    
    downloadElements.forEach(downloadElement => {
        const extractButton = downloadElement.querySelector('.extract-button');
        if (extractButton && extractButton.dataset.videoId === videoId) {
            // Update this button to show "Open Mixer" state
            extractButton.innerHTML = '<i class="fas fa-sliders-h"></i> Open Mixer';
            extractButton.className = 'item-button extract-button extracted';
            
            // Remove any existing event listeners by cloning the button
            const newButton = extractButton.cloneNode(true);
            extractButton.parentNode.replaceChild(newButton, extractButton);
            
            // Add new event listener for mixer functionality
            newButton.addEventListener('click', () => {
                // Switch to mixer tab and load this extraction
                switchToTab('mixer');
                loadExtractionInMixer(extractionId);
            });
            
            console.log(`Updated Extract Stems button to Open Mixer for video_id: ${videoId}`);
        }
    });
}

function updateExtractionError(data) {
    const extractionElement = document.getElementById(`extraction-${data.extraction_id}`);
    if (!extractionElement) return;
    
    const statusElement = extractionElement.querySelector('.item-status');
    const actionsContainer = extractionElement.querySelector('.item-actions');
    
    statusElement.textContent = 'Error';
    statusElement.className = 'item-status status-error';
    
    actionsContainer.innerHTML = `
        <div class="error-message">${data.error_message}</div>
        <div class="action-buttons">
            <button class="item-button retry-button" data-extraction-id="${data.extraction_id}">
                <i class="fas fa-redo"></i> Retry
            </button>
            <button class="item-button delete-button" data-extraction-id="${data.extraction_id}">
                <i class="fas fa-trash"></i> Delete
            </button>
        </div>
    `;
    
    // Add event listeners
    const retryButton = actionsContainer.querySelector('.retry-button');
    retryButton.addEventListener('click', () => {
        retryExtraction(retryButton.dataset.extractionId);
    });
    
    const deleteButton = actionsContainer.querySelector('.delete-button');
    deleteButton.addEventListener('click', () => {
        deleteExtraction(deleteButton.dataset.extractionId);
    });
}

// Action Functions
function cancelDownload(downloadId) {
    console.log('Cancelling download:', downloadId);
    
    // Show un indicateur visuel que l'annulation est en cours
    const downloadElement = document.getElementById(`download-${downloadId}`);
    if (downloadElement) {
        const statusElement = downloadElement.querySelector('.item-status');
        statusElement.textContent = 'Cancelling...';
        statusElement.className = 'item-status status-cancelling';
        
        const progressDetails = downloadElement.querySelector('.progress-details');
        progressDetails.textContent = 'Cancelling download...';
    }
    
    fetch(`/api/downloads/${downloadId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Cancel response:', data);
        if (data.success) {
            showToast('Download cancelled', 'info');
            // UI will be updated via WebSocket event, no need to reload
        } else {
            showToast('Error cancelling download', 'error');
            // Only reload if cancellation failed
            loadDownloads();
        }
    })
    .catch(error => {
        console.error('Error cancelling download:', error);
        showToast('Error cancelling download', 'error');
        // Only reload on error
        loadDownloads();
    });
}

function retryDownload(downloadId) {
    // Update UI immediately to show retrying state
    const downloadElement = document.getElementById(`download-${downloadId}`);
    if (downloadElement) {
        const statusElement = downloadElement.querySelector('.item-status');
        const actionsContainer = downloadElement.querySelector('.item-actions');
        
        statusElement.textContent = 'Retrying...';
        statusElement.className = 'item-status status-queued';
        
        // Show cancel button while retrying
        actionsContainer.innerHTML = `
            <button class="item-button cancel cancel-download-button" data-download-id="${downloadId}">
                <i class="fas fa-times"></i> Cancel
            </button>
        `;
        
        const cancelButton = actionsContainer.querySelector('.cancel-download-button');
        cancelButton.addEventListener('click', () => {
            cancelDownload(cancelButton.dataset.downloadId);
        });
    }
    
    fetch(`/api/downloads/${downloadId}/retry`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showToast(`Error: ${data.error}`, 'error');
            // Reload to refresh state if retry failed
            setTimeout(() => loadDownloads(), 500);
            return;
        }
        
        if (data.success) {
            showToast('Download retried', 'success');
            // Update UI to show queued state
            if (downloadElement) {
                const statusElement = downloadElement.querySelector('.item-status');
                const progressFill = downloadElement.querySelector('.progress-fill');
                const progressPercentage = downloadElement.querySelector('.progress-percentage');
                const progressDetails = downloadElement.querySelector('.progress-details');
                
                statusElement.textContent = 'Queued';
                statusElement.className = 'item-status status-queued';
                progressFill.style.width = '0%';
                progressPercentage.textContent = '0%';
                progressDetails.textContent = 'Waiting to start...';
            }
        } else {
            showToast('Error retrying download', 'error');
            setTimeout(() => loadDownloads(), 500);
        }
    })
    .catch(error => {
        console.error('Error retrying download:', error);
        showToast('Error retrying download', 'error');
        setTimeout(() => loadDownloads(), 500);
    });
}

function cancelExtraction(extractionId) {
    fetch(`/api/extractions/${encodeURIComponent(extractionId)}`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast('Extraction cancelled', 'info');
            // UI will be updated via WebSocket event, no need to reload
        } else {
            showToast('Error cancelling extraction', 'error');
            // Only reload if cancellation failed
            loadExtractions();
        }
    })
    .catch(error => {
        console.error('Error cancelling extraction:', error);
        showToast('Error cancelling extraction', 'error');
        // Only reload on error
        loadExtractions();
    });
}

function retryExtraction(extractionId) {
    // Update UI immediately to show retrying state
    const extractionElement = document.getElementById(`extraction-${extractionId}`);
    if (extractionElement) {
        const statusElement = extractionElement.querySelector('.item-status');
        const actionsContainer = extractionElement.querySelector('.item-actions');
        
        statusElement.textContent = 'Retrying...';
        statusElement.className = 'item-status status-queued';
        
        // Show cancel button while retrying
        actionsContainer.innerHTML = `
            <button class="item-button cancel cancel-extraction-button" data-extraction-id="${extractionId}">
                <i class="fas fa-times"></i> Cancel
            </button>
        `;
        
        const cancelButton = actionsContainer.querySelector('.cancel-extraction-button');
        cancelButton.addEventListener('click', () => {
            cancelExtraction(cancelButton.dataset.extractionId);
        });
    }
    
    fetch(`/api/extractions/${encodeURIComponent(extractionId)}/retry`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showToast(`Error: ${data.error}`, 'error');
            setTimeout(() => loadExtractions(), 500);
            return;
        }
        
        if (data.success) {
            showToast('Extraction retried', 'success');
            // Update UI to show queued state
            if (extractionElement) {
                const statusElement = extractionElement.querySelector('.item-status');
                const progressFill = extractionElement.querySelector('.progress-fill');
                const progressPercentage = extractionElement.querySelector('.progress-percentage');
                
                statusElement.textContent = 'Queued';
                statusElement.className = 'item-status status-queued';
                progressFill.style.width = '0%';
                progressPercentage.textContent = '0%';
            }
        } else {
            showToast('Error retrying extraction', 'error');
            // Only reload if retry failed
            loadExtractions();
        }
    })
    .catch(error => {
        console.error('Error retrying extraction:', error);
        showToast('Error retrying extraction', 'error');
        // Only reload on error
        loadExtractions();
    });
}

function deleteDownload(downloadId) {
    if (!confirm('Are you sure you want to delete this download? This will remove it from the list and the database.')) {
        return;
    }
    
    fetch(`/api/downloads/${downloadId}/delete`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showToast(`Error: ${data.error}`, 'error');
            return;
        }
        
        if (data.success) {
            showToast('Download deleted', 'success');
            loadDownloads();
        } else {
            showToast('Error deleting download', 'error');
        }
    })
    .catch(error => {
        console.error('Error deleting download:', error);
        showToast('Error deleting download', 'error');
    });
}

function deleteExtraction(extractionId) {
    if (!confirm('Are you sure you want to delete this extraction? This will remove it from the list.')) {
        return;
    }
    
    fetch(`/api/extractions/${encodeURIComponent(extractionId)}/delete`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            showToast(`Error: ${data.error}`, 'error');
            return;
        }
        
        if (data.success) {
            showToast('Extraction deleted', 'success');
            loadExtractions();
        } else {
            showToast('Error deleting extraction', 'error');
        }
    })
    .catch(error => {
        console.error('Error deleting extraction:', error);
        showToast('Error deleting extraction', 'error');
    });
}
