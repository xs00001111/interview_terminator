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
async function takeScreenshot(processAfterCapture = false) {
  if (!mainWindow) return;
  
  let screenshotPath = "";
  
  try {
    // Hide the app window temporarily to avoid it appearing in the screenshot
    const wasVisible = mainWindow.isVisible();
    if (wasVisible) {
      // Store window position and size
      windowState.position = mainWindow.getPosition();
      windowState.size = mainWindow.getSize();
      mainWindow.hide();
    }
    
    // Reduced delay to minimize latency while still ensuring window is hidden
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Get screenshot buffer using native methods based on platform
    const screenshotBuffer = 
      process.platform === "darwin" 
        ? await captureScreenshotMac() 
        : await captureScreenshotWindows();
    
    // Handle pin status change
    ipcMain.on('set-pin-status', (event, pinned) => {
      if (serverProcess) {
        serverProcess.send({ type: 'pin-status-change', data: { pinned } });
      }
    });
    
    // Generate a unique filename using timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    screenshotPath = path.join(screenshotDir, `screenshot-${timestamp}.png`);
    
    // Save the screenshot to the temp directory
    fs.writeFileSync(screenshotPath, screenshotBuffer);
    
    // Verify the file was written correctly
    const stats = fs.statSync(screenshotPath);
    if (stats.size === 0) {
      console.error('Screenshot file was created but is empty');
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Failed to save screenshot: File is empty' });
      }
      return;
    }
    
    console.log(`Screenshot saved to: ${screenshotPath} (${stats.size} bytes)`);
    
    // Manage screenshot queue (keeping only the most recent screenshots)
    const MAX_SCREENSHOTS = 5; // Reduced from 10 to minimize disk usage and improve performance
    const screenshotFiles = fs.readdirSync(screenshotDir)
      .filter(file => file.startsWith('screenshot-'))
      .map(file => path.join(screenshotDir, file));
    
    // Sort by creation time (oldest first)
    screenshotFiles.sort((a, b) => {
      return fs.statSync(a).mtime.getTime() - fs.statSync(b).mtime.getTime();
    });
    
    // Remove oldest screenshots if we have too many
    if (screenshotFiles.length > MAX_SCREENSHOTS) {
      const filesToRemove = screenshotFiles.slice(0, screenshotFiles.length - MAX_SCREENSHOTS);
      for (const fileToRemove of filesToRemove) {
        try {
          fs.unlinkSync(fileToRemove);
          console.log(`Removed old screenshot: ${fileToRemove}`);
        } catch (error) {
          console.error(`Error removing old screenshot: ${error}`);
        }
      }
    }
    
    // Show the main window again if it was visible before
    if (wasVisible && mainWindow) {
      // Minimal delay before showing window again to reduce latency
      await new Promise(resolve => setTimeout(resolve, 25));
      mainWindow.show();
      if (windowState.position) {
        mainWindow.setPosition(windowState.position[0], windowState.position[1]);
      }
      if (windowState.size) {
        mainWindow.setSize(windowState.size[0], windowState.size[1]);
      }
    }
    
    // Notify the renderer process that the screenshot was taken
    if (mainWindow) {
      mainWindow.webContents.send('screenshot-taken', { 
  path: screenshotPath, 
  isShortcut: processAfterCapture 
});
    }
    
    // If processAfterCapture is true, send the screenshot to the server for processing
    if (processAfterCapture && serverProcess) {
      console.log('Sending screenshot to server for processing...');
      serverProcess.send({ type: 'process-screenshot', data: { path: screenshotPath } });
      if (mainWindow) {
        mainWindow.webContents.send('processing-screenshot', { message: 'Processing screenshot...' });
      }
    }
    
    return screenshotPath;
  } catch (err) {
    console.error('Failed to capture screenshot:', err);
    if (mainWindow) {
      mainWindow.webContents.send('error', { message: `Failed to capture screenshot: ${err.message}` });
    }
    throw err;
  }
}

// Platform-specific screenshot capture for macOS
async function captureScreenshotMac() {
  try {
    // Create a temporary file path for the screenshot
    const tempPath = path.join(screenshotDir, `temp-${Date.now()}.png`);
    
    // Use the screencapture utility on macOS with optimized options
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      // Using execFile instead of exec for better performance and security
      // -x: no sound, -t: png format (faster than default), -C: no cursor
      execFile('screencapture', ['-x', '-t', 'png', '-C', tempPath], (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    
    // Read the file and return as buffer
    return fs.readFileSync(tempPath);
  } catch (error) {
    console.error('Error capturing screenshot on macOS:', error);
    throw error;
  }
}

// Platform-specific screenshot capture for Windows
async function captureScreenshotWindows() {
  try {
    // Use Electron's desktopCapturer for Windows
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'], 
      thumbnailSize: screen.getPrimaryDisplay().workAreaSize 
    });
    
    // Get the primary display source
    const primarySource = sources[0];
    
    // Create a new BrowserWindow to capture the entire screen
    const captureWindow = new BrowserWindow({
      width: screen.getPrimaryDisplay().workAreaSize.width,
      height: screen.getPrimaryDisplay().workAreaSize.height,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: {
        offscreen: true
      }
    });
    
    // Capture the entire screen
    const screenshot = await captureWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: screen.getPrimaryDisplay().bounds.width,
      height: screen.getPrimaryDisplay().bounds.height
    });
    
    // Close the capture window
    captureWindow.close();
    
    return screenshot.toPNG();
  } catch (error) {
    console.error('Error capturing screenshot on Windows:', error);
    throw error;
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Create the browser window with enhanced undetectability features
  mainWindow = new BrowserWindow({
    width: 800,
    height: 400,
    x: Math.floor((width - 800) / 2),
    y: height - 450,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // Fully transparent background
    hasShadow: false, // Disable window shadow
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true, // Hide from taskbar/dock
    type: 'panel', // Less detectable window type
    visibleOnAllWorkspaces: true, // Visible on all virtual desktops
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false // Prevent throttling when in background
    }
  });

  // Apply platform-specific undetectability settings
  if (process.platform === 'darwin') {
    // macOS specific settings
    mainWindow.setHiddenInMissionControl(true); // Hide from Mission Control
  }

  // Enable content protection to prevent screen capture
  mainWindow.setContentProtection(true);

  // Load index.html directly
  mainWindow.loadURL('file://' + path.join(__dirname, 'index.html'));

  // Open DevTools in development
   mainWindow.webContents.openDevTools();

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
    takeScreenshot(false);
  });
  
  // Register keyboard shortcut for taking and processing screenshots (Command+Enter on Mac, Control+Enter on Windows)
  globalShortcut.register('CommandOrControl+Enter', () => {
    takeScreenshot(true);
  });
  
  // Register keyboard shortcut for quick hide (Escape key)
  globalShortcut.register('Escape', () => {
    if (mainWindow && isWindowVisible) {
      // Quick hide with opacity
      mainWindow.setOpacity(0);
      mainWindow.setIgnoreMouseEvents(true);
      isWindowVisible = false;
    }
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
    } else if (message.type === 'suggestion-chunk' && mainWindow) {
      // Handle streaming chunks from OpenAI
      mainWindow.webContents.send('suggestion-chunk', message.data);
    } else if (message.type === 'recording-status' && mainWindow) {
      mainWindow.webContents.send('recording-status', message.data);
    } else if (message.type === 'context-update' && mainWindow) {
      mainWindow.webContents.send('context-update', message.data);
    } else if (message.type === 'error' && mainWindow) {
      mainWindow.webContents.send('error', message.data);
    } else if (message.type === 'ready' && mainWindow) {
      mainWindow.webContents.send('ready', message.data);
    } else if (message.type === 'screenshot-processed' && mainWindow) {
      mainWindow.webContents.send('screenshot-processed', message.data);
    } else if (message.type === 'processing-screenshot' && mainWindow) {
      mainWindow.webContents.send('processing-screenshot', message.data);
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

// Enhanced function to toggle window visibility with undetectability features
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
    
    // Hide the window using opacity for smoother transition
    mainWindow.setOpacity(0);
    // Ignore mouse events when hidden
    mainWindow.setIgnoreMouseEvents(true);
    isWindowVisible = false;
  } else {
    // Restore mouse event handling
    mainWindow.setIgnoreMouseEvents(false);
    // Show the window with opacity transition
    mainWindow.setOpacity(1);
    
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