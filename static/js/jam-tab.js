/**
 * JamTab - Desktop Jam Session page UI
 * Manages session creation, QR code display, sharing, and participant list.
 */
class JamTab {
    constructor() {
        this.container = document.getElementById('jamTab');
        this.jamClient = null;
        this.qrCodeLoaded = false;
        this.render();
    }

    init(jamClient) {
        this.jamClient = jamClient;

        this.jamClient.onCreated((data) => {
            this.showActiveView(data.code, data.url);
        });

        this.jamClient.onParticipantUpdate((data) => {
            this.updateParticipantList(data.participants);
        });

        this.jamClient.onSessionEnded((data) => {
            this.showCreateView();
            if (typeof showToast === 'function') {
                showToast('Jam session ended', 'info');
            }
        });
    }

    render() {
        if (!this.container) return;
        this.showCreateView();
    }

    showCreateView() {
        if (!this.container) return;

        // If a session was active, notify mixer iframe and reset state
        if (window.jamState && window.jamState.active) {
            window.jamState = { active: false, code: null };
            const mixerFrame = document.getElementById('mixerFrame');
            if (mixerFrame && mixerFrame.contentWindow) {
                mixerFrame.contentWindow.postMessage({ type: 'jam_session_ended' }, '*');
                console.log('[JamTab] Sent jam_session_ended postMessage to mixer iframe');
            }
        }

        this.container.innerHTML = `
            <div class="jam-page">
                <div class="jam-create-section">
                    <div class="jam-icon">
                        <i class="fas fa-users"></i>
                    </div>
                    <h2>Jam Session</h2>
                    <p class="jam-description">Create a synchronized jam session. Share the link with your bandmates and play together in real time.</p>
                    <button class="jam-create-btn" id="jamCreateBtn">
                        <i class="fas fa-play-circle"></i> Create Jam Session
                    </button>
                </div>
            </div>
        `;

        document.getElementById('jamCreateBtn')?.addEventListener('click', () => {
            if (this.jamClient) {
                this.jamClient.createSession();
            }
        });
    }

    showActiveView(code, url) {
        if (!this.container) return;

        // Build the share URL
        const shareUrl = url || `${window.location.origin}/jam/${code.replace('JAM-', '')}`;

        this.container.innerHTML = `
            <div class="jam-page">
                <div class="jam-active-section">
                    <div class="jam-session-header">
                        <div class="jam-session-code">
                            <span class="jam-code-label">Session Code</span>
                            <span class="jam-code-value">${code}</span>
                        </div>
                        <button class="jam-end-btn" id="jamEndBtn" title="End Session">
                            <i class="fas fa-times-circle"></i> End Session
                        </button>
                    </div>

                    <div class="jam-qr-container" id="jamQrContainer">
                        <!-- QR code will be rendered here -->
                    </div>

                    <div class="jam-share-url">
                        <input type="text" class="jam-url-input" id="jamUrlInput" value="${shareUrl}" readonly>
                        <button class="jam-copy-btn" id="jamCopyBtn" title="Copy link">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>

                    <div class="jam-share-buttons">
                        <button class="jam-share-btn jam-share-whatsapp" id="jamShareWhatsapp" title="Share via WhatsApp">
                            <i class="fab fa-whatsapp"></i> WhatsApp
                        </button>
                        <button class="jam-share-btn jam-share-email" id="jamShareEmail" title="Share via Email">
                            <i class="fas fa-envelope"></i> Email
                        </button>
                        <button class="jam-share-btn jam-share-sms" id="jamShareSms" title="Share via SMS">
                            <i class="fas fa-sms"></i> SMS
                        </button>
                    </div>

                    <div class="jam-participants-section">
                        <h3><i class="fas fa-users"></i> Participants</h3>
                        <div class="jam-participants-list" id="jamParticipantsList">
                            <div class="jam-participant jam-participant-host">
                                <span class="jam-participant-icon"><i class="fas fa-crown"></i></span>
                                <span class="jam-participant-name">You (Host)</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Generate QR code
        this._generateQRCode(shareUrl);

        // Bind events
        document.getElementById('jamEndBtn')?.addEventListener('click', () => {
            if (confirm('End this jam session? All guests will be disconnected.')) {
                if (this.jamClient) {
                    this.jamClient.endSession();
                }
                this.showCreateView();
            }
        });

        document.getElementById('jamCopyBtn')?.addEventListener('click', () => {
            navigator.clipboard.writeText(shareUrl).then(() => {
                if (typeof showToast === 'function') showToast('Link copied!', 'success');
            });
        });

        document.getElementById('jamShareWhatsapp')?.addEventListener('click', () => {
            window.open(`https://wa.me/?text=${encodeURIComponent('Join my Jam Session! ' + shareUrl)}`, '_blank');
        });

        document.getElementById('jamShareEmail')?.addEventListener('click', () => {
            window.open(`mailto:?subject=${encodeURIComponent('Join my Jam Session')}&body=${encodeURIComponent('Join my StemTube Jam Session: ' + shareUrl)}`, '_blank');
        });

        document.getElementById('jamShareSms')?.addEventListener('click', () => {
            window.open(`sms:?body=${encodeURIComponent('Join my Jam Session! ' + shareUrl)}`, '_blank');
        });

        // Update parent window jam state for iframe communication
        window.jamState = { active: true, code: code };

        // Notify mixer iframe about jam session creation
        const mixerFrame = document.getElementById('mixerFrame');
        if (mixerFrame && mixerFrame.contentWindow) {
            mixerFrame.contentWindow.postMessage({ type: 'jam_session_created', code: code }, '*');
            console.log('[JamTab] Sent jam_session_created postMessage to mixer iframe');
        }
    }

    updateParticipantList(participants) {
        const list = document.getElementById('jamParticipantsList');
        if (!list) return;

        list.innerHTML = '';
        participants.forEach(p => {
            const div = document.createElement('div');
            div.className = `jam-participant ${p.role === 'host' ? 'jam-participant-host' : 'jam-participant-guest'}`;
            div.innerHTML = `
                <span class="jam-participant-icon">
                    <i class="fas ${p.role === 'host' ? 'fa-crown' : 'fa-user'}"></i>
                </span>
                <span class="jam-participant-name">${p.name}${p.role === 'host' ? ' (Host)' : ''}</span>
            `;
            list.appendChild(div);
        });
    }

    async _generateQRCode(url) {
        const container = document.getElementById('jamQrContainer');
        if (!container) return;

        // Load QRCode library dynamically if not loaded
        if (typeof QRCode === 'undefined') {
            try {
                await this._loadScript('https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js');
            } catch (e) {
                console.warn('[Jam] QRCode library failed to load, showing text fallback');
                container.innerHTML = `<div class="jam-qr-fallback">${url}</div>`;
                return;
            }
        }

        try {
            const canvas = document.createElement('canvas');
            await QRCode.toCanvas(canvas, url, {
                width: 200,
                margin: 2,
                color: { dark: '#ffffff', light: '#00000000' }
            });
            container.innerHTML = '';
            container.appendChild(canvas);
        } catch (e) {
            console.error('[Jam] QR generation error:', e);
            container.innerHTML = `<div class="jam-qr-fallback">${url}</div>`;
        }
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.jamTab = new JamTab();
});
