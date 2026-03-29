/**
 * StemTube Web - Admin & Library Module
 * Cleanup, user management, library tab, admin panel
 * Depends on: app-core.js, app-utils.js (getCsrfToken, showToast, formatDuration)
 */

// ------------------------------------------------------------------
// CLEANUP TAB FUNCTIONALITY
// ------------------------------------------------------------------

let cleanupData = [];
let cleanupSortColumn = 'created_at';
let cleanupSortDirection = 'desc';

// Load cleanup data from API
function loadCleanupData() {
    const tableBody = document.getElementById('cleanupTableBody');
    if (!tableBody) return;
    
    // Show loading
    tableBody.innerHTML = '<tr class="loading-row"><td colspan="8"><div class="loading">Loading downloads...</div></td></tr>';
    
    fetch('/api/admin/cleanup/downloads', {
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Raw API response:', data);
        
        // Handle both direct array and wrapped object responses
        if (Array.isArray(data)) {
            cleanupData = data;
        } else if (data && Array.isArray(data.downloads)) {
            cleanupData = data.downloads;
        } else if (data && data.error) {
            throw new Error(data.error);
        } else {
            cleanupData = [];
        }
        
        console.log('Processed cleanup data:', cleanupData.length, 'items');
        renderCleanupTable();
        initializeCleanupEventListeners();
    })
    .catch(error => {
        console.error('Error loading cleanup data:', error);
        tableBody.innerHTML = '<tr class="error-row"><td colspan="8"><div class="error-message">Failed to load downloads. Check console for details.</div></td></tr>';
        showToast(`Failed to load cleanup data: ${error.message}`, 'error');
        
        // Log additional debugging info
        console.error('Cleanup API Error Details:', {
            error: error,
            message: error.message,
            stack: error.stack
        });
    });
}

// Render the cleanup table
function renderCleanupTable() {
    const tableBody = document.getElementById('cleanupTableBody');
    if (!tableBody) return;
    
    // Ensure cleanupData is a valid array
    if (!Array.isArray(cleanupData)) {
        console.error('cleanupData is not an array:', cleanupData);
        tableBody.innerHTML = '<tr class="error-row"><td colspan="8"><div class="error-message">Invalid data format</div></td></tr>';
        return;
    }
    
    // Sort data
    const sortedData = [...cleanupData].sort((a, b) => {
        let aVal = a[cleanupSortColumn];
        let bVal = b[cleanupSortColumn];
        
        // Handle different data types
        if (cleanupSortColumn === 'file_size') {
            aVal = parseInt(aVal) || 0;
            bVal = parseInt(bVal) || 0;
        } else if (cleanupSortColumn === 'created_at') {
            aVal = new Date(aVal);
            bVal = new Date(bVal);
        } else if (cleanupSortColumn === 'users') {
            aVal = parseInt(aVal) || 0;
            bVal = parseInt(bVal) || 0;
        } else {
            aVal = String(aVal || '').toLowerCase();
            bVal = String(bVal || '').toLowerCase();
        }
        
        if (cleanupSortDirection === 'asc') {
            return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        } else {
            return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        }
    });
    
    if (sortedData.length === 0) {
        tableBody.innerHTML = '<tr class="empty-row"><td colspan="8"><div class="empty-state">No downloads found</div></td></tr>';
        return;
    }
    
    tableBody.innerHTML = '';
    
    sortedData.forEach(item => {
        const row = createCleanupTableRow(item);
        tableBody.appendChild(row);
    });
    
    updateTableSortHeaders();
}

// Create a table row for cleanup data
function createCleanupTableRow(item) {
    const row = document.createElement('tr');
    row.dataset.downloadId = item.global_id;
    
    // Add selection class if checked
    if (document.querySelector(`#cleanup-checkbox-${item.global_id}`)?.checked) {
        row.classList.add('selected');
    }
    
    const extractedStatus = item.extracted ? 
        `<span class="status-badge extracted">✓ Extracted</span>` : 
        `<span class="status-badge not-extracted">⊘ Not Extracted</span>`;
    
    const fileSize = item.file_size ? formatFileSize(item.file_size) : 'N/A';
    const createdAt = item.created_at ? new Date(item.created_at).toLocaleDateString() : 'N/A';
    const userCount = item.user_count || 0;
    
    row.innerHTML = `
        <td class="checkbox-column">
            <input type="checkbox" id="cleanup-checkbox-${item.global_id}" value="${item.global_id}">
        </td>
        <td class="video-id-column">
            <span class="video-id" title="${item.video_id}">${item.video_id}</span>
        </td>
        <td class="title-column">
            <span class="title" title="${item.title || 'N/A'}">${truncateText(item.title || 'N/A', 50)}</span>
        </td>
        <td class="users-column">${userCount}</td>
        <td class="size-column">${fileSize}</td>
        <td class="extracted-column">${extractedStatus}</td>
        <td class="date-column">${createdAt}</td>
        <td class="actions-column">
            <button class="row-action primary" onclick="reloadDownload('${item.video_id}')" title="Reload from YouTube">
                <i class="fas fa-sync-alt"></i>
            </button>
            <button class="row-action danger" onclick="deleteDownload('${item.video_id}')" title="Delete Download">
                <i class="fas fa-trash"></i>
            </button>
            ${item.extracted ? `
                <button class="row-action warning" onclick="resetExtraction('${item.video_id}')" title="Reset Extraction">
                    <i class="fas fa-undo"></i>
                </button>
            ` : ''}
        </td>
    `;
    
    return row;
}

// Initialize cleanup event listeners
function initializeCleanupEventListeners() {
    // Bulk selection
    const selectAllCheckbox = document.getElementById('selectAllDownloads');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', handleSelectAll);
    }
    
    const headerSelectAll = document.getElementById('headerSelectAll');
    if (headerSelectAll) {
        headerSelectAll.addEventListener('change', handleSelectAll);
    }
    
    // Individual checkboxes
    document.querySelectorAll('#cleanupTableBody input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', handleRowSelection);
    });
    
    // Bulk action buttons
    const bulkDeleteButton = document.getElementById('bulkDeleteButton');
    if (bulkDeleteButton) {
        bulkDeleteButton.addEventListener('click', handleBulkDelete);
    }
    
    const bulkResetButton = document.getElementById('bulkResetExtractionsButton');
    if (bulkResetButton) {
        bulkResetButton.addEventListener('click', handleBulkReset);
    }

    const bulkDetectIntroButton = document.getElementById('bulkDetectIntroButton');
    if (bulkDetectIntroButton) {
        bulkDetectIntroButton.addEventListener('click', handleBulkDetectIntro);
    }

    const refreshButton = document.getElementById('refreshCleanupButton');
    if (refreshButton) {
        refreshButton.addEventListener('click', loadCleanupData);
    }
    
    // Table sorting
    document.querySelectorAll('.cleanup-table th.sortable').forEach(header => {
        header.addEventListener('click', handleTableSort);
    });
    
    // Update button states
    updateBulkButtonStates();
}

// Handle select all checkbox
function handleSelectAll(event) {
    const isChecked = event.target.checked;
    
    // Update all row checkboxes
    document.querySelectorAll('#cleanupTableBody input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = isChecked;
        const row = checkbox.closest('tr');
        if (row) {
            row.classList.toggle('selected', isChecked);
        }
    });
    
    // Sync both select all checkboxes
    const selectAllMain = document.getElementById('selectAllDownloads');
    const selectAllHeader = document.getElementById('headerSelectAll');
    if (selectAllMain && selectAllHeader) {
        selectAllMain.checked = isChecked;
        selectAllHeader.checked = isChecked;
    }
    
    updateBulkButtonStates();
}

// Handle individual row selection
function handleRowSelection(event) {
    const checkbox = event.target;
    const row = checkbox.closest('tr');
    
    if (row) {
        row.classList.toggle('selected', checkbox.checked);
    }
    
    // Update select all checkbox states
    const allCheckboxes = document.querySelectorAll('#cleanupTableBody input[type="checkbox"]');
    const checkedCount = document.querySelectorAll('#cleanupTableBody input[type="checkbox"]:checked').length;
    const allSelected = checkedCount === allCheckboxes.length && allCheckboxes.length > 0;
    
    const selectAllMain = document.getElementById('selectAllDownloads');
    const selectAllHeader = document.getElementById('headerSelectAll');
    if (selectAllMain && selectAllHeader) {
        selectAllMain.checked = allSelected;
        selectAllHeader.checked = allSelected;
    }
    
    updateBulkButtonStates();
}

// Update bulk button enabled/disabled states
function updateBulkButtonStates() {
    const selectedCheckboxes = document.querySelectorAll('#cleanupTableBody input[type="checkbox"]:checked');
    const hasSelection = selectedCheckboxes.length > 0;
    
    const bulkDeleteButton = document.getElementById('bulkDeleteButton');
    const bulkResetButton = document.getElementById('bulkResetExtractionsButton');
    const bulkDetectIntroBtn = document.getElementById('bulkDetectIntroButton');

    if (bulkDeleteButton) {
        bulkDeleteButton.disabled = !hasSelection;
    }

    if (bulkResetButton) {
        bulkResetButton.disabled = !hasSelection;
    }

    if (bulkDetectIntroBtn) {
        bulkDetectIntroBtn.disabled = !hasSelection;
    }
}

// Handle table sorting
function handleTableSort(event) {
    const header = event.target;
    const newSortColumn = header.dataset.sort;
    
    if (cleanupSortColumn === newSortColumn) {
        // Toggle direction if same column
        cleanupSortDirection = cleanupSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        // New column, default to desc for most fields
        cleanupSortColumn = newSortColumn;
        cleanupSortDirection = newSortColumn === 'title' ? 'asc' : 'desc';
    }
    
    renderCleanupTable();
}

// Update table sort headers
function updateTableSortHeaders() {
    document.querySelectorAll('.cleanup-table th.sortable').forEach(header => {
        header.classList.remove('sorted-asc', 'sorted-desc');
        if (header.dataset.sort === cleanupSortColumn) {
            header.classList.add(`sorted-${cleanupSortDirection}`);
        }
    });
}

// Handle bulk delete
function handleBulkDelete() {
    const selectedIds = Array.from(document.querySelectorAll('#cleanupTableBody input[type="checkbox"]:checked'))
        .map(cb => parseInt(cb.value));
    
    if (selectedIds.length === 0) {
        showToast('No downloads selected', 'warning');
        return;
    }
    
    if (!confirm(`Are you sure you want to permanently delete ${selectedIds.length} download(s)? This will remove all files and cannot be undone.`)) {
        return;
    }
    
    performBulkOperation('/api/admin/cleanup/downloads/bulk-delete', selectedIds, 'Deleting');
}

// Handle bulk reset
function handleBulkReset() {
    const selectedIds = Array.from(document.querySelectorAll('#cleanupTableBody input[type="checkbox"]:checked'))
        .map(cb => parseInt(cb.value));
    
    if (selectedIds.length === 0) {
        showToast('No downloads selected', 'warning');
        return;
    }
    
    if (!confirm(`Are you sure you want to reset extraction status for ${selectedIds.length} download(s)? This will remove stems files but keep the original downloads.`)) {
        return;
    }
    
    performBulkOperation('/api/admin/cleanup/downloads/bulk-reset', selectedIds, 'Resetting');
}

// Handle bulk detect intro
function handleBulkDetectIntro() {
    const selectedIds = Array.from(document.querySelectorAll('#cleanupTableBody input[type="checkbox"]:checked'))
        .map(cb => parseInt(cb.value));

    if (selectedIds.length === 0) {
        showToast('No downloads selected', 'warning');
        return;
    }

    if (!confirm(`Run intro detection on ${selectedIds.length} download(s)? This may take a moment per track.`)) {
        return;
    }

    performBulkOperation('/api/admin/cleanup/downloads/bulk-detect-intro', selectedIds, 'Detecting intros');
}

// Perform bulk operation with progress tracking
function performBulkOperation(endpoint, downloadIds, operationName) {
    const progressDiv = document.getElementById('bulkProgress');
    const progressText = document.getElementById('bulkProgressText');
    const progressFill = document.getElementById('bulkProgressFill');
    
    // Show progress
    if (progressDiv) {
        progressDiv.style.display = 'block';
        progressText.textContent = `${operationName} ${downloadIds.length} item(s)...`;
        progressFill.style.width = '0%';
    }

    // Animate progress gradually during the request (~10s per item estimate)
    let progressPercent = 0;
    const estimatedMs = downloadIds.length * 10000;
    const progressInterval = setInterval(() => {
        // Ease toward 90% (never reach 100% until done)
        progressPercent += (90 - progressPercent) * 0.05;
        if (progressFill) {
            progressFill.style.width = Math.min(progressPercent, 90) + '%';
        }
    }, 500);

    // Disable buttons during operation
    document.getElementById('bulkDeleteButton').disabled = true;
    document.getElementById('bulkResetExtractionsButton').disabled = true;
    if (document.getElementById('bulkDetectIntroButton')) document.getElementById('bulkDetectIntroButton').disabled = true;
    document.getElementById('refreshCleanupButton').disabled = true;

    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({ download_ids: downloadIds })
    })
    .then(response => response.json())
    .then(data => {
        clearInterval(progressInterval);
        if (data.success) {
            const successCount = data.deleted_count || data.reset_count || data.detected_count || 0;
            const totalSize = data.total_size_freed || 0;

            let message = `${operationName} completed: ${successCount}/${data.total_count} items processed`;
            if (totalSize > 0) {
                message += `, ${formatFileSize(totalSize)} freed`;
            }

            showToast(message, 'success');

            // Animate progress to 100%
            if (progressFill) {
                progressFill.style.width = '100%';
            }

            // Reload data after a short delay
            setTimeout(() => {
                loadCleanupData(); // Refresh admin table
                if (typeof loadDownloads === 'function') loadDownloads(); // Refresh My Library
                if (typeof loadGlobalLibrary === 'function') loadGlobalLibrary(); // Refresh Global Library
                if (progressDiv) {
                    progressDiv.style.display = 'none';
                }
            }, 1500);
        } else {
            throw new Error(data.error || 'Operation failed');
        }
    })
    .catch(error => {
        clearInterval(progressInterval);
        console.error(`Error in bulk ${operationName.toLowerCase()}:`, error);
        showToast(`Error: ${error.message}`, 'error');
        
        if (progressDiv) {
            progressDiv.style.display = 'none';
        }
        
        // Re-enable buttons
        document.getElementById('bulkDeleteButton').disabled = false;
        document.getElementById('bulkResetExtractionsButton').disabled = false;
        if (document.getElementById('bulkDetectIntroButton')) document.getElementById('bulkDetectIntroButton').disabled = false;
        document.getElementById('refreshCleanupButton').disabled = false;
        
        updateBulkButtonStates();
    });
}

// Delete single download
function deleteDownload(videoId) {
    if (!confirm('Are you sure you want to permanently delete this download? This cannot be undone.')) {
        return;
    }
    
    fetch(`/api/admin/cleanup/downloads/${encodeURIComponent(videoId)}`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast('Download deleted successfully', 'success');
            loadCleanupData(); // Refresh admin table
            if (typeof loadDownloads === 'function') loadDownloads(); // Refresh My Library
            if (typeof loadGlobalLibrary === 'function') loadGlobalLibrary(); // Refresh Global Library
        } else {
            throw new Error(data.error || 'Delete failed');
        }
    })
    .catch(error => {
        console.error('Error deleting download:', error);
        showToast(`Error: ${error.message}`, 'error');
    });
}

// Reset single extraction
function resetExtraction(videoId) {
    if (!confirm('Are you sure you want to reset the extraction status? This will remove stems files but keep the download.')) {
        return;
    }
    
    fetch(`/api/admin/cleanup/downloads/${encodeURIComponent(videoId)}/reset-extraction`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast('Extraction status reset successfully', 'success');
            loadCleanupData(); // Refresh admin table
        } else {
            throw new Error(data.error || 'Reset failed');
        }
    })
    .catch(error => {
        console.error('Error resetting extraction:', error);
        showToast(`Error: ${error.message}`, 'error');
    });
}

function reloadDownload(videoId) {
    if (!confirm('Reload this video from YouTube? Existing files will be removed and the download will restart.')) {
        return;
    }

    fetch(`/api/admin/cleanup/downloads/${encodeURIComponent(videoId)}/reload`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const reassigned = data.reassigned_users || 0;
            let message = data.message || 'Reload started';
            if (reassigned > 0) {
                message += ` (restoring ${reassigned} user${reassigned > 1 ? 's' : ''})`;
            }
            showToast(message, 'success');
            loadCleanupData();
        } else {
            throw new Error(data.error || 'Reload failed');
        }
    })
    .catch(error => {
        console.error('Error reloading download:', error);
        showToast(`Error: ${error.message}`, 'error');
    });
}

// Utility function to truncate text
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// ============ USER VIEW MANAGEMENT FUNCTIONS ============

// Remove download from user's personal list
function removeDownloadFromList(videoId) {
    if (!confirm('Remove from YOUR library only. Global Library not affected.\n\nProceed?')) {
        return;
    }
    
    console.log('🚀 [DEBUG] Calling API with video_id:', videoId);
    fetch(`/api/user/downloads/${videoId}/remove-from-list`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => {
        console.log('Response status:', response.status);
        return response.text();
    })
    .then(data => {
        console.log('Raw response:', data);
        return JSON.parse(data);
    })
    .then(data => {
        if (data.success) {
            showToast(data.message, 'success');
            // Always refresh downloads list from database - this is the reliable approach
            loadDownloads();
            // Update management controls visibility
            updateUserManagementControls();
        } else {
            throw new Error(data.error || 'Remove failed');
        }
    })
    .catch(error => {
        console.error('Error removing download from list:', error);
        showToast(`Error: ${error.message}`, 'error');
    });
}

// Remove extraction from user's personal list
function removeExtractionFromList(videoId) {
    if (!confirm('Remove from YOUR library only. Global Library not affected.\n\nProceed?')) {
        return;
    }
    
    console.log('🚀 [DEBUG] Calling extraction API with video_id:', videoId);
    fetch(`/api/user/extractions/${videoId}/remove-from-list`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(data.message, 'success');
            // Always refresh extractions list from database - this is the reliable approach
            loadExtractions();
            // Update management controls visibility
            updateUserManagementControls();
        } else {
            throw new Error(data.error || 'Remove failed');
        }
    })
    .catch(error => {
        console.error('Error removing extraction from list:', error);
        showToast(`Error: ${error.message}`, 'error');
    });
}

// Bulk remove downloads from user's list
function bulkRemoveDownloads() {
    const selectedCheckboxes = document.querySelectorAll('#downloadsContainer .user-item-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
        showToast('No downloads selected', 'warning');
        return;
    }
    
    const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.value);
    
    if (!confirm(`Remove ${selectedIds.length} download(s) from your list? This will not delete the actual files.`)) {
        return;
    }
    
    fetch('/api/user/downloads/bulk-remove-from-list', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({
            download_ids: selectedIds
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(`Removed ${data.removed_count} download(s) from your list`, 'success');
            // Remove elements from DOM
            selectedCheckboxes.forEach(checkbox => {
                const downloadElement = checkbox.closest('.download-item');
                if (downloadElement) {
                    downloadElement.remove();
                }
            });
            // Update management controls
            updateUserManagementControls();
        } else {
            throw new Error(data.error || 'Bulk remove failed');
        }
    })
    .catch(error => {
        console.error('Error bulk removing downloads:', error);
        showToast(`Error: ${error.message}`, 'error');
    });
}

// Bulk remove extractions from user's list
function bulkRemoveExtractions() {
    const selectedCheckboxes = document.querySelectorAll('#extractionsContainer .user-item-checkbox:checked');
    if (selectedCheckboxes.length === 0) {
        showToast('No extractions selected', 'warning');
        return;
    }
    
    const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.value);
    
    if (!confirm(`Remove ${selectedIds.length} extraction(s) from your list? This will not delete the actual stems.`)) {
        return;
    }
    
    fetch('/api/user/extractions/bulk-remove-from-list', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': getCsrfToken()
        },
        body: JSON.stringify({
            download_ids: selectedIds
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(`Removed ${data.removed_count} extraction(s) from your list`, 'success');
            // Remove elements from DOM
            selectedCheckboxes.forEach(checkbox => {
                const extractionElement = checkbox.closest('.extraction-item');
                if (extractionElement) {
                    extractionElement.remove();
                }
            });
            // Update management controls
            updateUserManagementControls();
        } else {
            throw new Error(data.error || 'Bulk remove failed');
        }
    })
    .catch(error => {
        console.error('Error bulk removing extractions:', error);
        showToast(`Error: ${error.message}`, 'error');
    });
}

// Update visibility and state of user management controls
function updateUserManagementControls() {
    // Update downloads management controls (now unified with extractions in My Library)
    const downloadsContainer = document.getElementById('downloadsContainer');
    const downloadsManagementControls = document.getElementById('downloadsManagementControls');

    if (downloadsContainer) {
        const downloadItems = downloadsContainer.querySelectorAll('.download-item');

        if (downloadsManagementControls) {
            if (downloadItems.length > 0) {
                downloadsManagementControls.style.display = 'block';
            } else {
                downloadsManagementControls.style.display = 'none';
            }
        }
    }

    // Update bulk action button states
    updateBulkActionButtons();
}

// Update bulk action button states based on selection
function updateBulkActionButtons() {
    // Downloads bulk button (now unified with extractions in My Library)
    const selectedDownloads = document.querySelectorAll('#downloadsContainer .user-item-checkbox:checked');
    const bulkRemoveDownloadsButton = document.getElementById('bulkRemoveDownloadsButton');
    const selectAllUserDownloads = document.getElementById('selectAllUserDownloads');

    if (bulkRemoveDownloadsButton) {
        bulkRemoveDownloadsButton.disabled = selectedDownloads.length === 0;
    }

    // Update select all checkbox state for downloads
    if (selectAllUserDownloads) {
        const totalDownloads = document.querySelectorAll('#downloadsContainer .user-item-checkbox');
        if (totalDownloads.length === 0) {
            selectAllUserDownloads.indeterminate = false;
            selectAllUserDownloads.checked = false;
        } else if (selectedDownloads.length === totalDownloads.length) {
            selectAllUserDownloads.indeterminate = false;
            selectAllUserDownloads.checked = true;
        } else if (selectedDownloads.length > 0) {
            selectAllUserDownloads.indeterminate = true;
        } else {
            selectAllUserDownloads.indeterminate = false;
            selectAllUserDownloads.checked = false;
        }
    }
}

// Initialize user management functionality
function initializeUserManagement() {
    // Setup select all checkbox for downloads (now unified with extractions in My Library)
    const selectAllUserDownloads = document.getElementById('selectAllUserDownloads');
    if (selectAllUserDownloads) {
        selectAllUserDownloads.addEventListener('change', function() {
            const checkboxes = document.querySelectorAll('#downloadsContainer .user-item-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = this.checked;
            });
            updateBulkActionButtons();
        });
    }

    // Setup bulk action button for downloads
    const bulkRemoveDownloadsButton = document.getElementById('bulkRemoveDownloadsButton');
    if (bulkRemoveDownloadsButton) {
        bulkRemoveDownloadsButton.addEventListener('click', bulkRemoveDownloads);
    }

    // Setup event delegation for individual checkboxes
    document.addEventListener('change', function(event) {
        if (event.target.classList.contains('user-item-checkbox')) {
            updateBulkActionButtons();
        }
    });
}

// Call initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUserManagement);
} else {
    initializeUserManagement();
}

// ============ LIBRARY TAB FUNCTIONS ============

let globalView = 'tracks';
let currentLibraryFilter = 'all';
let currentLibrarySearch = '';

// Escape HTML helper
function _escGlobal(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// Main dispatcher for global library views
function loadGlobalLibrary() {
    switch (globalView) {
        case 'tracks': loadLibrary(currentLibraryFilter, currentLibrarySearch); break;
        case 'artists': loadGlobalArtists(); break;
        case 'albums': loadGlobalAlbums(); break;
        case 'stems': loadGlobalStems(); break;
        default: loadLibrary(currentLibraryFilter, currentLibrarySearch); break;
    }
}

// Load library content (tracks view - existing behavior)
function loadLibrary(filter = currentLibraryFilter, search = currentLibrarySearch) {
    const libraryContainer = document.getElementById('libraryContainer');
    if (!libraryContainer) return;

    // Show loading state
    libraryContainer.innerHTML = '<div class="library-loading"><i class="fas fa-spinner fa-spin"></i> Loading library...</div>';

    // Update current filter and search
    currentLibraryFilter = filter;
    currentLibrarySearch = search;

    // Build query parameters
    const params = new URLSearchParams();
    if (filter !== 'all') params.append('filter', filter);
    if (search.trim()) params.append('search', search.trim());

    fetch(`/api/library?${params.toString()}`, {
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            displayLibraryItems(data.items);
            updateLibraryStats(data.total_count, data.filter, data.search);
        } else {
            libraryContainer.innerHTML = `<div class="library-loading">Error: ${data.error}</div>`;
            showToast(`Error loading library: ${data.error}`, 'error');
        }
    })
    .catch(error => {
        console.error('Error loading library:', error);
        libraryContainer.innerHTML = '<div class="library-loading">Error loading library</div>';
        showToast('Error loading library', 'error');
    });
}

// ── Global Artists View ────────────────────────────────────────
async function loadGlobalArtists() {
    const container = document.getElementById('libraryContainer');
    if (!container) return;
    container.innerHTML = '<div class="library-loading"><i class="fas fa-spinner fa-spin"></i> Loading artists...</div>';

    try {
        const res = await fetch('/api/library/global/artists', { headers: { 'X-CSRF-Token': getCsrfToken() } });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const artists = data.artists || [];
        if (artists.length === 0) {
            container.innerHTML = '<div class="library-loading">No artists found</div>';
            updateLibraryStats(0, '', '');
            return;
        }

        container.innerHTML = '<div class="library-artist-grid"></div>';
        const grid = container.querySelector('.library-artist-grid');

        for (const artist of artists) {
            const card = document.createElement('div');
            card.className = 'library-artist-card';
            card.innerHTML = `
                <img src="${artist.thumbnail || '/static/img/default-thumb.svg'}" class="library-artist-thumb" alt="" style="border-radius:50%;">
                <div class="library-artist-info">
                    <div class="library-artist-name">${_escGlobal(artist.artist)}</div>
                    <div class="library-artist-count">${artist.song_count} track${artist.song_count !== 1 ? 's' : ''}</div>
                </div>
            `;
            card.addEventListener('click', () => drillDownGlobalArtist(artist.artist));
            grid.appendChild(card);
        }

        updateLibraryStats(artists.length, '', '');
    } catch (e) {
        console.error('loadGlobalArtists error:', e);
        container.innerHTML = '<div class="library-loading">Failed to load artists</div>';
    }
}

async function drillDownGlobalArtist(artistName) {
    const container = document.getElementById('libraryContainer');
    if (!container) return;
    container.innerHTML = '<div class="library-loading"><i class="fas fa-spinner fa-spin"></i> Loading tracks...</div>';

    try {
        const res = await fetch(`/api/library/global/artists/${encodeURIComponent(artistName)}/tracks`, { headers: { 'X-CSRF-Token': getCsrfToken() } });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const items = data.items || [];

        let html = `<div class="library-drilldown">
            <div class="library-drilldown-header">
                <button class="btn btn-small library-back-btn"><i class="fas fa-arrow-left"></i> Back</button>
                <h3>${_escGlobal(artistName)}</h3>
                <span>${items.length} tracks</span>
            </div>
            <div class="library-drilldown-items"></div>
        </div>`;

        container.innerHTML = html;

        const itemsContainer = container.querySelector('.library-drilldown-items');
        for (const item of items) {
            itemsContainer.appendChild(createLibraryItem(item));
        }

        container.querySelector('.library-back-btn').addEventListener('click', () => loadGlobalArtists());
    } catch (e) {
        console.error('drillDownGlobalArtist error:', e);
        container.innerHTML = '<div class="library-loading">Failed to load artist tracks</div>';
    }
}

// ── Global Albums View ─────────────────────────────────────────
async function loadGlobalAlbums() {
    const container = document.getElementById('libraryContainer');
    if (!container) return;
    container.innerHTML = '<div class="library-loading"><i class="fas fa-spinner fa-spin"></i> Loading albums...</div>';

    try {
        const res = await fetch('/api/albums/global', { headers: { 'X-CSRF-Token': getCsrfToken() } });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const albums = data.albums || [];

        // Also count global singles
        let singlesCount = 0;
        try {
            const singlesRes = await fetch('/api/library/global/albums/singles', { headers: { 'X-CSRF-Token': getCsrfToken() } });
            const singlesData = await singlesRes.json();
            if (singlesData.success) singlesCount = (singlesData.items || []).length;
        } catch (_) {}

        if (albums.length === 0 && singlesCount === 0) {
            container.innerHTML = '<div class="library-loading">No albums found</div>';
            updateLibraryStats(0, '', '');
            return;
        }

        container.innerHTML = '<div class="library-artist-grid"></div>';
        const grid = container.querySelector('.library-artist-grid');

        for (const album of albums) {
            const card = document.createElement('div');
            card.className = 'library-artist-card';
            card.innerHTML = `
                <img src="${album.thumbnail_url || '/static/img/default-thumb.svg'}" class="library-artist-thumb" alt="">
                <div class="library-artist-info">
                    <div class="library-artist-name">${_escGlobal(album.name)}</div>
                    <div class="library-artist-count">${_escGlobal(album.artist || '')}</div>
                    <div class="library-artist-count">${album.track_count} track${album.track_count !== 1 ? 's' : ''}</div>
                </div>
            `;
            card.addEventListener('click', () => drillDownGlobalAlbum(album.id, album.name));
            grid.appendChild(card);
        }

        // Singles group
        if (singlesCount > 0) {
            const card = document.createElement('div');
            card.className = 'library-artist-card';
            card.innerHTML = `
                <div class="library-artist-thumb" style="display:flex;align-items:center;justify-content:center;background:var(--bg-secondary);font-size:24px;"><i class="fas fa-music"></i></div>
                <div class="library-artist-info">
                    <div class="library-artist-name">(Singles)</div>
                    <div class="library-artist-count">${singlesCount} track${singlesCount !== 1 ? 's' : ''}</div>
                </div>
            `;
            card.addEventListener('click', () => drillDownGlobalAlbum(null, '(Singles)'));
            grid.appendChild(card);
        }

        updateLibraryStats(albums.length + (singlesCount > 0 ? 1 : 0), '', '');
    } catch (e) {
        console.error('loadGlobalAlbums error:', e);
        container.innerHTML = '<div class="library-loading">Failed to load albums</div>';
    }
}

async function drillDownGlobalAlbum(albumId, albumName) {
    const container = document.getElementById('libraryContainer');
    if (!container) return;
    container.innerHTML = '<div class="library-loading"><i class="fas fa-spinner fa-spin"></i> Loading tracks...</div>';

    try {
        const url = albumId !== null
            ? `/api/albums/${albumId}/tracks?scope=global`
            : '/api/library/global/albums/singles';
        const res = await fetch(url, { headers: { 'X-CSRF-Token': getCsrfToken() } });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const items = data.tracks || data.items || [];

        let html = `<div class="library-drilldown">
            <div class="library-drilldown-header">
                <button class="btn btn-small library-back-btn"><i class="fas fa-arrow-left"></i> Back</button>
                <h3>${_escGlobal(albumName)}</h3>
                <span>${items.length} tracks</span>
            </div>
            <div class="library-drilldown-items"></div>
        </div>`;

        container.innerHTML = html;

        const itemsContainer = container.querySelector('.library-drilldown-items');
        for (const item of items) {
            // Album track API may return slightly different shape - normalize
            const libItem = {
                id: item.id,
                video_id: item.video_id,
                title: item.title,
                thumbnail_url: item.thumbnail_url || item.thumbnail,
                media_type: item.media_type,
                created_at: item.created_at,
                user_count: item.user_count || 0,
                file_path: item.file_path,
                file_size: item.file_size,
                has_download: !!item.file_path,
                has_extraction: !!item.extracted,
                can_add_download: item.can_add_download !== undefined ? item.can_add_download : !!item.file_path,
                can_add_extraction: item.can_add_extraction !== undefined ? item.can_add_extraction : !!item.extracted,
                user_has_download_access: item.user_has_download_access || false,
                user_has_extraction_access: item.user_has_extraction_access || false,
                badge_type: item.badge_type || (item.extracted ? 'extraction' : 'download'),
            };
            itemsContainer.appendChild(createLibraryItem(libItem));
        }

        container.querySelector('.library-back-btn').addEventListener('click', () => loadGlobalAlbums());
    } catch (e) {
        console.error('drillDownGlobalAlbum error:', e);
        container.innerHTML = '<div class="library-loading">Failed to load album tracks</div>';
    }
}

// ── Global Stems View ──────────────────────────────────────────
async function loadGlobalStems() {
    const container = document.getElementById('libraryContainer');
    if (!container) return;
    container.innerHTML = '<div class="library-loading"><i class="fas fa-spinner fa-spin"></i> Loading stems...</div>';

    try {
        const params = new URLSearchParams();
        const search = currentLibrarySearch;
        if (search && search.trim()) params.append('search', search.trim());

        const res = await fetch(`/api/library/global/stems?${params.toString()}`, { headers: { 'X-CSRF-Token': getCsrfToken() } });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        const items = data.items || [];
        displayLibraryItems(items);
        updateLibraryStats(data.total_count || items.length, 'extractions', search);
    } catch (e) {
        console.error('loadGlobalStems error:', e);
        container.innerHTML = '<div class="library-loading">Failed to load stems</div>';
    }
}

// Display library items (with sort) - used by tracks and stems views
function displayLibraryItems(items) {
    const libraryContainer = document.getElementById('libraryContainer');

    if (items.length === 0) {
        libraryContainer.innerHTML = '<div class="library-loading">No items found in library</div>';
        return;
    }

    // Apply sort if sort select exists
    const sortKey = document.getElementById('globalLibrarySort')?.value || 'date-desc';
    if (typeof _sortItems === 'function') {
        items = _sortItems(items, sortKey);
    }

    libraryContainer.innerHTML = '';

    items.forEach(item => {
        const libraryItem = createLibraryItem(item);
        libraryContainer.appendChild(libraryItem);
    });
}

// Create library item element
function createLibraryItem(item) {
    const itemElement = document.createElement('div');
    itemElement.className = 'library-item';
    itemElement.id = `library-item-${item.id}`;

    // Debug: Log thumbnail data
    console.log('[LIBRARY ITEM] Creating item:', {
        id: item.id,
        title: item.title,
        thumbnail_url: item.thumbnail_url,
        hasThumbnail: !!item.thumbnail_url
    });

    // Format file size
    const fileSize = item.file_size ? formatFileSize(item.file_size) : 'Unknown';

    // Format creation date
    const createdDate = new Date(item.created_at).toLocaleDateString();

    // Determine badge class and text
    let badgeClass = item.badge_type;
    let badgeText = item.badge_type === 'both' ? 'Download & Extract' :
                   item.badge_type === 'download' ? 'Download' : 'Extract';
    
    itemElement.innerHTML = `
        <div class="library-item-header">
            <div class="library-item-thumbnail">
                ${item.thumbnail_url && item.thumbnail_url.trim() !== '' ? `
                    <img src="${item.thumbnail_url}" alt="${item.title}" onerror="this.onerror=null; this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect fill=%22%23333%22 width=%22100%22 height=%22100%22/%3E%3Ctext x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-size=%2240%22 fill=%22%23666%22%3E%E2%99%AA%3C/text%3E%3C/svg%3E';">
                ` : `
                    <div class="library-item-thumbnail-placeholder">
                        <i class="fas fa-music"></i>
                    </div>
                `}
            </div>
            <div class="library-item-info">
                <div class="library-item-title">${item.title}</div>
                <div class="library-item-meta">
                    <span>Video ID: ${item.video_id}</span>
                    <span>Users: ${item.user_count}</span>
                    <span>Size: ${fileSize}</span>
                    <span>Created: ${createdDate}</span>
                </div>
            </div>
            <div class="library-item-badges">
                <span class="library-badge ${badgeClass}">${badgeText}</span>
            </div>
        </div>
        <div class="library-item-actions">
            ${item.has_download && item.file_path ? `
                <button class="library-action-button play-library-button" data-title="${item.title}" data-file-path="${item.file_path}" data-media-type="${item.media_type || 'audio'}">
                    <i class="fas fa-play"></i> Play
                </button>
            ` : ''}
            ${item.can_add_download ? `
                <button class="library-action-button" data-action="add-download" data-id="${item.id}">
                    <i class="fas fa-plus"></i> Add Download
                </button>
            ` : ''}
            ${item.can_add_extraction ? `
                <button class="library-action-button" data-action="add-extraction" data-id="${item.id}">
                    <i class="fas fa-plus"></i> Add Extraction
                </button>
            ` : ''}
            ${!item.can_add_download && !item.can_add_extraction ? `
                <span class="library-action-button secondary" disabled>
                    <i class="fas fa-check"></i> Already in your list
                </span>
            ` : ''}
        </div>
    `;
    
    // Play button
    const playBtn = itemElement.querySelector('.play-library-button');
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            openMediaPlayer(playBtn.dataset.title, playBtn.dataset.filePath, playBtn.dataset.mediaType);
        });
    }

    // Add event listeners for action buttons
    itemElement.querySelectorAll('.library-action-button[data-action]').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            const id = button.dataset.id;

            if (action === 'add-download') {
                addLibraryDownload(id, button);
            } else if (action === 'add-extraction') {
                addLibraryExtraction(id, button);
            }
        });
    });

    return itemElement;
}

// Add download from library to user's list
function addLibraryDownload(globalDownloadId, button) {
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
    button.disabled = true;
    
    fetch(`/api/library/${globalDownloadId}/add-download`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(data.message, 'success');
            button.innerHTML = '<i class="fas fa-check"></i> Added to Downloads';
            button.classList.add('secondary');
            button.disabled = true;
            
            // Refresh downloads tab if it's loaded
            if (typeof loadDownloads === 'function') {
                loadDownloads();
            }
        } else {
            showToast(`Error: ${data.error}`, 'error');
            button.innerHTML = originalText;
            button.disabled = false;
        }
    })
    .catch(error => {
        console.error('Error adding download:', error);
        showToast('Error adding download from library', 'error');
        button.innerHTML = originalText;
        button.disabled = false;
    });
}

// Add extraction from library to user's list
function addLibraryExtraction(globalDownloadId, button) {
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
    button.disabled = true;
    
    fetch(`/api/library/${globalDownloadId}/add-extraction`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': getCsrfToken()
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showToast(data.message, 'success');
            button.innerHTML = '<i class="fas fa-check"></i> Added to Extractions';
            button.classList.add('secondary');
            button.disabled = true;
            
            // Refresh extractions tab if it's loaded
            if (typeof loadExtractions === 'function') {
                loadExtractions();
            }
        } else {
            showToast(`Error: ${data.error}`, 'error');
            button.innerHTML = originalText;
            button.disabled = false;
        }
    })
    .catch(error => {
        console.error('Error adding extraction:', error);
        showToast('Error adding extraction from library', 'error');
        button.innerHTML = originalText;
        button.disabled = false;
    });
}

// Update library stats display
function updateLibraryStats(totalCount, filter, search) {
    const statsElement = document.getElementById('libraryItemCount');
    if (!statsElement) return;
    
    let filterText = '';
    if (filter === 'downloads') filterText = ' downloads';
    else if (filter === 'extractions') filterText = ' extractions';
    else filterText = ' items';
    
    let searchText = search ? ` matching "${search}"` : '';
    
    statsElement.textContent = `${totalCount}${filterText}${searchText}`;
}

// Format file size for display
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialize library tab event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Global view switcher buttons
    document.querySelectorAll('.global-view-btn').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.global-view-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            globalView = button.dataset.globalView;
            loadGlobalLibrary();
        });
    });

    // Sort functionality for Global Library
    const globalSortSelect = document.getElementById('globalLibrarySort');
    if (globalSortSelect) {
        globalSortSelect.addEventListener('change', () => {
            loadGlobalLibrary();
        });
    }

    // Search functionality
    const searchInput = document.getElementById('librarySearchInput');
    const searchButton = document.getElementById('librarySearchButton');

    if (searchButton) {
        searchButton.addEventListener('click', () => {
            const searchQuery = searchInput ? searchInput.value : '';
            currentLibrarySearch = searchQuery;
            loadGlobalLibrary();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                currentLibrarySearch = searchInput.value;
                loadGlobalLibrary();
            }
        });
    }
});
