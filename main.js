const { app, BrowserWindow, screen, ipcMain, globalShortcut, dialog, desktopCapturer } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');

// Global reference to the server process
let serverProcess;

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

// Track window visibility state
let isWindowVisible = true;

// Store window position and size for restoration
let windowState = {
  position: null,
  size: null
};

// Create temp directory for screenshots
const screenshotDir = path.join(os.tmpdir(), 'app-screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// Function to take a screenshot
function takeScreenshot() {
  if (!mainWindow) return;
  
  // Get the current timestamp for the filename
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  const screenshotPath = path.join(screenshotDir, `screenshot-${timestamp}.png`);
  
  // Use desktopCapturer to get all available sources
  desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    .then(async sources => {
      // Get the primary display source
      const primarySource = sources[0]; // Usually the first source is the entire screen
      
      try {
        // Capture a screenshot of the entire screen
        const screenshot = await mainWindow.webContents.capturePage();
        const buffer = screenshot.toPNG();
        
        // Save the screenshot to the temp directory
        fs.writeFile(screenshotPath, buffer, (err) => {
          if (err) {
            console.error('Failed to save screenshot:', err);
            if (mainWindow) {
              mainWindow.webContents.send('error', { message: 'Failed to save screenshot' });
            }
            return;
          }
          
          console.log(`Screenshot saved to: ${screenshotPath}`);
          // Notify the renderer process that the screenshot was taken
          if (mainWindow) {
            mainWindow.webContents.send('screenshot-taken', { path: screenshotPath });
          }
        });
      } catch (err) {
        console.error('Failed to capture screenshot:', err);
        if (mainWindow) {
          mainWindow.webContents.send('error', { message: 'Failed to capture screenshot' });
        }
      }
    })
    .catch(err => {
      console.error('Failed to get screen sources:', err);
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Failed to get screen sources' });
      }
    });
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 800,
    height: 400, // Increased from 200 to 400 for better visibility
    x: Math.floor((width - 800) / 2), // Center hocrizontally
    y: height - 450, // Adjusted position to account for increased height
    frame: false, // No window frame
    transparent: true, // Transparent background
    alwaysOnTop: true, // Always on top of other windows
    resizable: true, // Allow window to be resized
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
  ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
    mainWindow.setIgnoreMouseEvents(ignore, options || { forward: true });
  });
  
  // Handle window resize
  ipcMain.on('resize-window', (event, width, height) => {
    if (mainWindow) {
      mainWindow.setSize(width, height);
    }
  });
  
  // Handle window move
  ipcMain.on('move-window', (event, x, y) => {
    if (mainWindow) {
      const [currentX, currentY] = mainWindow.getPosition();
      mainWindow.setPosition(currentX + x, currentY + y);
    }
  });
  
  // Get window size
  ipcMain.handle('get-window-size', () => {
    if (mainWindow) {
      return mainWindow.getSize();
    }
    return [800, 200]; // Default size
  });
  
  // Get window position
  ipcMain.handle('get-window-position', () => {
    if (mainWindow) {
      return mainWindow.getPosition();
    }
    return [0, 0]; // Default position
  });

  // Handle minimize button click
  ipcMain.on('minimize', () => {
    mainWindow.minimize();
  });

  // Handle close button click
  ipcMain.on('close', () => {
    app.quit();
  });
  
  // Handle start recording button click
  ipcMain.on('start-recording', () => {
    if (serverProcess) {
      serverProcess.send({ type: 'start-recording' });
    }
  });
  
  // Handle stop recording button click
  ipcMain.on('stop-recording', () => {
    if (serverProcess) {
      serverProcess.send({ type: 'stop-recording' });
    }
  });
  
  // Handle set context from text
  ipcMain.on('set-context-text', (event, text) => {
    if (serverProcess) {
      serverProcess.send({ type: 'set-context', data: { text } });
    }
  });
  
  // Handle file dialog open request
  ipcMain.handle('open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Text Files', extensions: ['txt', 'md', 'json'] },
        { name: 'Documents', extensions: ['pdf', 'docx'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }
      ]
    });
    return result;
  });
  
  // Handle set context from file
  ipcMain.on('set-context-file', (event, filePath) => {
    console.log('Received file path in main process:', filePath);
    
    // If the file path is just a filename (not a full path), we need to handle it differently
    if (!filePath.includes('/') && !filePath.includes('\\')) {
      console.log('File path appears to be just a filename, not a full path');
      // In a real implementation, you might want to show a dialog to select the file
      // For now, we'll just send an error back to the renderer
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Could not access full file path. Please try again.' });
      }
      return;
    }
    
    if (serverProcess) {
      serverProcess.send({ type: 'set-context', data: { file: filePath } });
    }
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();
  
  // Register keyboard shortcuts for window movement
  globalShortcut.register('CommandOrControl+Up', () => {
    if (mainWindow) {
      const [x, y] = mainWindow.getPosition();
      mainWindow.setPosition(x, y - 10);
    }
  });
  
  globalShortcut.register('CommandOrControl+Down', () => {
    if (mainWindow) {
      const [x, y] = mainWindow.getPosition();
      mainWindow.setPosition(x, y + 10);
    }
  });
  
  globalShortcut.register('CommandOrControl+Left', () => {
    if (mainWindow) {
      const [x, y] = mainWindow.getPosition();
      mainWindow.setPosition(x - 10, y);
    }
  });
  
  globalShortcut.register('CommandOrControl+Right', () => {
    if (mainWindow) {
      const [x, y] = mainWindow.getPosition();
      mainWindow.setPosition(x + 10, y);
    }
  });
  
  // Register keyboard shortcut for toggling window visibility (Command+B on Mac, Control+B on Windows)
  globalShortcut.register('CommandOrControl+B', () => {
    toggleWindowVisibility();
  });
  
  // Register keyboard shortcut for quitting the application (Command+Q on Mac, Control+Q on Windows)
  globalShortcut.register('CommandOrControl+Q', () => {
    app.quit();
  });
  
  // Register keyboard shortcut for taking screenshots (Command+H on Mac, Control+H on Windows)
  globalShortcut.register('CommandOrControl+H', () => {
    takeScreenshot();
  });
  
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
    } else if (message.type === 'recording-status' && mainWindow) {
      mainWindow.webContents.send('recording-status', message.data);
    } else if (message.type === 'context-update' && mainWindow) {
      mainWindow.webContents.send('context-update', message.data);
    } else if (message.type === 'error' && mainWindow) {
      mainWindow.webContents.send('error', message.data);
    } else if (message.type === 'ready' && mainWindow) {
      mainWindow.webContents.send('ready', message.data);
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
  
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// Function to toggle window visibility
function toggleWindowVisibility() {
  if (!mainWindow) {
    // If window was closed, recreate it
    createWindow();
    isWindowVisible = true;
    return;
  }
  
  if (isWindowVisible) {
    // Store current window state before hiding
    windowState.position = mainWindow.getPosition();
    windowState.size = mainWindow.getSize();
    
    // Hide the window
    mainWindow.hide();
    isWindowVisible = false;
  } else {
    // Show the window and restore position if available
    mainWindow.show();
    
    // Restore previous position and size if available
    if (windowState.position) {
      mainWindow.setPosition(windowState.position[0], windowState.position[1]);
    }
    
    if (windowState.size) {
      mainWindow.setSize(windowState.size[0], windowState.size[1]);
    }
    
    isWindowVisible = true;
  }
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});