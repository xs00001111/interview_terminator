const { contextBridge, ipcRenderer, dialog } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Window controls
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  
  // Window resize and movement
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height),
  moveWindow: (x, y) => ipcRenderer.send('move-window', x, y),
  
  // Recording controls
  startRecording: () => ipcRenderer.send('start-recording'),
  stopRecording: () => ipcRenderer.send('stop-recording'),
  
  // Context setting
  setContextText: (text) => ipcRenderer.send('set-context-text', text),
  setContextFile: (filePath) => {
    console.log('Setting context file:', filePath);
    ipcRenderer.send('set-context-file', filePath);
  },
  
  // File dialog
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  
  // Authentication methods
  login: (email, password) => ipcRenderer.send('login', { email, password }),
  signup: (email, password) => ipcRenderer.send('signup', { email, password }),
  resetPassword: (email) => ipcRenderer.send('reset-password', { email }),
  devMode: () => ipcRenderer.send('dev-mode'),
  logout: () => ipcRenderer.send('logout'),
  
  // Event listeners
  onTranscript: (callback) => ipcRenderer.on('transcript', (_, data) => callback(data)),
  onSuggestion: (callback) => ipcRenderer.on('suggestion', (_, data) => callback(data)),
  onRecordingStatus: (callback) => ipcRenderer.on('recording-status', (_, data) => callback(data)),
  onContextUpdate: (callback) => ipcRenderer.on('context-update', (_, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('error', (_, data) => callback(data)),
  onReady: (callback) => ipcRenderer.on('ready', (_, data) => callback(data)),
  onScreenshotTaken: (callback) => ipcRenderer.on('screenshot-taken', (_, data) => callback(data)),
  
  // Authentication event listeners
  onAuthError: (callback) => ipcRenderer.on('auth-error', (_, data) => callback(data)),
  onAuthSuccess: (callback) => ipcRenderer.on('auth-success', (_, data) => callback(data)),
  onSignupError: (callback) => ipcRenderer.on('signup-error', (_, data) => callback(data)),
  onSignupSuccess: (callback) => ipcRenderer.on('signup-success', (_, data) => callback(data)),
  onResetError: (callback) => ipcRenderer.on('reset-error', (_, data) => callback(data)),
  onResetSuccess: (callback) => ipcRenderer.on('reset-success', (_, data) => callback(data)),
  
  // Window size and position
  getCurrentWindowSize: () => {
    return ipcRenderer.invoke('get-window-size');
  },
  getCurrentWindowPosition: () => {
    return ipcRenderer.invoke('get-window-position');
  },
  setPinStatus: (pinned) => ipcRenderer.send('set-pin-status', pinned),
});