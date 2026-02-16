/**
 * StemTube Web — split into modular files
 *
 * Load order (all via <script> tags in index.html):
 *   1. app-core.js       — Global variables, Socket.IO init, config, event listeners
 *   2. app-downloads.js  — Search, upload, download/extraction management
 *   3. app-utils.js      — Settings, toast notifications, display helpers
 *   4. app-admin.js      — Admin cleanup, user management, library tab
 *   5. app-extensions.js — Tab management, extraction status, mixer loading
 */
