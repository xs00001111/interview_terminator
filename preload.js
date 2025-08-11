// Preload health check
try {
  console.log('[PRELOAD] script started on', process.platform);
} catch (e) {
  // In extremely rare cases console is not ready – fall back to a file write, etc.
}

const { contextBridge, ipcRenderer, dialog } = require('electron');
const os = require('os');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object

// Check if we're on macOS 15+ (Sequoia) where Swift AudioCapture handles both mic and system audio
function isMac15Plus() {
  if (process.platform !== 'darwin') return false;
  // Darwin 24 == macOS 15 (Sequoia); Darwin 23 == macOS 14, etc.
  return parseInt(os.release().split('.')[0], 10) >= 24;
}

// Microphone permission detection
async function requestMicPermission() {
  // macOS 15+ → Swift capture has the mic already; skip the Web API check
  const isMac15 = isMac15Plus();
  console.log('[PRELOAD] isMac15Plus():', isMac15, 'platform:', process.platform, 'release:', os.release());
  if (isMac15) {
    console.log('[PRELOAD] Skipping Web API microphone check for macOS 15+');
    return Promise.resolve({ ok: true, skipped: true });
  }
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // notify the main process and close the stream immediately
    ipcRenderer.send('mic-status', { ok: true });
    stream.getTracks().forEach(t => t.stop());
    return { ok: true };
  } catch (err) {
    ipcRenderer.send('mic-status', {
      ok: false,
      name: err.name,
      message: err.message,
    });
    
    // Handle Windows-specific permission errors
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      ipcRenderer.send('mic-permission-denied');
    } else {
      // tell main process to show a helper dialog for other errors
      ipcRenderer.send('open-privacy-settings', process.platform);
    }
    return { ok: false, name: err.name, message: err.message };
  }
}

contextBridge.exposeInMainWorld('mic', { request: requestMicPermission });

// Expose auth methods
contextBridge.exposeInMainWorld('auth', {
  completeLogin: (data) => {
    console.log('[PRELOAD] Invoking complete-login with data:', data);
    return ipcRenderer.invoke('complete-login', data);
  },
  logout: () => {
    console.log('[PRELOAD] Invoking logout');
    return ipcRenderer.invoke('logout');
  },
  onAuthError: (callback) => ipcRenderer.on('auth-error', (_, data) => {
    console.log('[PRELOAD] Received auth-error event:', data);
    callback(data);
  }),
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (_, data) => {
    console.log('[PRELOAD] Received auth-success event:', data);
    callback(data);
  }),
  onAuthRequired: (callback) => ipcRenderer.on('auth-required', (_, data) => {
    console.log('[PRELOAD] Received auth-required event:', data);
    callback(data);
  }),
  onSignOut: (callback) => ipcRenderer.on('sign-out', (_, data) => {
    console.log('[PRELOAD] Received sign-out event:', data);
    callback(data);
  }),
  checkSession: () => {
    console.log('[PRELOAD] Checking session status');
    return ipcRenderer.invoke('check-session');
  },
  signIn: (email, password) => {
    console.log('[PRELOAD] Invoking sign-in with email:', email);
    return ipcRenderer.invoke('sign-in', { email, password });
  },
  getUserInfo: () => {
    console.log('[PRELOAD] Getting user info');
    return ipcRenderer.invoke('get-user-info');
  }
});

contextBridge.exposeInMainWorld('appWindow', {
  expand:   () => ipcRenderer.send('ui-expand'),
  collapse: () => ipcRenderer.send('ui-collapse')
});

contextBridge.exposeInMainWorld('electron', {
  // Window controls
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  quit: () => ipcRenderer.send('close'),
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  
  // Window resize and movement
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),
  moveWindow: (x, y) => ipcRenderer.send('move-window', x, y),
  getWindowSize: () => ipcRenderer.invoke('get-window-size'),
  
  // Recording controls
  startRecording: () => ipcRenderer.send('start-recording'),
  stopRecording: () => ipcRenderer.send('stop-recording'),
  
  // Microphone access for older macOS versions
  startMicrophoneCapture: () => ipcRenderer.send('start-microphone-capture'),
  stopMicrophoneCapture: () => ipcRenderer.send('stop-microphone-capture'),
  sendMicrophoneData: (audioData) => ipcRenderer.send('microphone-data', audioData),
  
  // Windows audio capture
  sendSystemAudioData: (audioData) => ipcRenderer.send('system-audio-data', audioData),
  onStartWindowsAudioCapture: (callback) => ipcRenderer.on('start-windows-audio-capture', () => callback()),
  onStopWindowsAudioCapture: (callback) => ipcRenderer.on('stop-windows-audio-capture', () => callback()),
  
  // Context setting
  setContextText: (text) => ipcRenderer.send('set-context-text', text),
  setContextFile: (filePath) => {
    console.log('Setting context file:', filePath);
    ipcRenderer.send('set-context-file', filePath);
  },
  createTempFile: (fileData) => {
    console.log('Creating temporary file for:', fileData.fileName);
    return ipcRenderer.invoke('create-temp-file', fileData);
  },
  
  // File dialog
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  
  // Event listeners
  onTranscript: (callback) => ipcRenderer.on('transcript', (_, data) => callback(data)),
  onInterimTranscript: (callback) => ipcRenderer.on('interim-transcript', (_, data) => callback(data)),
  onSuggestion: (callback) => ipcRenderer.on('suggestion', (_, data) => callback(data)),
  onSuggestionChunk: (callback) => ipcRenderer.on('suggestion-chunk', (_, data) => callback(data)),
  onSuggestionPartial: (callback) => ipcRenderer.on('suggestion-partial', (_, data) => callback(data)),
  onSuggestionProcessing: (callback) => ipcRenderer.on('suggestion-processing', (_, data) => callback(data)),
  onRecordingStatus: (callback) => ipcRenderer.on('recording-status', (_, data) => callback(data)),
  onContextUpdate: (callback) => ipcRenderer.on('context-update', (_, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('error', (_, data) => callback(data)),
  onReady: (callback) => ipcRenderer.on('ready', (_, data) => callback(data)),
  onScreenshotTaken: (callback) => ipcRenderer.on('screenshot-taken', (_, data) => callback(data)),
  onTimeLimitReached: (callback) => ipcRenderer.on('time-limit-reached', (_, data) => callback(data)),
  
  // Window size and position
  getCurrentWindowSize: () => {
    return ipcRenderer.invoke('get-window-size');
  },
  getCurrentWindowPosition: () => {
    return ipcRenderer.invoke('get-window-position');
  },
  // Pin functionality removed
  elaborate: (message) => {
    console.log('[DEBUG] Sending elaborate IPC message:', message);
    ipcRenderer.send('elaborate', message);
  },
  onElaboration: (callback) => {
    ipcRenderer.on('elaboration', (_, data) => callback(data));
  },
  
  // New functionality
  takeScreenshot: () => ipcRenderer.send('take-screenshot'),
  takeScreenshotWithAI: () => ipcRenderer.send('take-screenshot-with-ai'),
  saveContext: (context) => ipcRenderer.send('save-context', context),
  loadContext: () => ipcRenderer.invoke('load-context'),
  getContext: () => ipcRenderer.invoke('get-context'),
  onContextSaved: (callback) => ipcRenderer.on('context-saved', (_, data) => callback(data)),
  pinMessage: (isPinned) => ipcRenderer.send('pin-message', isPinned),
  clearHistory: () => ipcRenderer.send('clear-history'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  getOSVersion: () => ipcRenderer.invoke('get-os-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  sendToServer: (message) => {
    console.log('[PRELOAD] Sending message to server:', message.type);
    ipcRenderer.send('send-to-server', message);
  },
  deleteContext: () => {
    console.log('[PRELOAD] Deleting context');
    ipcRenderer.send('delete-context');
  },
  processFile: (filePath, fileName) => {
    console.log('[PRELOAD] Processing file:', fileName, 'at path:', filePath);
    // Use the unified setContextFile API instead of process-file-content
    ipcRenderer.send('set-context-file', filePath);
  },
  // Open external links in default browser
  openExternal: (url) => ipcRenderer.send('open-external', url),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, data) => callback(data)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_, data) => callback(data)),
  onUpdateProgress: (callback) => ipcRenderer.on('update-progress', (_, data) => callback(data)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_, data) => callback(data)),
  getSuggestion: (text) => ipcRenderer.send('get-suggestion', { text }),
  
  // Permission checking
  checkMicrophonePermission: () => ipcRenderer.invoke('check-microphone-permission'),
  checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
  openPrivacySettings: (permissionType) => ipcRenderer.send('open-privacy-settings', permissionType),
  
  // Microphone access checking
  checkMicrophoneAccess: () => {
    return window.mic.request();
  },
  
  // Permission error events
  onPermError: (callback) => ipcRenderer.on('perm-error', (_, errorData) => callback(errorData)),
  onMicStatus: (callback) => ipcRenderer.on('mic-status-update', (_, data) => callback(data)),
  
  // Hotkey trigger events
  onTriggerRecordButton: (callback) => ipcRenderer.on('trigger-record-button', () => callback()),
  onTriggerAiButton: (callback) => ipcRenderer.on('trigger-ai-button', () => callback()),
  onTriggerTranscriptToggle: (callback) => ipcRenderer.on('trigger-transcript-toggle', () => callback()),
  onTriggerCopyAiText: (callback) => ipcRenderer.on('trigger-copy-ai-text', () => callback()),
  
  // Generic send and on methods for flexibility
  send: (channel, ...args) => {
    // Ensure args is always an array to prevent Symbol.iterator errors
    const safeArgs = Array.isArray(args) ? args : (args ? [args] : []);
    return ipcRenderer.send(channel, ...safeArgs);
  },
  on: (channel, callback) => ipcRenderer.on(channel, (_, ...args) => {
    // Ensure args is always an array to prevent Symbol.iterator errors
    const safeArgs = Array.isArray(args) ? args : (args ? [args] : []);
    return callback(...safeArgs);
  }),
  invoke: (channel, ...args) => {
    // Ensure args is always an array to prevent Symbol.iterator errors
    const safeArgs = Array.isArray(args) ? args : (args ? [args] : []);
    return ipcRenderer.invoke(channel, ...safeArgs);
  },
  
  // Preload microphone check
  preloadMicCheck: () => ipcRenderer.invoke('preload-mic-check')
});

// Handle microphone access check requests from main process
ipcRenderer.on('check-microphone-access', async (_e, { id }) => {
  console.log('[PRELOAD] Checking microphone access with ID:', id);
  const result = await requestMicPermission();
  console.log('[PRELOAD] Microphone access result:', result);
  
  // Send the result back to main process with the request ID
  ipcRenderer.send('mic-status', { id, ...result });
});