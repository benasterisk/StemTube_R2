// Tab state management
const TAB_STORAGE_KEY = 'stemtube_active_tab';

// Check extraction status for a video (shared function)
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

// Grant access to existing extraction (shared function)
async function grantExtractionAccess(videoId, element) {
    try {
        const originalHTML = element.innerHTML;
        element.innerHTML = '<div class="compact-item-title">Granting access...</div><div class="compact-item-status">Please wait</div>';
        
        const response = await fetch('/api/extractions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken()
            },
            body: JSON.stringify({
                video_id: videoId,
                grant_access_only: true
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to grant access');
        }
        
        const result = await response.json();
        
        // Success - show success message and switch to mixer
        showToast('Access granted! Opening mixer...', 'success');
        
        // Switch to mixer tab and load this extraction
        switchToTab('mixer');
        loadExtractionInMixer(result.extraction_id);
        
    } catch (error) {
        console.error('Error granting access:', error);
        element.innerHTML = originalHTML;
        showToast('Failed to grant access. Please try again.', 'error');
    }
}

// Switch to a specific tab and save state
function switchToTab(tabId) {
    // Update active tab button
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    const targetButton = document.querySelector(`[data-tab="${tabId}"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }
    
    // Update active tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    const targetTab = document.getElementById(`${tabId}Tab`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // Update left panel content based on active tab
    updateLeftPanelContent(tabId);
    
    // Refresh data when switching to specific tabs
    if (tabId === 'downloads') {
        loadDownloads(); // Refresh downloads list
    } else if (tabId === 'library') {
        loadLibrary(); // Load library content
    } else if (tabId === 'admin') {
        // Initialize admin section to users by default
        setTimeout(() => switchAdminSection('users'), 100);
    }
    
    // Save current tab to localStorage
    try {
        localStorage.setItem(TAB_STORAGE_KEY, tabId);
    } catch (error) {
        console.warn('Could not save tab state to localStorage:', error);
    }
}

// Restore the last active tab on page load
function restoreActiveTab() {
    try {
        const savedTab = localStorage.getItem(TAB_STORAGE_KEY);
        if (savedTab) {
            // Check if the saved tab still exists (user might not be admin anymore, etc.)
            const tabButton = document.querySelector(`[data-tab="${savedTab}"]`);
            const tabContent = document.getElementById(`${savedTab}Tab`);
            
            if (tabButton && tabContent) {
                switchToTab(savedTab);
                return;
            }
        }
    } catch (error) {
        console.warn('Could not restore tab state from localStorage:', error);
    }
    
    // Fallback: switch to first available tab (admin tab if user is admin, otherwise downloads)
    const firstTab = document.querySelector('.tab-button');
    if (firstTab) {
        switchToTab(firstTab.dataset.tab);
    } else {
        // Ultimate fallback
        switchToTab('downloads');
    }
}

// Left panel content management functions

// Update left panel content based on active tab
function updateLeftPanelContent(tabId) {
    // Hide all left panel content
    document.querySelectorAll('.left-panel-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // Show appropriate content based on tab
    switch (tabId) {
        case 'downloads':
            document.getElementById('searchContent').style.display = 'flex';
            break;
        case 'admin':
            document.getElementById('adminMenuContent').style.display = 'flex';
            break;
        case 'mixer':
            document.getElementById('extractionsContent').style.display = 'flex';
            // Load extractions list for mixer if not already loaded
            loadExtractionsForMixer();
            // Restore mixer state if needed
            restoreMixerIfNeeded();
            break;
        default:
            document.getElementById('searchContent').style.display = 'flex';
            break;
    }
}

// Load downloads data specifically for extraction panel
function loadDownloadsForExtraction() {
    fetch('/api/downloads', {
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.ok ? response.json() : Promise.reject('Failed to load downloads'))
    .then(data => updateDownloadsListForExtraction(data))
    .catch(error => {
        console.error('Error loading downloads for extraction:', error);
        const container = document.getElementById('downloadsListForExtraction');
        if (container) {
            container.innerHTML = '<div class="empty-state">Failed to load downloads</div>';
        }
    });
}

// Load extractions data specifically for mixer panel
function loadExtractionsForMixer() {
    fetch('/api/extractions', {
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.ok ? response.json() : Promise.reject('Failed to load extractions'))
    .then(data => updateExtractionsListForMixer(data))
    .catch(error => {
        console.error('Error loading extractions for mixer:', error);
        const container = document.getElementById('extractionsListForMixer');
        if (container) {
            container.innerHTML = '<div class="empty-state">Failed to load extractions</div>';
        }
    });
}

// Update downloads list for extraction (called from loadDownloads)
async function updateDownloadsListForExtraction(data) {
    const container = document.getElementById('downloadsListForExtraction');
    if (!container) return;
    
    container.innerHTML = '<div class="loading">Filtering downloads...</div>';
    
    // Filter completed downloads
    const completedDownloads = data.filter(item => item.status === 'completed');
    
    if (completedDownloads.length === 0) {
        container.innerHTML = '<div class="empty-state">No downloads available for extraction</div>';
        return;
    }
    
    // Filter downloads based on extraction status
    const actionableDownloads = [];
    
    for (const item of completedDownloads) {
        try {
            // Check extraction status for each download
            const extractionStatus = await checkExtractionStatus(item.video_id);
            
            // Include downloads that are:
            // 1. Not extracted yet (status: 'not_extracted')
            // 2. Extracted by someone else but user has no access (status: 'extracted_no_access')
            if (extractionStatus.status === 'not_extracted' || extractionStatus.status === 'extracted_no_access') {
                actionableDownloads.push({
                    ...item,
                    extractionStatus: extractionStatus
                });
            }
        } catch (error) {
            console.warn('Error checking extraction status for', item.video_id, error);
            // On error, assume not extracted and include it
            actionableDownloads.push({
                ...item,
                extractionStatus: { status: 'not_extracted' }
            });
        }
    }
    
    container.innerHTML = '';
    
    if (actionableDownloads.length === 0) {
        container.innerHTML = '<div class="empty-state">No downloads available for extraction</div>';
        return;
    }
    
    // Sort by creation time (newest first)
    actionableDownloads.sort((a, b) => {
        const timeA = isNaN(a.created_at) ? new Date(a.created_at) : new Date(parseInt(a.created_at) * 1000);
        const timeB = isNaN(b.created_at) ? new Date(b.created_at) : new Date(parseInt(b.created_at) * 1000);
        return timeB - timeA;
    });
    
    actionableDownloads.forEach(item => {
        const compactElement = createCompactDownloadElement(item);
        if (compactElement) {
            container.appendChild(compactElement);
        }
    });
}

// Update extractions list for mixer (called from loadExtractions)
function updateExtractionsListForMixer(data) {
    const container = document.getElementById('extractionsListForMixer');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Filter completed extractions
    const completedExtractions = data.filter(item => item.status === 'completed');
    
    if (completedExtractions.length === 0) {
        container.innerHTML = '<div class="empty-state">No extractions available for mixing</div>';
        return;
    }
    
    // Sort by creation time (newest first)
    completedExtractions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    completedExtractions.forEach(item => {
        const compactElement = createCompactExtractionElement(item);
        if (compactElement) {
            container.appendChild(compactElement);
        } else {
            console.warn('Failed to create compact element for extraction:', item);
        }
    });
}

// Create compact download element for extraction panel
function createCompactDownloadElement(item) {
    const itemId = item.download_id || item.id || item.video_id;
    
    const element = document.createElement('div');
    element.className = 'download-item-compact';
    element.dataset.downloadId = itemId;
    element.dataset.videoId = item.video_id;
    
    // Determine status text based on extraction status
    let statusText = 'Ready for extraction';
    let statusClass = '';
    
    if (item.extractionStatus) {
        if (item.extractionStatus.status === 'extracted_no_access') {
            statusText = 'Already extracted - click for access';
            statusClass = 'extracted-no-access';
        }
    }
    
    element.innerHTML = `
        <div class="compact-item-title" title="${item.title}">${item.title}</div>
        <div class="compact-item-status ${statusClass}">${statusText}</div>
    `;
    
    element.addEventListener('click', () => {
        // Clear selection
        document.querySelectorAll('.download-item-compact').forEach(el => {
            el.classList.remove('selected');
        });
        element.classList.add('selected');
        
        // Check extraction status to determine action
        if (item.extractionStatus && item.extractionStatus.status === 'extracted_no_access') {
            // Extracted by someone else - grant access directly
            grantExtractionAccess(item.video_id, element);
        } else {
            // Not extracted - open extraction modal
            openExtractionModal(itemId, item.title, item.file_path, item.video_id);
        }
    });
    
    return element;
}

// Function to get expected stem count based on model name
function getExpectedStemCount(modelName) {
    if (!modelName) return 4;

    const stemCounts = {
        'htdemucs': 4,
        'htdemucs_ft': 4,
        'htdemucs_6s': 6,
        'mdx_extra': 4,
        'mdx_extra_q': 4
    };

    // Handle variations in model names - normalize to lowercase and remove special chars
    const normalizedModel = modelName.toLowerCase().replace(/[^a-z0-9_]/g, '_');

    // Check for exact matches first
    if (stemCounts[normalizedModel]) {
        return stemCounts[normalizedModel];
    }

    // Check for partial matches (e.g., "HTDemucs 6-stem" -> 6)
    if (normalizedModel.includes('6s') || normalizedModel.includes('6_stem')) {
        return 6;
    }

    // Default to 4 stems for unknown models
    return 4;
}

// Create compact extraction element for mixer panel
function createCompactExtractionElement(item) {
    // Use extraction_id from API (format: download_X for historical, timestamp_X for live)
    const itemId = item.extraction_id;

    if (!itemId) {
        console.error('No extraction_id found for item:', item);
        return null;
    }

    const element = document.createElement('div');
    element.className = 'extraction-item-compact';
    element.dataset.extractionId = itemId;
    element.dataset.videoId = item.video_id;

    // Use actual stems_paths if available, otherwise get expected count from model
    const stemCount = item.stems_paths ?
        Object.keys(item.stems_paths).length :
        getExpectedStemCount(item.model_name);
    
    element.innerHTML = `
        <div class="compact-item-title" title="${item.title}">${item.title}</div>
        <div class="compact-item-status">${stemCount} stems • ${item.model_name || 'HTDemucs (4 stems)'}</div>
    `;
    
    element.addEventListener('click', () => {
        // Clear selection
        document.querySelectorAll('.extraction-item-compact').forEach(el => {
            el.classList.remove('selected');
        });
        element.classList.add('selected');
        
        // Load this extraction in the mixer
        loadExtractionInMixer(itemId);
    });
    
    return element;
}

// Load extraction in mixer
function loadExtractionInMixer(extractionId) {
    const mixerFrame = document.getElementById('mixerFrame');
    if (mixerFrame) {
        // Save the active extraction ID for persistence
        saveMixerState({ activeExtractionId: extractionId });
        
        // Update the mixer iframe src to load specific extraction
        mixerFrame.src = `/mixer?extraction_id=${encodeURIComponent(extractionId)}`;
        
        // Show loading indicator
        const loadingDiv = document.getElementById('loading');
        if (loadingDiv) {
            loadingDiv.style.display = 'block';
        }
        mixerFrame.style.display = 'none';
        
        showToast(`Loading extraction in mixer...`, 'info');
    }
}

// Mixer state persistence
const MIXER_STATE_KEY = 'stemtube_mixer_state';

// Save mixer state to localStorage
function saveMixerState(state) {
    try {
        const currentState = getMixerState();
        const newState = { ...currentState, ...state };
        localStorage.setItem(MIXER_STATE_KEY, JSON.stringify(newState));
    } catch (error) {
        console.warn('Could not save mixer state to localStorage:', error);
    }
}

// Get mixer state from localStorage
function getMixerState() {
    try {
        const state = localStorage.getItem(MIXER_STATE_KEY);
        return state ? JSON.parse(state) : {};
    } catch (error) {
        console.warn('Could not load mixer state from localStorage:', error);
        return {};
    }
}

// Clear mixer state
function clearMixerState() {
    try {
        localStorage.removeItem(MIXER_STATE_KEY);
    } catch (error) {
        console.warn('Could not clear mixer state from localStorage:', error);
    }
}

// Restore mixer on tab switch to mixer
function restoreMixerIfNeeded() {
    const mixerState = getMixerState();
    if (mixerState.activeExtractionId) {
        const mixerFrame = document.getElementById('mixerFrame');
        if (mixerFrame && !mixerFrame.src.includes('extraction_id=')) {
            // Only restore if no extraction is currently loaded
            loadExtractionInMixer(mixerState.activeExtractionId);
        }
    }
}

// Admin menu functionality
function switchAdminSection(sectionName) {
    // Update active admin menu item
    document.querySelectorAll('.admin-menu-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-admin-section="${sectionName}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }

    // Show/hide admin sections
    document.querySelectorAll('.admin-section').forEach(section => {
        section.style.display = 'none';
    });

    const targetSection = document.getElementById(`${sectionName}Section`);
    if (targetSection) {
        targetSection.style.display = 'block';

        // Load data for the specific section if needed
        if (sectionName === 'cleanup') {
            // Load cleanup data if switching to cleanup section
            if (typeof loadCleanupData === 'function') {
                loadCleanupData();
            }
        } else if (sectionName === 'users') {
            // Load admin iframe for users section
            const adminFrame = document.getElementById('adminFrame');
            if (adminFrame) {
                adminFrame.style.display = 'block';
                // Hide loading text
                const loadingDiv = adminFrame.previousElementSibling;
                if (loadingDiv && loadingDiv.classList.contains('loading')) {
                    loadingDiv.style.display = 'none';
                }
            }
        } else if (sectionName === 'logs') {
            // Load browser logging configuration
            loadBrowserLoggingConfig();
        } else if (sectionName === 'settings') {
            // Load system settings
            loadSystemSettings();
        }
    }
}

// ============================================
// System Settings Admin Functions
// ============================================

let systemSettingsInitialized = false;

async function loadSystemSettings() {
    console.log('[SystemSettings] Loading system settings...');

    // Initialize event listeners FIRST (before API call)
    if (!systemSettingsInitialized) {
        initSystemSettingsListeners();
        systemSettingsInitialized = true;
        console.log('[SystemSettings] Event listeners initialized');
    }

    try {
        const response = await fetch('/api/admin/system-settings');
        console.log('[SystemSettings] API response status:', response.status);

        const data = await response.json();
        console.log('[SystemSettings] API response data:', data);

        if (data.success) {
            const settings = data.settings;
            const systemInfo = data.system_info;

            // Update form values
            const downloadsDir = document.getElementById('adminDownloadsDirectory');
            const maxDownloads = document.getElementById('adminMaxDownloads');
            const maxExtractions = document.getElementById('adminMaxExtractions');
            const useGpu = document.getElementById('adminUseGpu');
            const lyricsModel = document.getElementById('adminLyricsModel');
            const stemModel = document.getElementById('adminStemModel');

            if (downloadsDir) downloadsDir.value = settings.downloads_directory || '';
            if (maxDownloads) maxDownloads.value = settings.max_concurrent_downloads || 3;
            if (maxExtractions) maxExtractions.value = settings.max_concurrent_extractions || 1;
            if (useGpu) useGpu.checked = settings.use_gpu_for_extraction !== false;
            if (lyricsModel) lyricsModel.value = settings.lyrics_model_size || 'medium';
            if (stemModel) stemModel.value = settings.default_stem_model || 'htdemucs';

            // Update GPU status
            updateSystemStatusCard('gpuStatusIndicator', 'gpuName',
                systemInfo.gpu_available,
                systemInfo.gpu_available ? 'Available' : 'Not Available',
                systemInfo.gpu_name || 'CPU mode');

            // Update FFmpeg status
            updateSystemStatusCard('ffmpegStatusIndicator', 'ffmpegPath',
                systemInfo.ffmpeg_available,
                systemInfo.ffmpeg_available ? 'Installed' : 'Not Found',
                systemInfo.ffmpeg_path || 'Not configured');

            console.log('[SystemSettings] Settings loaded successfully');
        } else {
            console.error('[SystemSettings] API returned error:', data.error);
            showToast(data.error || 'Error loading settings', 'error');
            // Update status to show error
            updateSystemStatusCard('gpuStatusIndicator', 'gpuName', false, 'Error', 'Could not load');
            updateSystemStatusCard('ffmpegStatusIndicator', 'ffmpegPath', false, 'Error', 'Could not load');
        }
    } catch (error) {
        console.error('[SystemSettings] Error loading system settings:', error);
        showToast('Error loading system settings', 'error');
        // Update status to show error
        updateSystemStatusCard('gpuStatusIndicator', 'gpuName', false, 'Error', 'Could not load');
        updateSystemStatusCard('ffmpegStatusIndicator', 'ffmpegPath', false, 'Error', 'Could not load');
    }
}

function updateSystemStatusCard(indicatorId, detailId, isAvailable, statusText, detailText) {
    const indicator = document.getElementById(indicatorId);
    const detail = document.getElementById(detailId);

    if (indicator) {
        const statusDot = indicator.querySelector('.status-dot');
        const statusLabel = indicator.querySelector('.status-text');
        if (statusDot) {
            statusDot.classList.toggle('available', isAvailable);
            statusDot.classList.toggle('unavailable', !isAvailable);
        }
        if (statusLabel) {
            statusLabel.textContent = statusText;
        }
    }
    if (detail) {
        detail.textContent = detailText;
    }
}

async function saveSystemSettings() {
    console.log('[SystemSettings] Saving system settings...');

    const settings = {
        downloads_directory: document.getElementById('adminDownloadsDirectory')?.value,
        max_concurrent_downloads: parseInt(document.getElementById('adminMaxDownloads')?.value) || 3,
        max_concurrent_extractions: parseInt(document.getElementById('adminMaxExtractions')?.value) || 1,
        use_gpu_for_extraction: document.getElementById('adminUseGpu')?.checked ?? true,
        lyrics_model_size: document.getElementById('adminLyricsModel')?.value || 'medium',
        default_stem_model: document.getElementById('adminStemModel')?.value || 'htdemucs'
    };

    console.log('[SystemSettings] Settings to save:', settings);

    // Show saving indicator
    const saveBtn = document.getElementById('saveSystemSettingsBtn');
    const originalText = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        saveBtn.disabled = true;
    }

    try {
        const response = await fetch('/api/admin/system-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        console.log('[SystemSettings] Save response status:', response.status);
        const data = await response.json();
        console.log('[SystemSettings] Save response data:', data);

        if (data.success) {
            showToast('System settings saved successfully', 'success');

            // Show restart warning if required
            const restartWarning = document.getElementById('restartWarning');
            if (restartWarning) {
                if (data.requires_restart) {
                    restartWarning.style.display = 'flex';
                } else {
                    restartWarning.style.display = 'none';
                }
            }
        } else {
            showToast(data.error || 'Error saving settings', 'error');
        }
    } catch (error) {
        console.error('[SystemSettings] Error saving system settings:', error);
        showToast('Error saving system settings: ' + error.message, 'error');
    } finally {
        // Restore button
        if (saveBtn) {
            saveBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Settings';
            saveBtn.disabled = false;
        }
    }
}

async function restartServer() {
    if (!confirm('Are you sure you want to restart the server? All active connections will be interrupted.')) {
        return;
    }

    console.log('[SystemSettings] Restarting server...');

    // Show restarting indicator
    const restartBtn = document.getElementById('restartServerBtn');
    if (restartBtn) {
        restartBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restarting...';
        restartBtn.disabled = true;
    }

    showToast('Restarting server...', 'info');

    try {
        const response = await fetch('/api/admin/restart-server', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log('[SystemSettings] Restart response:', data);

        if (data.success) {
            showToast('Server is restarting. Page will reload...', 'success');
            // Wait and reload
            setTimeout(() => {
                location.reload();
            }, 3000);
        } else {
            showToast(data.error || 'Error restarting server', 'error');
            if (restartBtn) {
                restartBtn.innerHTML = '<i class="fas fa-redo"></i> Restart Server';
                restartBtn.disabled = false;
            }
        }
    } catch (error) {
        console.error('[SystemSettings] Error restarting server:', error);
        // This is expected since the server is restarting
        showToast('Server is restarting. Page will reload...', 'success');
        setTimeout(() => {
            location.reload();
        }, 3000);
    }
}

function initSystemSettingsListeners() {
    console.log('[SystemSettings] Initializing event listeners...');

    const saveBtn = document.getElementById('saveSystemSettingsBtn');
    const restartBtn = document.getElementById('restartServerBtn');
    const goToAdminLink = document.getElementById('goToAdminSettingsLink');

    if (saveBtn) {
        saveBtn.addEventListener('click', saveSystemSettings);
        console.log('[SystemSettings] Save button listener attached');
    } else {
        console.warn('[SystemSettings] Save button not found');
    }

    if (restartBtn) {
        restartBtn.addEventListener('click', restartServer);
        console.log('[SystemSettings] Restart button listener attached');
    } else {
        console.warn('[SystemSettings] Restart button not found');
    }

    // Link from user settings modal to admin settings
    if (goToAdminLink) {
        goToAdminLink.addEventListener('click', (e) => {
            e.preventDefault();
            // Close settings modal
            document.getElementById('settingsModal').style.display = 'none';
            // Switch to admin tab
            const adminTabButton = document.querySelector('[data-tab="admin"]');
            if (adminTabButton) {
                adminTabButton.click();
            }
            // Switch to settings section
            setTimeout(() => {
                switchAdminSection('settings');
            }, 100);
        });
        console.log('[SystemSettings] Admin link listener attached');
    }

    // Initialize YouTube Cookies Management
    initCookiesManagement();
}

// ============================================
// YouTube Cookies Management
// ============================================

function initCookiesManagement() {
    console.log('[Cookies] Initializing cookies management...');

    const uploadBtn = document.getElementById('uploadCookiesFileBtn');
    const fileInput = document.getElementById('cookiesFileInput');
    const generateBtn = document.getElementById('generateBookmarkletBtn');
    const deleteBtn = document.getElementById('deleteCookiesBtn');

    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', uploadCookiesFile);
        console.log('[Cookies] Upload button listener attached');
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', generateBookmarklet);
        console.log('[Cookies] Generate button listener attached');
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', deleteCookies);
        console.log('[Cookies] Delete button listener attached');
    }

    // Load initial status
    loadCookiesStatus();
}

async function loadCookiesStatus() {
    const statusDiv = document.getElementById('cookies-status');
    const deleteBtn = document.getElementById('deleteCookiesBtn');

    if (!statusDiv) return;

    try {
        const response = await fetch('/api/admin/cookies/status');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();

        if (data.exists) {
            const freshIcon = data.is_fresh ? '✅' : '⚠️';
            const freshText = data.is_fresh ? 'Valid' : 'Expired (> 48h)';
            const freshClass = data.is_fresh ? 'available' : 'unavailable';
            const authIcon = data.has_auth_cookies ? '🔑' : '⚠️';
            const authText = data.has_auth_cookies
                ? `Auth cookies: ${data.auth_cookies_found.join(', ')}`
                : 'No auth cookies found - re-upload while logged into YouTube';
            const authClass = data.has_auth_cookies ? '' : 'color: #f0ad4e;';
            statusDiv.innerHTML = `
                <div class="info-card-body">
                    <div class="status-indicator">
                        <span class="status-dot ${freshClass}"></span>
                        <span class="status-text">${freshIcon} Cookies present - ${freshText}</span>
                    </div>
                    <p class="info-detail">${data.cookie_count} cookies • Modified: ${new Date(data.modified).toLocaleString()}</p>
                    <p class="info-detail" style="${authClass}">${authIcon} ${authText}</p>
                </div>
            `;
            if (deleteBtn) deleteBtn.disabled = false;
        } else {
            statusDiv.innerHTML = `
                <div class="info-card-body">
                    <div class="status-indicator">
                        <span class="status-dot unavailable"></span>
                        <span class="status-text">⚠️ No cookies configured</span>
                    </div>
                    <p class="info-detail">YouTube downloads will fail - upload cookies.txt file</p>
                </div>
            `;
            if (deleteBtn) deleteBtn.disabled = true;
        }
    } catch (error) {
        console.error('[Cookies] Error loading status:', error);
        statusDiv.innerHTML = `
            <div class="info-card-body">
                <div class="status-indicator">
                    <span class="status-dot unavailable"></span>
                    <span class="status-text">❌ Error</span>
                </div>
                <p class="info-detail">${error.message}</p>
            </div>
        `;
    }
}

async function uploadCookiesFile() {
    const fileInput = document.getElementById('cookiesFileInput');
    const uploadBtn = document.getElementById('uploadCookiesFileBtn');

    if (!fileInput || !fileInput.files.length) return;

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    const originalText = uploadBtn.innerHTML;
    uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    uploadBtn.disabled = true;

    try {
        const response = await fetch('/api/admin/cookies/upload-file', {
            method: 'POST',
            credentials: 'same-origin',
            body: formData
        });

        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errData.error || errorMsg;
            } catch (e) {
                // Response is not JSON
            }
            showToast('Upload error: ' + errorMsg, 'error');
            return;
        }

        const data = await response.json();
        if (data.success) {
            showToast(data.message, data.has_auth_cookies ? 'success' : 'warning');
            loadCookiesStatus();
        } else {
            showToast(data.message || 'Upload failed', 'error');
        }
    } catch (error) {
        console.error('[Cookies] Error uploading file:', error);
        showToast('Upload error: ' + error.message, 'error');
    } finally {
        uploadBtn.innerHTML = originalText;
        uploadBtn.disabled = false;
        fileInput.value = '';
    }
}

async function generateBookmarklet() {
    const btn = document.getElementById('generateBookmarkletBtn');
    const container = document.getElementById('bookmarklet-container');
    const link = document.getElementById('bookmarklet-link');

    if (!btn || !container || !link) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    btn.disabled = true;

    try {
        const response = await fetch('/api/admin/cookies/bookmarklet');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();

        if (data.success) {
            link.href = data.bookmarklet;
            container.style.display = 'block';
            showToast('Bookmarklet generated - drag it to your bookmarks', 'success');
        } else {
            showToast(data.error || 'Generation error', 'error');
        }
    } catch (error) {
        console.error('[Cookies] Error generating bookmarklet:', error);
        showToast('Error: ' + error.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function deleteCookies() {
    if (!confirm('Delete YouTube cookies?')) return;

    try {
        const response = await fetch('/api/admin/cookies', { method: 'DELETE' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();

        if (data.success) {
            showToast(data.message || 'Cookies deleted', 'success');
            loadCookiesStatus();
            const container = document.getElementById('bookmarklet-container');
            if (container) container.style.display = 'none';
        } else {
            showToast(data.error || 'Error', 'error');
        }
    } catch (error) {
        console.error('[Cookies] Error deleting cookies:', error);
        showToast('Error: ' + error.message, 'error');
    }
}

// ============================================
// Browser Logging Configuration Management
// ============================================

let logsConfigInitialized = false;

async function loadBrowserLoggingConfig() {
    try {
        const response = await fetch('/api/config/browser-logging');
        const config = await response.json();

        // Update form values
        const loggingEnabled = document.getElementById('loggingEnabled');
        const logLevel = document.getElementById('logLevel');
        const flushInterval = document.getElementById('flushInterval');
        const bufferSize = document.getElementById('bufferSize');

        if (loggingEnabled) loggingEnabled.checked = config.enabled;
        if (logLevel) logLevel.value = config.min_log_level;
        if (flushInterval) {
            flushInterval.value = config.flush_interval_seconds;
            document.getElementById('flushIntervalValue').textContent = config.flush_interval_seconds;
        }
        if (bufferSize) {
            bufferSize.value = config.max_buffer_size;
            document.getElementById('bufferSizeValue').textContent = config.max_buffer_size;
        }

        // Update status display
        updateLogsStatusDisplay(config.enabled, config.min_log_level);

        // Update active preset button
        updateLogsPresetButtons(config);

        // Initialize event listeners only once
        if (!logsConfigInitialized) {
            initializeLogsConfigListeners();
            logsConfigInitialized = true;
        }

    } catch (error) {
        console.error('Failed to load browser logging config:', error);
    }
}

function updateLogsStatusDisplay(enabled, level) {
    const indicator = document.getElementById('logsStatusIndicator');
    const text = document.getElementById('logsStatusText');

    if (indicator && text) {
        if (!enabled) {
            indicator.style.background = '#dc3545';
            text.textContent = 'Logs Disabled';
        } else {
            indicator.style.background = '#28a745';
            text.textContent = `Logs Enabled (${level} level)`;
        }
    }
}

function updateLogsPresetButtons(config) {
    const presetBtns = document.querySelectorAll('.logs-preset-btn');
    presetBtns.forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
    });

    let activePreset = null;

    // Determine which preset matches current config
    if (!config.enabled) {
        activePreset = 'disabled';
    } else if (config.min_log_level === 'error' && config.flush_interval_seconds >= 60) {
        activePreset = 'production';
    } else if (config.min_log_level === 'info' || config.min_log_level === 'debug') {
        activePreset = 'development';
    }

    // Highlight active preset
    if (activePreset) {
        const activeBtn = document.querySelector(`[data-preset="${activePreset}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            const color = activePreset === 'disabled' ? '#dc3545' :
                         activePreset === 'production' ? '#28a745' : '#ffc107';
            activeBtn.style.background = `${color}20`;
        }
    }
}

function initializeLogsConfigListeners() {
    // Preset button handlers
    const presetDisabledBtn = document.getElementById('presetDisabledBtn');
    const presetProductionBtn = document.getElementById('presetProductionBtn');
    const presetDevelopmentBtn = document.getElementById('presetDevelopmentBtn');

    if (presetDisabledBtn) {
        presetDisabledBtn.addEventListener('click', () => {
            applyLogsPreset('disabled');
        });
    }

    if (presetProductionBtn) {
        presetProductionBtn.addEventListener('click', () => {
            applyLogsPreset('production');
        });
    }

    if (presetDevelopmentBtn) {
        presetDevelopmentBtn.addEventListener('click', () => {
            applyLogsPreset('development');
        });
    }

    // Slider value displays
    const flushInterval = document.getElementById('flushInterval');
    const bufferSize = document.getElementById('bufferSize');

    if (flushInterval) {
        flushInterval.addEventListener('input', function() {
            document.getElementById('flushIntervalValue').textContent = this.value;
        });
    }

    if (bufferSize) {
        bufferSize.addEventListener('input', function() {
            document.getElementById('bufferSizeValue').textContent = this.value;
        });
    }

    // Form submission
    const form = document.getElementById('browserLoggingForm');
    if (form) {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            await saveBrowserLoggingConfig();
        });
    }
}

async function applyLogsPreset(preset) {
    const loggingEnabled = document.getElementById('loggingEnabled');
    const logLevel = document.getElementById('logLevel');
    const flushInterval = document.getElementById('flushInterval');
    const bufferSize = document.getElementById('bufferSize');

    switch (preset) {
        case 'disabled':
            loggingEnabled.checked = false;
            logLevel.value = 'error';
            flushInterval.value = 300;
            bufferSize.value = 50;
            break;
        case 'production':
            loggingEnabled.checked = true;
            logLevel.value = 'error';
            flushInterval.value = 60;
            bufferSize.value = 50;
            break;
        case 'development':
            loggingEnabled.checked = true;
            logLevel.value = 'info';
            flushInterval.value = 10;
            bufferSize.value = 200;
            break;
    }

    // Update display values
    document.getElementById('flushIntervalValue').textContent = flushInterval.value;
    document.getElementById('bufferSizeValue').textContent = bufferSize.value;

    // Save immediately
    await saveBrowserLoggingConfig();
}

async function saveBrowserLoggingConfig() {
    const messageDiv = document.getElementById('loggingConfigMessage');

    try {
        const config = {
            enabled: document.getElementById('loggingEnabled').checked,
            min_log_level: document.getElementById('logLevel').value,
            flush_interval_seconds: parseInt(document.getElementById('flushInterval').value),
            max_buffer_size: parseInt(document.getElementById('bufferSize').value)
        };

        const response = await fetch('/api/config/browser-logging', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
            // Update UI
            updateLogsStatusDisplay(config.enabled, config.min_log_level);
            updateLogsPresetButtons(config);

            if (messageDiv) {
                messageDiv.innerHTML = '<span style="color: #28a745;">✓ Configuration saved! Changes apply on next page load.</span>';
                messageDiv.style.display = 'block';
            }

            showToast('Logging configuration saved', 'success');
        } else {
            throw new Error(result.error || 'Failed to save configuration');
        }
    } catch (error) {
        if (messageDiv) {
            messageDiv.innerHTML = `<span style="color: #dc3545;">✗ Error: ${error.message}</span>`;
            messageDiv.style.display = 'block';
        }
        showToast('Failed to save logging configuration', 'error');
    }

    // Hide message after 5 seconds
    setTimeout(() => {
        if (messageDiv) messageDiv.style.display = 'none';
    }, 5000);
}

// Initialize left panel content on page load
document.addEventListener('DOMContentLoaded', () => {
    // Restore the last active tab or default to downloads
    restoreActiveTab();
    
    // Initialize admin menu event listeners
    document.querySelectorAll('.admin-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const sectionName = item.dataset.adminSection;
            if (sectionName) {
                switchAdminSection(sectionName);
            }
        });
    });
    
    // Initialize with users section by default for admin tab
    switchAdminSection('users');

    // Listen for song title messages from mixer iframe
    window.addEventListener('message', (event) => {
        if (event.data.type === 'mixer_song_title') {
            const mixerSongTitleDisplay = document.getElementById('mixer-song-title-display');
            if (mixerSongTitleDisplay && event.data.title) {
                mixerSongTitleDisplay.textContent = event.data.title;
                console.log('[MIXER TITLE] Updated parent window with song title:', event.data.title);
            }
        }
    });
});