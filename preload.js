const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  // Add listeners for transcript and suggestion data
  onTranscript: (callback) => ipcRenderer.on('transcript', (_, data) => callback(data)),
  onSuggestion: (callback) => ipcRenderer.on('suggestion', (_, data) => callback(data))
});