/**
 * Dynamic Browser Logger with Admin-Controlled Configuration
 * Initializes immediately (no timing issues) then loads config from server
 */

class BrowserLogger {
    constructor(config = {}) {
        // Safe defaults (disabled until server config loads)
        this.config = {
            enableServerLogging: false,
            maxBufferSize: 50,
            flushInterval: 60000, // 60 seconds
            minLogLevel: 'error',
            endpoint: '/api/logs/browser',
            enableLocalStorage: false,
            ...config
        };

        this.logBuffer = [];
        this.sessionId = this.generateSessionId();
        this.userId = null;
        this.isSetup = false;
        this.originalFetch = null;
        this.interceptorInstalled = false;

        // Store original console methods
        this.originalConsole = {
            log: console.log.bind(console),
            info: console.info.bind(console),
            warn: console.warn.bind(console),
            error: console.error.bind(console),
            debug: console.debug.bind(console)
        };

        console.info('[Browser Logger] Initializing with safe defaults (disabled)...');
    }

    generateSessionId() {
        return 'bs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Load configuration from server and update behavior
     */
    async loadConfigFromServer() {
        try {
            const response = await fetch('/api/config/browser-logging');
            if (!response.ok) {
                console.warn('[Browser Logger] Failed to load config from server, keeping defaults');
                return;
            }

            const serverConfig = await response.json();

            // Update config
            this.config.enableServerLogging = serverConfig.enabled;
            this.config.minLogLevel = serverConfig.min_log_level;
            this.config.flushInterval = serverConfig.flush_interval_seconds * 1000;
            this.config.maxBufferSize = serverConfig.max_buffer_size;

            console.info('[Browser Logger] Config loaded from server:', {
                enabled: this.config.enableServerLogging,
                level: this.config.minLogLevel,
                interval: serverConfig.flush_interval_seconds + 's'
            });

            // Install or remove fetch interceptor based on config
            if (this.config.enableServerLogging && !this.interceptorInstalled) {
                this.installFetchInterceptor();
            } else if (!this.config.enableServerLogging && this.interceptorInstalled) {
                this.removeFetchInterceptor();
            }

            // Start or stop periodic flushing
            if (this.config.enableServerLogging) {
                this.startPeriodicFlush();
            } else {
                this.stopPeriodicFlush();
            }

        } catch (error) {
            console.warn('[Browser Logger] Error loading config:', error.message);
        }
    }

    /**
     * Install fetch interceptor to log API calls
     */
    installFetchInterceptor() {
        if (this.interceptorInstalled) return;

        this.originalFetch = window.fetch.bind(window);
        const self = this;

        window.fetch = async function(url, options = {}) {
            // Skip logging the logging endpoint itself
            if (typeof url === 'string' && url.includes('/api/logs/browser')) {
                return self.originalFetch(url, options);
            }

            const startTime = Date.now();
            const method = options.method || 'GET';

            try {
                const response = await self.originalFetch(url, options);
                const duration = Date.now() - startTime;

                self.logApiCall(method, url, response.status, duration);
                return response;
            } catch (error) {
                const duration = Date.now() - startTime;
                self.logApiCall(method, url, 'ERROR', duration);
                self.logError('Fetch Error', {
                    url,
                    method,
                    error: error.message,
                    duration
                });
                throw error;
            }
        };

        this.interceptorInstalled = true;
        console.info('[Browser Logger] Fetch interceptor INSTALLED');
    }

    /**
     * Remove fetch interceptor
     */
    removeFetchInterceptor() {
        if (!this.interceptorInstalled || !this.originalFetch) return;

        window.fetch = this.originalFetch;
        this.interceptorInstalled = false;
        console.info('[Browser Logger] Fetch interceptor REMOVED');
    }

    /**
     * Start periodic log flushing
     */
    startPeriodicFlush() {
        if (this.flushIntervalId) return; // Already running

        this.flushIntervalId = setInterval(() => {
            if (this.config.enableServerLogging) {
                this.flushLogs();
            }
        }, this.config.flushInterval);
    }

    /**
     * Stop periodic log flushing
     */
    stopPeriodicFlush() {
        if (this.flushIntervalId) {
            clearInterval(this.flushIntervalId);
            this.flushIntervalId = null;
        }
    }

    shouldCapture(level) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const minLevel = levels[this.config.minLogLevel] || 1;
        const currentLevel = levels[level] || 1;
        return currentLevel >= minLevel;
    }

    formatLogEntry(level, args) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}\\n${arg.stack}`;
            try {
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return String(arg);
            }
        }).join(' ');

        return {
            timestamp,
            level,
            message,
            sessionId: this.sessionId,
            userId: this.userId,
            url: window.location.href,
            userAgent: navigator.userAgent,
            source: 'browser'
        };
    }

    addToBuffer(logEntry) {
        if (!this.config.enableServerLogging) return;

        this.logBuffer.push(logEntry);

        if (this.logBuffer.length > this.config.maxBufferSize) {
            this.logBuffer.shift();
        }

        // Auto-flush on errors
        if (logEntry.level === 'error') {
            this.flushLogs();
        }
    }

    log(level, message, context = {}) {
        const args = [message];
        if (Object.keys(context).length > 0) {
            args.push(context);
        }

        if (this.shouldCapture(level)) {
            const logEntry = this.formatLogEntry(level, args);
            this.addToBuffer(logEntry);
        }
    }

    logError(message, errorData) {
        this.log('error', message, errorData);
    }

    logUserAction(action, context = {}) {
        this.log('info', `User Action: ${action}`, context);
    }

    logPageView(page) {
        this.log('info', `Page View: ${page}`, {
            url: window.location.href,
            referrer: document.referrer
        });
    }

    logApiCall(method, url, status, duration) {
        this.log('info', `API Call: ${method} ${url}`, {
            status,
            duration_ms: duration,
            type: 'api_call'
        });
    }

    setUserId(userId) {
        this.userId = userId;
        this.log('info', 'User ID set', { userId });
    }

    async flushLogs() {
        if (!this.config.enableServerLogging || this.logBuffer.length === 0) {
            return;
        }

        const logsToSend = [...this.logBuffer];
        this.logBuffer = [];

        try {
            const response = await (this.originalFetch || fetch)(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ logs: logsToSend })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            // Re-add logs to buffer if sending failed
            this.logBuffer.unshift(...logsToSend);
            this.originalConsole.error('Failed to send logs to server:', error);
        }
    }

    // Manual logging methods
    debug(message, context) { this.log('debug', message, context); }
    info(message, context) { this.log('info', message, context); }
    warn(message, context) { this.log('warn', message, context); }
    error(message, context) { this.log('error', message, context); }
}

// 1. Initialize browserLogger IMMEDIATELY (synchronous, safe defaults)
window.browserLogger = new BrowserLogger();

// 2. Load server config asynchronously (doesn't block page load)
window.browserLogger.loadConfigFromServer().then(() => {
    console.info('[Browser Logger] Ready');
});

// 3. Export helper functions for compatibility
window.logUserAction = (action, context) => {
    if (browserLogger) browserLogger.logUserAction(action, context);
};

window.logError = (message, error) => {
    if (browserLogger) browserLogger.logError(message, error);
};

window.setLogUserId = (userId) => {
    if (browserLogger) browserLogger.setUserId(userId);
};

// 4. Log page load (only if enabled)
window.addEventListener('load', () => {
    if (browserLogger && browserLogger.config.enableServerLogging) {
        browserLogger.logPageView(window.location.pathname);
    }
});

console.info('✓ Dynamic browser logging system loaded');
