const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');

// Global reference to the server process
let serverProcess;

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 800,
    height: 200,
    x: Math.floor((width - 800) / 2), // Center horizontally
    y: height - 250, // Position near bottom of screen
    frame: false, // No window frame
    transparent: true, // Transparent background
    alwaysOnTop: true, // Always on top of other windows
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load index.html directly
  mainWindow.loadURL('file://' + path.join(__dirname, 'index.html'));

  // Open DevTools in development
//   mainWindow.webContents.openDevTools();

  // Emitted when the window is closed
  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  // Allow window to be draggable
  ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  });

  // Handle minimize button click
  ipcMain.on('minimize', () => {
    mainWindow.minimize();
  });

  // Handle close button click
  ipcMain.on('close', () => {
    app.quit();
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();
  
  // Start the server process
  serverProcess = fork(path.join(__dirname, 'server.js'), [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  
  // Handle messages from the server process
  serverProcess.on('message', (message) => {
    if (message.type === 'transcript' && mainWindow) {
      mainWindow.webContents.send('transcript', message.data);
    } else if (message.type === 'suggestion' && mainWindow) {
      mainWindow.webContents.send('suggestion', message.data);
    }
  });
  
  // Log server output
  serverProcess.stdout.on('data', (data) => {
    console.log(`[Server]: ${data}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error(`[Server Error]: ${data}`);
  });

  app.on('activate', function () {
    // On macOS it's common to re-create a window when the dock icon is clicked
    if (mainWindow === null) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up the server process when the app is quitting
app.on('quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});