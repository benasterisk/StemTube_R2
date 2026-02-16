// ============================================
// Mobile Admin Functionality
// ============================================

class MobileAdmin {
    constructor() {
        this.initialized = false;
    }

    init() {
        if (this.initialized || typeof isAdmin === 'undefined' || !isAdmin) return;

        this.initAdminTabs();
        this.initUsersSection();
        this.initLogsSection();
        this.initCleanupSection();
        this.initSystemSettingsSection();
        this.initModals();

        this.initialized = true;
        console.log('[MobileAdmin] Initialized');
    }

    // Admin Tab Navigation
    initAdminTabs() {
        document.querySelectorAll('.mobile-admin-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.adminTab;
                this.switchAdminTab(tabName);
            });
        });
    }

    switchAdminTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.mobile-admin-tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.mobile-admin-tab[data-admin-tab="${tabName}"]`);
        if (activeTab) activeTab.classList.add('active');

        // Update content
        document.querySelectorAll('.mobile-admin-content').forEach(c => c.classList.remove('active'));
        const contentMap = {
            'users': 'mobileAdminUsers',
            'logs': 'mobileAdminLogs',
            'cleanup': 'mobileAdminCleanup',
            'settings': 'mobileAdminSettings'
        };
        const contentEl = document.getElementById(contentMap[tabName]);
        if (contentEl) contentEl.classList.add('active');

        // Load data for the tab
        if (tabName === 'users') this.loadUsers();
        else if (tabName === 'logs') this.loadLogsConfig();
        else if (tabName === 'cleanup') this.loadCleanupData();
        else if (tabName === 'settings') this.loadSystemSettings();
    }

    // ========== Users Section ==========
    initUsersSection() {
        const addBtn = document.getElementById('mobileAddUserBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.showAddUserModal());
        }
    }

    async loadUsers() {
        const list = document.getElementById('mobileUsersList');
        if (!list) {
            console.error('[MobileAdmin] mobileUsersList element not found');
            return;
        }

        console.log('[MobileAdmin] Loading users...');
        list.innerHTML = '<div class="mobile-loading"><div class="mobile-spinner-small"></div><span>Loading users...</span></div>';

        try {
            const response = await fetch('/api/admin/users');
            console.log('[MobileAdmin] Response status:', response.status);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('[MobileAdmin] Users data:', data);

            // Store users for later reference in event handlers
            this.usersData = data.users || [];

            if (this.usersData.length > 0) {
                list.innerHTML = this.usersData.map(user => `
                    <div class="mobile-user-item" data-user-id="${user.id}">
                        <div class="mobile-user-info">
                            <div class="mobile-user-name">
                                ${user.username}
                                ${user.is_admin ? '<span class="mobile-user-badge">Admin</span>' : ''}
                            </div>
                            <div class="mobile-user-email">${user.email || 'No email'}</div>
                        </div>
                        <div class="mobile-user-youtube">
                            <label class="mobile-toggle-switch">
                                <input type="checkbox" class="mobile-youtube-toggle" data-user-id="${user.id}" ${user.youtube_enabled ? 'checked' : ''}>
                                <span class="mobile-toggle-slider"></span>
                            </label>
                            <span class="mobile-youtube-label">YT</span>
                        </div>
                        <div class="mobile-user-actions">
                            <button class="mobile-user-action edit" data-action="edit"><i class="fas fa-edit"></i></button>
                            <button class="mobile-user-action password" data-action="password"><i class="fas fa-key"></i></button>
                            <button class="mobile-user-action delete" data-action="delete"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                `).join('');

                // Add event listeners
                const self = this;
                list.querySelectorAll('.mobile-user-action').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const button = e.currentTarget;
                        const item = button.closest('.mobile-user-item');
                        const userId = parseInt(item.dataset.userId);
                        const user = self.usersData.find(u => u.id === userId);
                        const action = button.dataset.action;

                        if (user) {
                            if (action === 'edit') self.showEditUserModal(user);
                            else if (action === 'password') self.showResetPasswordModal(user);
                            else if (action === 'delete') self.showDeleteUserModal(user);
                        }
                    });
                });

                // YouTube toggle event listeners
                list.querySelectorAll('.mobile-youtube-toggle').forEach(toggle => {
                    toggle.addEventListener('change', async (e) => {
                        const userId = parseInt(e.target.dataset.userId);
                        const enabled = e.target.checked;

                        e.target.disabled = true;

                        try {
                            const response = await fetch(`/api/admin/users/${userId}/youtube`, {
                                method: 'PUT',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({youtube_enabled: enabled})
                            });

                            const data = await response.json();

                            if (response.ok && data.success) {
                                // Update local data
                                const user = self.usersData.find(u => u.id === userId);
                                if (user) user.youtube_enabled = enabled;
                                window.mobileApp?.showToast('YouTube access updated', 'success');
                            } else {
                                e.target.checked = !enabled;
                                window.mobileApp?.showToast(data.error || 'Failed to update YouTube access', 'error');
                            }
                        } catch (error) {
                            e.target.checked = !enabled;
                            window.mobileApp?.showToast('Error updating YouTube access', 'error');
                            console.error('[MobileAdmin] Error updating YouTube access:', error);
                        } finally {
                            e.target.disabled = false;
                        }
                    });
                });

                console.log('[MobileAdmin] Users loaded successfully:', this.usersData.length);
            } else {
                list.innerHTML = '<div class="mobile-empty-state"><i class="fas fa-users"></i><p>No users found</p></div>';
            }
        } catch (error) {
            console.error('[MobileAdmin] Failed to load users:', error);
            list.innerHTML = `<div class="mobile-empty-state"><i class="fas fa-exclamation-circle"></i><p>Error: ${error.message}</p></div>`;
        }
    }

    showAddUserModal() {
        const modal = document.getElementById('mobileAddUserModal');
        if (modal) {
            document.getElementById('mobileNewUsername').value = '';
            document.getElementById('mobileNewPassword').value = '';
            document.getElementById('mobileNewEmail').value = '';
            document.getElementById('mobileNewIsAdmin').checked = false;
            document.getElementById('mobileNewYoutubeEnabled').checked = false;
            modal.classList.add('visible');
        }
    }

    showEditUserModal(user) {
        const modal = document.getElementById('mobileEditUserModal');
        if (modal) {
            document.getElementById('mobileEditUserId').value = user.id;
            document.getElementById('mobileEditUsername').value = user.username;
            document.getElementById('mobileEditEmail').value = user.email || '';
            document.getElementById('mobileEditIsAdmin').checked = user.is_admin;
            document.getElementById('mobileEditYoutubeEnabled').checked = user.youtube_enabled;
            modal.classList.add('visible');
        }
    }

    showResetPasswordModal(user) {
        const modal = document.getElementById('mobileResetPasswordModal');
        if (modal) {
            document.getElementById('mobileResetUserId').value = user.id;
            document.getElementById('mobileResetUserName').textContent = `Reset password for ${user.username}`;
            document.getElementById('mobileResetNewPassword').value = '';
            modal.classList.add('visible');
        }
    }

    showDeleteUserModal(user) {
        const modal = document.getElementById('mobileDeleteUserModal');
        if (modal) {
            document.getElementById('mobileDeleteUserId').value = user.id;
            document.getElementById('mobileDeleteUserName').textContent = user.username;
            modal.classList.add('visible');
        }
    }

    async createUser() {
        const username = document.getElementById('mobileNewUsername').value.trim();
        const password = document.getElementById('mobileNewPassword').value;
        const email = document.getElementById('mobileNewEmail').value.trim();
        const isAdmin = document.getElementById('mobileNewIsAdmin').checked;
        const youtubeEnabled = document.getElementById('mobileNewYoutubeEnabled').checked;

        if (!username || !password) {
            window.mobileApp?.showToast('Username and password required', 'error');
            return;
        }

        try {
            const response = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, email, is_admin: isAdmin, youtube_enabled: youtubeEnabled })
            });
            const data = await response.json();

            if (response.ok) {
                window.mobileApp?.showToast('User created successfully', 'success');
                document.getElementById('mobileAddUserModal').classList.remove('visible');
                this.loadUsers();
            } else {
                window.mobileApp?.showToast(data.error || 'Failed to create user', 'error');
            }
        } catch (error) {
            window.mobileApp?.showToast('Error creating user', 'error');
        }
    }

    async updateUser() {
        const userId = document.getElementById('mobileEditUserId').value;
        const username = document.getElementById('mobileEditUsername').value.trim();
        const email = document.getElementById('mobileEditEmail').value.trim();
        const isAdmin = document.getElementById('mobileEditIsAdmin').checked;
        const youtubeEnabled = document.getElementById('mobileEditYoutubeEnabled').checked;

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, is_admin: isAdmin, youtube_enabled: youtubeEnabled })
            });
            const data = await response.json();

            if (response.ok) {
                window.mobileApp?.showToast('User updated successfully', 'success');
                document.getElementById('mobileEditUserModal').classList.remove('visible');
                this.loadUsers();
            } else {
                window.mobileApp?.showToast(data.error || 'Failed to update user', 'error');
            }
        } catch (error) {
            window.mobileApp?.showToast('Error updating user', 'error');
        }
    }

    async resetPassword() {
        const userId = document.getElementById('mobileResetUserId').value;
        const password = document.getElementById('mobileResetNewPassword').value;

        if (!password) {
            window.mobileApp?.showToast('Password required', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/admin/users/${userId}/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await response.json();

            if (response.ok) {
                window.mobileApp?.showToast('Password reset successfully', 'success');
                document.getElementById('mobileResetPasswordModal').classList.remove('visible');
            } else {
                window.mobileApp?.showToast(data.error || 'Failed to reset password', 'error');
            }
        } catch (error) {
            window.mobileApp?.showToast('Error resetting password', 'error');
        }
    }

    async deleteUser() {
        const userId = document.getElementById('mobileDeleteUserId').value;

        try {
            const response = await fetch(`/api/admin/users/${userId}`, {
                method: 'DELETE'
            });
            const data = await response.json();

            if (response.ok) {
                window.mobileApp?.showToast('User deleted successfully', 'success');
                document.getElementById('mobileDeleteUserModal').classList.remove('visible');
                this.loadUsers();
            } else {
                window.mobileApp?.showToast(data.error || 'Failed to delete user', 'error');
            }
        } catch (error) {
            window.mobileApp?.showToast('Error deleting user', 'error');
        }
    }

    // ========== Logs Section ==========
    initLogsSection() {
        // Preset buttons
        document.querySelectorAll('.mobile-logs-preset').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.dataset.preset;
                this.applyLogsPreset(preset);
            });
        });

        // Slider displays
        const flushInterval = document.getElementById('mobileFlushInterval');
        const bufferSize = document.getElementById('mobileBufferSize');

        if (flushInterval) {
            flushInterval.addEventListener('input', function() {
                document.getElementById('mobileFlushValue').textContent = this.value;
            });
        }

        if (bufferSize) {
            bufferSize.addEventListener('input', function() {
                document.getElementById('mobileBufferValue').textContent = this.value;
            });
        }

        // Save button
        const saveBtn = document.getElementById('mobileSaveLogsConfig');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveLogsConfig());
        }
    }

    async loadLogsConfig() {
        try {
            const response = await fetch('/api/config/browser-logging');
            const config = await response.json();

            // Update form
            const loggingEnabled = document.getElementById('mobileLoggingEnabled');
            const logLevel = document.getElementById('mobileLogLevel');
            const flushInterval = document.getElementById('mobileFlushInterval');
            const bufferSize = document.getElementById('mobileBufferSize');

            if (loggingEnabled) loggingEnabled.checked = config.enabled;
            if (logLevel) logLevel.value = config.min_log_level;
            if (flushInterval) {
                flushInterval.value = config.flush_interval_seconds;
                document.getElementById('mobileFlushValue').textContent = config.flush_interval_seconds;
            }
            if (bufferSize) {
                bufferSize.value = config.max_buffer_size;
                document.getElementById('mobileBufferValue').textContent = config.max_buffer_size;
            }

            // Update status
            this.updateLogsStatus(config.enabled, config.min_log_level);
            this.updateLogsPresets(config);
        } catch (error) {
            console.error('Failed to load logs config:', error);
        }
    }

    updateLogsStatus(enabled, level) {
        const indicator = document.getElementById('mobileLogsIndicator');
        const text = document.getElementById('mobileLogsStatusText');

        if (indicator) {
            indicator.classList.toggle('active', enabled);
        }
        if (text) {
            text.textContent = enabled ? `Logs Enabled (${level})` : 'Logs Disabled';
        }
    }

    updateLogsPresets(config) {
        document.querySelectorAll('.mobile-logs-preset').forEach(btn => {
            btn.classList.remove('active');
        });

        let activePreset = null;
        if (!config.enabled) {
            activePreset = 'disabled';
        } else if (config.min_log_level === 'error' && config.flush_interval_seconds >= 60) {
            activePreset = 'production';
        } else if (config.min_log_level === 'info' || config.min_log_level === 'debug') {
            activePreset = 'development';
        }

        if (activePreset) {
            const btn = document.querySelector(`.mobile-logs-preset[data-preset="${activePreset}"]`);
            if (btn) btn.classList.add('active');
        }
    }

    async applyLogsPreset(preset) {
        const loggingEnabled = document.getElementById('mobileLoggingEnabled');
        const logLevel = document.getElementById('mobileLogLevel');
        const flushInterval = document.getElementById('mobileFlushInterval');
        const bufferSize = document.getElementById('mobileBufferSize');

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

        document.getElementById('mobileFlushValue').textContent = flushInterval.value;
        document.getElementById('mobileBufferValue').textContent = bufferSize.value;

        await this.saveLogsConfig();
    }

    async saveLogsConfig() {
        try {
            const config = {
                enabled: document.getElementById('mobileLoggingEnabled').checked,
                min_log_level: document.getElementById('mobileLogLevel').value,
                flush_interval_seconds: parseInt(document.getElementById('mobileFlushInterval').value),
                max_buffer_size: parseInt(document.getElementById('mobileBufferSize').value)
            };

            const response = await fetch('/api/config/browser-logging', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            const result = await response.json();

            if (result.success) {
                this.updateLogsStatus(config.enabled, config.min_log_level);
                this.updateLogsPresets(config);
                window.mobileApp?.showToast('Configuration saved', 'success');
            } else {
                window.mobileApp?.showToast(result.error || 'Failed to save', 'error');
            }
        } catch (error) {
            window.mobileApp?.showToast('Error saving configuration', 'error');
        }
    }

    // ========== Cleanup Section ==========
    initCleanupSection() {
        this.cleanupData = [];
        this.selectedItems = new Set();

        const refreshBtn = document.getElementById('mobileRefreshCleanup');
        const selectAllCheckbox = document.getElementById('mobileCleanupSelectAll');
        const deleteSelectedBtn = document.getElementById('mobileDeleteSelected');
        const resetSelectedBtn = document.getElementById('mobileResetSelected');

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadCleanupData());
        }

        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        }

        if (deleteSelectedBtn) {
            deleteSelectedBtn.addEventListener('click', () => this.deleteSelected());
        }

        if (resetSelectedBtn) {
            resetSelectedBtn.addEventListener('click', () => this.resetSelected());
        }
    }

    async loadCleanupData() {
        const list = document.getElementById('mobileCleanupList');
        if (!list) return;

        this.selectedItems.clear();
        this.updateSelectionUI();

        list.innerHTML = '<div class="mobile-loading"><div class="mobile-spinner-small"></div><span>Loading...</span></div>';

        try {
            const [downloadsRes, statsRes] = await Promise.all([
                fetch('/api/admin/cleanup/downloads'),
                fetch('/api/admin/cleanup/storage-stats')
            ]);

            const downloads = await downloadsRes.json();
            const stats = await statsRes.json();

            // Update stats dashboard
            if (stats.filesystem) {
                document.getElementById('mobileStatTotalFiles').textContent = stats.filesystem.total_files || 0;
                document.getElementById('mobileStatTotalSize').textContent = stats.filesystem.total_size || '0 B';
                document.getElementById('mobileStatExtracted').textContent = stats.database?.extracted_count || 0;
            }

            // Store data for later use
            this.cleanupData = Array.isArray(downloads) ? downloads : [];

            if (this.cleanupData.length > 0) {
                list.innerHTML = this.cleanupData.map(item => this.createCleanupItemHTML(item)).join('');
                this.attachCleanupItemListeners();
            } else {
                list.innerHTML = '<div class="mobile-empty-state"><i class="fas fa-folder-open"></i><p>No downloads found</p></div>';
            }

            // Reset select all checkbox
            const selectAllCheckbox = document.getElementById('mobileCleanupSelectAll');
            if (selectAllCheckbox) selectAllCheckbox.checked = false;

        } catch (error) {
            console.error('Failed to load cleanup data:', error);
            list.innerHTML = '<div class="mobile-empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load data</p></div>';
        }
    }

    createCleanupItemHTML(item) {
        const videoId = item.video_id || '';
        const title = item.title || item.filename || 'Unknown';
        const size = item.file_size ? this.formatSize(item.file_size) : '-';
        const isExtracted = item.extracted;
        const extractedClass = isExtracted ? 'extracted' : 'not-extracted';
        const extractedText = isExtracted ? 'Extracted' : 'Not extracted';

        return `
            <div class="mobile-cleanup-item" data-video-id="${videoId}">
                <div class="mobile-cleanup-item-checkbox">
                    <input type="checkbox" class="mobile-cleanup-checkbox" data-video-id="${videoId}">
                </div>
                <div class="mobile-cleanup-item-info">
                    <div class="mobile-cleanup-item-title">${title}</div>
                    <div class="mobile-cleanup-item-meta">
                        <span class="mobile-cleanup-size">${size}</span>
                        <span class="mobile-cleanup-status ${extractedClass}">${extractedText}</span>
                    </div>
                </div>
                <div class="mobile-cleanup-item-actions">
                    ${isExtracted ? `<button class="mobile-cleanup-action reset" data-action="reset" data-video-id="${videoId}" title="Reset extraction"><i class="fas fa-undo"></i></button>` : ''}
                    <button class="mobile-cleanup-action delete" data-action="delete" data-video-id="${videoId}" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `;
    }

    attachCleanupItemListeners() {
        const list = document.getElementById('mobileCleanupList');
        if (!list) return;

        // Checkbox listeners
        list.querySelectorAll('.mobile-cleanup-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const videoId = e.target.dataset.videoId;
                if (e.target.checked) {
                    this.selectedItems.add(videoId);
                } else {
                    this.selectedItems.delete(videoId);
                }
                this.updateSelectionUI();
            });
        });

        // Action button listeners
        list.querySelectorAll('.mobile-cleanup-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const videoId = e.target.closest('.mobile-cleanup-action').dataset.videoId;
                const action = e.target.closest('.mobile-cleanup-action').dataset.action;

                if (action === 'delete') {
                    this.deleteDownload(videoId);
                } else if (action === 'reset') {
                    this.resetExtraction(videoId);
                }
            });
        });

        // Click on item row to toggle checkbox
        list.querySelectorAll('.mobile-cleanup-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.mobile-cleanup-action') || e.target.closest('.mobile-cleanup-checkbox')) return;
                const checkbox = item.querySelector('.mobile-cleanup-checkbox');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('.mobile-cleanup-checkbox');
        this.selectedItems.clear();

        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
            if (checked) {
                this.selectedItems.add(checkbox.dataset.videoId);
            }
        });

        this.updateSelectionUI();
    }

    updateSelectionUI() {
        const count = this.selectedItems.size;
        const countEl = document.getElementById('mobileSelectionCount');
        const deleteBtn = document.getElementById('mobileDeleteSelected');
        const resetBtn = document.getElementById('mobileResetSelected');
        const selectAllCheckbox = document.getElementById('mobileCleanupSelectAll');

        if (countEl) {
            countEl.textContent = count > 0 ? `(${count})` : '';
        }

        if (deleteBtn) {
            deleteBtn.disabled = count === 0;
        }

        if (resetBtn) {
            resetBtn.disabled = count === 0;
        }

        // Update select all checkbox state
        if (selectAllCheckbox && this.cleanupData.length > 0) {
            selectAllCheckbox.checked = count === this.cleanupData.length;
            selectAllCheckbox.indeterminate = count > 0 && count < this.cleanupData.length;
        }
    }

    formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    showProgress(show, percent = 0, text = '') {
        const progressEl = document.getElementById('mobileCleanupProgress');
        const fillEl = document.getElementById('mobileProgressFill');
        const textEl = document.getElementById('mobileProgressText');

        if (progressEl) {
            progressEl.style.display = show ? 'flex' : 'none';
        }
        if (fillEl) {
            fillEl.style.width = `${percent}%`;
        }
        if (textEl) {
            textEl.textContent = text || `${percent}%`;
        }
    }

    async deleteDownload(videoId) {
        if (!confirm('Delete this download?')) return;

        try {
            const response = await fetch(`/api/admin/cleanup/downloads/${videoId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                window.mobileApp?.showToast('Download deleted', 'success');
                this.loadCleanupData();
            } else {
                window.mobileApp?.showToast('Failed to delete', 'error');
            }
        } catch (error) {
            window.mobileApp?.showToast('Error deleting download', 'error');
        }
    }

    async resetExtraction(videoId) {
        if (!confirm('Reset extraction status for this item?')) return;

        try {
            const response = await fetch(`/api/admin/cleanup/downloads/${videoId}/reset-extraction`, {
                method: 'POST'
            });

            if (response.ok) {
                window.mobileApp?.showToast('Extraction reset', 'success');
                this.loadCleanupData();
            } else {
                window.mobileApp?.showToast('Failed to reset', 'error');
            }
        } catch (error) {
            window.mobileApp?.showToast('Error resetting extraction', 'error');
        }
    }

    async deleteSelected() {
        const count = this.selectedItems.size;
        if (count === 0) return;
        if (!confirm(`Delete ${count} selected item(s)?`)) return;

        const items = Array.from(this.selectedItems);
        let deleted = 0;

        this.showProgress(true, 0, `Deleting 0/${count}`);

        for (let i = 0; i < items.length; i++) {
            try {
                const response = await fetch(`/api/admin/cleanup/downloads/${items[i]}`, {
                    method: 'DELETE'
                });
                if (response.ok) deleted++;
            } catch (error) {
                console.error(`Failed to delete ${items[i]}:`, error);
            }

            const percent = Math.round(((i + 1) / count) * 100);
            this.showProgress(true, percent, `Deleting ${i + 1}/${count}`);
        }

        this.showProgress(false);
        window.mobileApp?.showToast(`Deleted ${deleted}/${count} item(s)`, deleted === count ? 'success' : 'warning');
        this.loadCleanupData();
    }

    async resetSelected() {
        const count = this.selectedItems.size;
        if (count === 0) return;
        if (!confirm(`Reset extraction for ${count} selected item(s)?`)) return;

        const items = Array.from(this.selectedItems);
        let reset = 0;

        this.showProgress(true, 0, `Resetting 0/${count}`);

        for (let i = 0; i < items.length; i++) {
            try {
                const response = await fetch(`/api/admin/cleanup/downloads/${items[i]}/reset-extraction`, {
                    method: 'POST'
                });
                if (response.ok) reset++;
            } catch (error) {
                console.error(`Failed to reset ${items[i]}:`, error);
            }

            const percent = Math.round(((i + 1) / count) * 100);
            this.showProgress(true, percent, `Resetting ${i + 1}/${count}`);
        }

        this.showProgress(false);
        window.mobileApp?.showToast(`Reset ${reset}/${count} item(s)`, reset === count ? 'success' : 'warning');
        this.loadCleanupData();
    }

    // ========== System Settings Section ==========
    initSystemSettingsSection() {
        console.log('[MobileAdmin] Initializing system settings section');
        const saveBtn = document.getElementById('mobileSaveSystemSettings');
        const restartBtn = document.getElementById('mobileRestartServer');

        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSystemSettings());
            console.log('[MobileAdmin] Save button listener attached');
        }

        if (restartBtn) {
            restartBtn.addEventListener('click', () => this.restartServer());
            console.log('[MobileAdmin] Restart button listener attached');
        }

        // Initialize YouTube Cookies Management
        this.initCookiesManagement();
    }

    // ========== YouTube Cookies Management ==========
    initCookiesManagement() {
        console.log('[MobileAdmin] Initializing cookies management');
        const uploadBtn = document.getElementById('mobileUploadCookiesFileBtn');
        const fileInput = document.getElementById('mobileCookiesFileInput');
        const generateBtn = document.getElementById('mobileGenerateBookmarkletBtn');
        const deleteBtn = document.getElementById('mobileDeleteCookiesBtn');

        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => this.uploadCookiesFile());
        }

        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.generateBookmarklet());
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteCookies());
        }

        // Load initial status
        this.loadCookiesStatus();
    }

    async loadCookiesStatus() {
        const statusDiv = document.getElementById('mobileCookiesStatus');
        const deleteBtn = document.getElementById('mobileDeleteCookiesBtn');

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
                const authInfo = data.has_auth_cookies
                    ? `🔑 Auth: ${data.auth_cookies_found.join(', ')}`
                    : '⚠️ No auth cookies - re-upload while logged in';
                const authColor = data.has_auth_cookies ? '#28a745' : '#ffc107';
                statusDiv.innerHTML = `
                    <div>
                        <div><i class="fas fa-check-circle" style="color: ${data.is_fresh ? '#28a745' : '#ffc107'}"></i>
                        <span>${freshIcon} ${data.cookie_count} cookies - ${freshText}</span></div>
                        <div style="font-size: 0.8rem; margin-top: 4px; color: ${authColor};">${authInfo}</div>
                    </div>
                `;
                if (deleteBtn) deleteBtn.disabled = false;
            } else {
                statusDiv.innerHTML = `
                    <i class="fas fa-exclamation-triangle" style="color: #ffc107"></i>
                    <span>⚠️ No cookies - upload cookies.txt</span>
                `;
                if (deleteBtn) deleteBtn.disabled = true;
            }
        } catch (error) {
            console.error('[MobileAdmin] Error loading cookies status:', error);
            statusDiv.innerHTML = `
                <i class="fas fa-times-circle" style="color: #dc3545"></i>
                <span>❌ Error</span>
            `;
        }
    }

    async uploadCookiesFile() {
        const fileInput = document.getElementById('mobileCookiesFileInput');
        const uploadBtn = document.getElementById('mobileUploadCookiesFileBtn');

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
                window.mobileApp?.showToast('Upload error: ' + errorMsg, 'error');
                return;
            }

            const data = await response.json();
            if (data.success) {
                window.mobileApp?.showToast(data.message, data.has_auth_cookies ? 'success' : 'warning');
                this.loadCookiesStatus();
            } else {
                window.mobileApp?.showToast(data.message || 'Upload failed', 'error');
            }
        } catch (error) {
            console.error('[MobileAdmin] Error uploading cookies file:', error);
            window.mobileApp?.showToast('Upload error: ' + error.message, 'error');
        } finally {
            uploadBtn.innerHTML = originalText;
            uploadBtn.disabled = false;
            fileInput.value = '';
        }
    }

    async generateBookmarklet() {
        const btn = document.getElementById('mobileGenerateBookmarkletBtn');
        const container = document.getElementById('mobileBookmarkletContainer');
        const link = document.getElementById('mobileBookmarkletLink');

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
                window.mobileApp?.showToast('Bookmarklet generated', 'success');
            } else {
                window.mobileApp?.showToast(data.error || 'Error', 'error');
            }
        } catch (error) {
            console.error('[MobileAdmin] Error generating bookmarklet:', error);
            window.mobileApp?.showToast('Error: ' + error.message, 'error');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    async deleteCookies() {
        if (!confirm('Delete YouTube cookies?')) return;

        try {
            const response = await fetch('/api/admin/cookies', { method: 'DELETE' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();

            if (data.success) {
                window.mobileApp?.showToast('Cookies deleted', 'success');
                this.loadCookiesStatus();
                const container = document.getElementById('mobileBookmarkletContainer');
                if (container) container.style.display = 'none';
            } else {
                window.mobileApp?.showToast(data.error || 'Error', 'error');
            }
        } catch (error) {
            console.error('[MobileAdmin] Error deleting cookies:', error);
            window.mobileApp?.showToast('Error: ' + error.message, 'error');
        }
    }

    async loadSystemSettings() {
        console.log('[MobileAdmin] Loading system settings...');
        try {
            const response = await fetch('/api/admin/system-settings');
            console.log('[MobileAdmin] API response status:', response.status);
            const data = await response.json();
            console.log('[MobileAdmin] API response data:', data);

            if (data.success) {
                const settings = data.settings;
                const systemInfo = data.system_info;

                // Update form values
                const downloadsDir = document.getElementById('mobileDownloadsDirectory');
                const maxDownloads = document.getElementById('mobileMaxDownloads');
                const maxExtractions = document.getElementById('mobileMaxExtractions');
                const useGpu = document.getElementById('mobileUseGpu');
                const lyricsModel = document.getElementById('mobileLyricsModel');
                const stemModel = document.getElementById('mobileStemModel');

                if (downloadsDir) downloadsDir.value = settings.downloads_directory || '';
                if (maxDownloads) maxDownloads.value = settings.max_concurrent_downloads || 3;
                if (maxExtractions) maxExtractions.value = settings.max_concurrent_extractions || 1;
                if (useGpu) useGpu.checked = settings.use_gpu_for_extraction !== false;
                if (lyricsModel) lyricsModel.value = settings.lyrics_model_size || 'medium';
                if (stemModel) stemModel.value = settings.default_stem_model || 'htdemucs';

                // Update GPU status
                this.updateMobileStatusBadge('mobileGpuStatus', 'mobileGpuStatusText',
                    systemInfo.gpu_available,
                    systemInfo.gpu_available ? 'Available' : 'Not Available');

                // Update FFmpeg status
                this.updateMobileStatusBadge('mobileFfmpegStatus', 'mobileFfmpegStatusText',
                    systemInfo.ffmpeg_available,
                    systemInfo.ffmpeg_available ? 'Installed' : 'Not Found');

                console.log('[MobileAdmin] Settings loaded successfully');
            } else {
                console.error('[MobileAdmin] API returned error:', data.error);
                window.mobileApp?.showToast(data.error || 'Error loading settings', 'error');
                this.updateMobileStatusBadge('mobileGpuStatus', 'mobileGpuStatusText', false, 'Error');
                this.updateMobileStatusBadge('mobileFfmpegStatus', 'mobileFfmpegStatusText', false, 'Error');
            }
        } catch (error) {
            console.error('[MobileAdmin] Error loading system settings:', error);
            window.mobileApp?.showToast('Error loading system settings', 'error');
            this.updateMobileStatusBadge('mobileGpuStatus', 'mobileGpuStatusText', false, 'Error');
            this.updateMobileStatusBadge('mobileFfmpegStatus', 'mobileFfmpegStatusText', false, 'Error');
        }
    }

    updateMobileStatusBadge(badgeId, textId, isAvailable, statusText) {
        const badge = document.getElementById(badgeId);
        const text = document.getElementById(textId);
        if (badge) {
            badge.classList.toggle('available', isAvailable);
            badge.classList.toggle('unavailable', !isAvailable);
        }
        if (text) {
            text.textContent = statusText;
        }
    }

    async saveSystemSettings() {
        console.log('[MobileAdmin] Saving system settings...');
        const settings = {
            downloads_directory: document.getElementById('mobileDownloadsDirectory')?.value,
            max_concurrent_downloads: parseInt(document.getElementById('mobileMaxDownloads')?.value) || 3,
            max_concurrent_extractions: parseInt(document.getElementById('mobileMaxExtractions')?.value) || 1,
            use_gpu_for_extraction: document.getElementById('mobileUseGpu')?.checked ?? true,
            lyrics_model_size: document.getElementById('mobileLyricsModel')?.value || 'medium',
            default_stem_model: document.getElementById('mobileStemModel')?.value || 'htdemucs'
        };

        console.log('[MobileAdmin] Settings to save:', settings);

        // Show saving indicator
        const saveBtn = document.getElementById('mobileSaveSystemSettings');
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

            console.log('[MobileAdmin] Save response status:', response.status);
            const data = await response.json();
            console.log('[MobileAdmin] Save response data:', data);

            if (data.success) {
                window.mobileApp?.showToast('System settings saved', 'success');

                // Show/hide restart warning
                const restartWarning = document.getElementById('mobileRestartWarning');
                if (restartWarning) {
                    restartWarning.style.display = data.requires_restart ? 'flex' : 'none';
                }
            } else {
                window.mobileApp?.showToast(data.error || 'Error saving settings', 'error');
            }
        } catch (error) {
            console.error('[MobileAdmin] Error saving system settings:', error);
            window.mobileApp?.showToast('Error saving settings: ' + error.message, 'error');
        } finally {
            // Restore button
            if (saveBtn) {
                saveBtn.innerHTML = originalText || '<i class="fas fa-save"></i> Save Settings';
                saveBtn.disabled = false;
            }
        }
    }

    async restartServer() {
        if (!confirm('Are you sure you want to restart the server?')) {
            return;
        }

        console.log('[MobileAdmin] Restarting server...');

        // Show restarting indicator
        const restartBtn = document.getElementById('mobileRestartServer');
        if (restartBtn) {
            restartBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restarting...';
            restartBtn.disabled = true;
        }

        window.mobileApp?.showToast('Restarting server...', 'info');

        try {
            const response = await fetch('/api/admin/restart-server', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                window.mobileApp?.showToast('Server is restarting...', 'info');
                setTimeout(() => {
                    location.reload();
                }, 3000);
            }
        } catch (error) {
            // This is expected since the server is restarting
            window.mobileApp?.showToast('Server is restarting...', 'info');
            setTimeout(() => {
                location.reload();
            }, 3000);
        }
    }

    // ========== Modals ==========
    initModals() {
        // Close buttons
        const closeButtons = [
            'mobileAddUserClose',
            'mobileEditUserClose',
            'mobileResetPasswordClose',
            'mobileDeleteUserClose'
        ];

        closeButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => {
                    btn.closest('.mobile-modal').classList.remove('visible');
                });
            }
        });

        // Action buttons
        const createUserBtn = document.getElementById('mobileCreateUserBtn');
        const updateUserBtn = document.getElementById('mobileUpdateUserBtn');
        const resetPasswordBtn = document.getElementById('mobileResetPasswordBtn');
        const confirmDeleteBtn = document.getElementById('mobileConfirmDeleteBtn');
        const cancelDeleteBtn = document.getElementById('mobileCancelDeleteBtn');

        if (createUserBtn) createUserBtn.addEventListener('click', () => this.createUser());
        if (updateUserBtn) updateUserBtn.addEventListener('click', () => this.updateUser());
        if (resetPasswordBtn) resetPasswordBtn.addEventListener('click', () => this.resetPassword());
        if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', () => this.deleteUser());
        if (cancelDeleteBtn) {
            cancelDeleteBtn.addEventListener('click', () => {
                document.getElementById('mobileDeleteUserModal').classList.remove('visible');
            });
        }

        // Close on backdrop click
        document.querySelectorAll('.mobile-modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('visible');
                }
            });
        });
    }
}

// Initialize mobile admin when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof isAdmin !== 'undefined' && isAdmin) {
        window.mobileAdmin = new MobileAdmin();
        window.mobileAdmin.init();

        // Load users when admin page is first shown
        const adminNavBtn = document.querySelector('.mobile-nav-btn[data-page="admin"]');
        if (adminNavBtn) {
            adminNavBtn.addEventListener('click', () => {
                setTimeout(() => window.mobileAdmin.loadUsers(), 100);
            });
        }
    }
});
