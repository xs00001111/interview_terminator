const { app, BrowserWindow, screen, ipcMain, globalShortcut, dialog, desktopCapturer } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://aqhcipqqdtchivmbxrap.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGNpcHFxZHRjaGl2bWJ4cmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3NzE0NDUsImV4cCI6MjA1NzM0NzQ0NX0.ABSLZyrZ-8LojAriQKlJALmsgChKagrPLXzVabf559Q';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Authentication state
let session = null;
let apiKeys = null;

// Global reference to the server process
let serverProcess;

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;
let loginWindow;

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

// Create login window
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 400,
    height: 600,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    resizable: false,
    show: false
  });
  
  loginWindow.loadFile('login.html');
  
  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
  });
  
  loginWindow.on('closed', () => {
    loginWindow = null;
  });
}

// Create main application window
function createMainWindow() {
  // Get the primary display dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: 500,
    height: 400,
    x: Math.floor(width / 2 - 250),
    y: Math.floor(height - 450),
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    resizable: true,
    show: false
  });
  
  mainWindow.loadFile('index.html');
  
  // Only open dev tools in development mode
  if (process.env.NODE_ENV === 'development') {
    // mainWindow.webContents.openDevTools();
  }
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });
  
  // Start the server process
  startServerProcess();
}

// Fetch API keys from Supabase for the authenticated user
async function fetchApiKeys(userId) {
  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('google_speech_key, google_gemini_key')
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error('Error fetching API keys:', error.message);
      return null;
    }
    
    if (!data) {
      console.error('No API keys found for user');
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Exception fetching API keys:', error.message);
    return null;
  }
}

// Start the server process with the appropriate API keys
function startServerProcess() {
  // Set environment variables for the server process
  const env = { ...process.env };
  
  // If we have API keys from authentication, use those
  if (apiKeys) {
    env.GOOGLE_SPEECH_API_KEY = apiKeys.google_speech_key;
    env.GOOGLE_GEMINI_API_KEY = apiKeys.google_gemini_key;
  }
  
  // Start the server as a child process
  serverProcess = fork(path.join(__dirname, 'server.js'), [], {
    env: env,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  
  // Handle messages from the server process
  serverProcess.on('message', (message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(message.type, message.data);
    }
  });
  
  // Handle server process exit
  serverProcess.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`);
    serverProcess = null;
  });
  
  // Handle server process errors
  serverProcess.on('error', (err) => {
    console.error('Server process error:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', { message: `Server error: ${err.message}` });
    }
  });
  
  // Log server output for debugging
  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error(`Server error: ${data}`);
  });
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
// Handle IPC messages for authentication
ipcMain.on('login', async (event, { email, password }) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    
    if (error) {
      if (loginWindow) {
        loginWindow.webContents.send('auth-error', { message: error.message });
      }
      return;
    }
    
    // Store the session
    session = data.session;
    
    // Fetch API keys for the authenticated user
    apiKeys = await fetchApiKeys(data.user.id);
    
    if (!apiKeys) {
      if (loginWindow) {
        loginWindow.webContents.send('auth-error', { message: 'No API keys found for your account. Please contact support.' });
      }
      return;
    }
    
    // Notify the renderer process of successful login
    if (loginWindow) {
      loginWindow.webContents.send('auth-success', { message: 'Login successful!' });
    }
    
    // Close the login window and open the main window
    setTimeout(() => {
      if (loginWindow) {
        loginWindow.close();
      }
      createMainWindow();
    }, 1000);
  } catch (error) {
    console.error('Login error:', error);
    if (loginWindow) {
      loginWindow.webContents.send('auth-error', { message: 'An unexpected error occurred. Please try again.' });
    }
  }
});

ipcMain.on('signup', async (event, { email, password }) => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });
    
    if (error) {
      if (loginWindow) {
        loginWindow.webContents.send('signup-error', { message: error.message });
      }
      return;
    }
    
    // Notify the renderer process of successful signup
    if (loginWindow) {
      loginWindow.webContents.send('signup-success', { message: 'Account created successfully! Please check your email for verification.' });
    }
  } catch (error) {
    console.error('Signup error:', error);
    if (loginWindow) {
      loginWindow.webContents.send('signup-error', { message: 'An unexpected error occurred. Please try again.' });
    }
  }
});

ipcMain.on('reset-password', async (event, { email }) => {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'app://reset-password'
    });
    
    if (error) {
      if (loginWindow) {
        loginWindow.webContents.send('reset-error', { message: error.message });
      }
      return;
    }
    
    // Notify the renderer process of successful reset request
    if (loginWindow) {
      loginWindow.webContents.send('reset-success', { message: 'Password reset link sent to your email!' });
    }
  } catch (error) {
    console.error('Reset password error:', error);
    if (loginWindow) {
      loginWindow.webContents.send('reset-error', { message: 'An unexpected error occurred. Please try again.' });
    }
  }
});

ipcMain.on('logout', async () => {
  try {
    await supabase.auth.signOut();
    session = null;
    apiKeys = null;
    
    // Close the main window and open the login window
    if (mainWindow) {
      mainWindow.close();
    }
    createLoginWindow();
  } catch (error) {
    console.error('Logout error:', error);
  }
});

// Developer mode bypass
ipcMain.on('dev-mode', () => {
  console.log('Developer mode activated');
  // Close the login window if it exists
  if (loginWindow) {
    loginWindow.close();
  }
  
  // Set development API keys
  apiKeys = {
    google_speech_key: process.env.GOOGLE_SPEECH_API_KEY,
    google_gemini_key: process.env.GOOGLE_GEMINI_API_KEY
  };
  
  // Create the main window using createWindow instead of createMainWindow
  // to ensure proper event listeners are registered
  createWindow();
});

app.whenReady().then(() => {
  // Start with login window instead of main window
  createLoginWindow();
  
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