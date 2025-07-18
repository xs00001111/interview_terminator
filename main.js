// ---- load env from wherever it lives (asar or resources root) ----
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const envCandidates = [
  path.join(__dirname, '.env.production'),               // inside asar (mac build)
  path.join(process.resourcesPath, '.env.production'),   // alongside resources (win build)
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}

const { app, BrowserWindow, screen, ipcMain, globalShortcut, dialog, desktopCapturer, systemPreferences, shell } = require('electron');
const { BAR_HEIGHT, EXPANDED_HEIGHT, WINDOW_WIDTH } = require('./constants.js');
const { fork } = require('child_process');
const os = require('os');

// Check if we're on macOS 15+ (Sequoia) where Swift AudioCapture handles both mic and system audio
function isMac15Plus() {
  if (process.platform !== 'darwin') return false;
  // Darwin 24 == macOS 15 (Sequoia); Darwin 23 == macOS 14, etc.
  return parseInt(os.release().split('.')[0], 10) >= 24;
}

// Load environment variables from .env file
dotenv.config();

// Suppress macOS Text Input Method warnings
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
// Enable logging for debugging
process.env.ELECTRON_ENABLE_LOGGING = 'true';

// Add command line switches to suppress macOS TI framework warnings
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
app.commandLine.appendSwitch('silent-debugger-extension-api');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-field-trial-config');
app.commandLine.appendSwitch('disable-ipc-flooding-protection');
// Disable Autofill to prevent errors
app.commandLine.appendSwitch('disable-features', 'Autofill');

// Specifically for macOS Text Input Method warnings
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'TextInputClient');
  app.commandLine.appendSwitch('disable-background-mode');
}

const { createLogger } = require('./utils/logger');
const WindowStateManager = require('./utils/window-state-manager');
const { autoUpdater } = require('electron-updater');
const electronLog = require('electron-log');
const { createSupabaseClient } = require('./utils/supabase'); // Import Supabase client

// Initialize automatic updates
const setupUpdater = () => {
  electronLog.info('Setting up electron-updater...');
  
  // Configure electron-updater for GitHub releases
  autoUpdater.logger = electronLog;
  autoUpdater.logger.transports.file.level = 'info';
  
  // Only check for updates in packaged app
  if (!app.isPackaged) {
    electronLog.info('Skipping update check in development mode');
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    electronLog.info('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    electronLog.info('Update available.', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    electronLog.info('Update not available.', info);
  });

  autoUpdater.on('error', (err) => {
    electronLog.error('Error in auto-updater. ' + err);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    electronLog.info(log_message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    electronLog.info('Update downloaded', info);
  });
};

// Setup updater only in production
if (app.isPackaged) {
  setupUpdater();
  // Trigger update check on startup
  app.whenReady().then(() => {
    autoUpdater.checkForUpdatesAndNotify();
  });
}

// Create logger for main process
const logger = createLogger('Main');

// Global reference to the server process
let serverProcess;

// Keep a global reference of the window object to prevent garbage collection
let mainWindow;

// Track app quitting state
app.isQuitting = false;

// Declare window state manager variable
let windowStateManager;

// Track window visibility state
let isWindowVisible = true; // Default to true until we can load from state manager
let sessionStartTime; // Variable to store the start time of the interview session

// Microphone permission management
let micPermissionCache = null;       // { ok:true } once granted
let micCheckInFlight   = null;       // Promise while a check is running

// Create temp directory for screenshots
const screenshotDir = path.join(os.tmpdir(), 'app-screenshots');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

// Function to take a screenshot
async function takeScreenshot(processAfterCapture = false) {
  if (!mainWindow) return;
  
  const startTime = Date.now();
  let screenshotPath = "";
  
  try {
    // Immediate UI feedback for better perceived performance
    if (processAfterCapture && mainWindow) {
      mainWindow.webContents.send('processing-screenshot', { message: 'Taking screenshot...' });
    }
    
    // Hide the app window temporarily to avoid it appearing in the screenshot
    const wasVisible = mainWindow.isVisible();
    if (wasVisible) {
      // Save window state before hiding
      windowStateManager.saveState(mainWindow);
      mainWindow.hide();
    }
    
    // Optimized delay - reduced from 50ms to 25ms for faster capture
    await new Promise(resolve => setTimeout(resolve, 25));
    
    // Start screenshot capture and file operations in parallel
    const capturePromise = process.platform === "darwin" 
      ? captureScreenshotMac() 
      : captureScreenshotWindows();
    
    // Generate filename while capture is happening
    const timestamp = Date.now(); // Use numeric timestamp for better performance
    screenshotPath = path.join(screenshotDir, `screenshot-${timestamp}.png`);
    
    // Wait for screenshot capture to complete
    const screenshotBuffer = await capturePromise;
    const captureTime = Date.now();
    logger.debug(`Screenshot capture took: ${captureTime - startTime}ms`);
    
    // Asynchronously clean up old screenshots to avoid blocking
    setImmediate(() => {
      try {
        const MAX_SCREENSHOTS = 3; // Further reduced for better performance
        const screenshotFiles = fs.readdirSync(screenshotDir)
          .filter(file => file.startsWith('screenshot-'))
          .map(file => path.join(screenshotDir, file));
        
        if (screenshotFiles.length > MAX_SCREENSHOTS) {
          // Sort by creation time (oldest first)
          screenshotFiles.sort((a, b) => {
            return fs.statSync(a).mtime.getTime() - fs.statSync(b).mtime.getTime();
          });
          
          const filesToRemove = screenshotFiles.slice(0, screenshotFiles.length - MAX_SCREENSHOTS);
          for (const fileToRemove of filesToRemove) {
            try {
              fs.unlinkSync(fileToRemove);
              logger.debug(`Removed old screenshot: ${fileToRemove}`);
            } catch (error) {
              logger.error(`Error removing old screenshot: ${error}`, error);
            }
          }
        }
      } catch (error) {
        logger.error('Error during screenshot cleanup:', error);
      }
    });
    
    // Save the screenshot to the temp directory
    fs.writeFileSync(screenshotPath, screenshotBuffer);
    
    // Quick file size check
    const stats = fs.statSync(screenshotPath);
    if (stats.size === 0) {
      logger.error('Screenshot file was created but is empty');
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Failed to save screenshot: File is empty' });
      }
      return;
    }
    
    const saveTime = Date.now();
    logger.info(`Screenshot saved: ${screenshotPath} (${stats.size} bytes) - Save took: ${saveTime - captureTime}ms`);
    
    // Show the main window again if it was visible before (no delay for better responsiveness)
    if (wasVisible && mainWindow) {
      mainWindow.show();
      
      // Restore window position and size from saved state
      const savedState = windowStateManager.getState();
      if (savedState.x !== undefined && savedState.y !== undefined) {
        mainWindow.setPosition(savedState.x, savedState.y);
      }
      if (savedState.width && savedState.height) {
        mainWindow.setSize(savedState.width, savedState.height);
      }
    }
    
    // Notify the renderer process that the screenshot was taken
    if (mainWindow) {
      mainWindow.webContents.send('screenshot-taken', { 
        path: screenshotPath, 
        isShortcut: processAfterCapture 
      });
    }
    
    // If processAfterCapture is true, send the screenshot to the server for processing immediately
    if (processAfterCapture && serverProcess) {
      const processingStartTime = Date.now();
      logger.info(`Sending screenshot to server for processing... Total capture time: ${processingStartTime - startTime}ms`);
      
      // Send immediate UI feedback for better perceived performance
      if (mainWindow) {
        mainWindow.webContents.send('processing-screenshot', { 
          message: 'Screenshot captured! Analyzing with AI...',
          captureTime: processingStartTime - startTime,
          status: 'processing',
          timestamp: processingStartTime
        });
      }
      
      // Send with high priority flag and optimized payload for faster processing
      serverProcess.send({ 
        type: 'process-screenshot', 
        data: { 
          path: screenshotPath,
          priority: 'high',
          captureTime: processingStartTime - startTime,
          timestamp: processingStartTime,
          optimize: true // Flag for server to use optimized processing
        } 
      });
    }
    
    return screenshotPath;
  } catch (err) {
    logger.error('Failed to capture screenshot:', err);
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
    
    // Use the screencapture utility on macOS with highly optimized options
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      // Optimized flags for maximum speed:
      // -x: no sound (faster)
      // -t png: PNG format (fastest for our use case)
      // -C: no cursor (faster)
      // -T 0: no delay (immediate capture)
      // -m: only capture main display (faster than all displays)
      execFile('screencapture', ['-x', '-t', 'png', '-C', '-T', '0', '-m', tempPath], {
        timeout: 5000 // 5 second timeout to prevent hanging
      }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    
    // Read the file and return as buffer, then clean up temp file asynchronously
    const buffer = fs.readFileSync(tempPath);
    
    // Clean up temp file asynchronously to avoid blocking
    setImmediate(() => {
      try {
        fs.unlinkSync(tempPath);
      } catch (error) {
        logger.debug('Error cleaning up temp screenshot file:', error);
      }
    });
    
    return buffer;
  } catch (error) {
    logger.error('Error capturing screenshot on macOS:', error);
    throw error;
  }
}

// Platform-specific screenshot capture for Windows
async function captureScreenshotWindows() {
  const captureStartTime = Date.now();
  
  try {
    logger.info('[PERF] Starting Windows screenshot capture...');
    
    // Get screen sources with optimized settings for faster enumeration
    const sourcesStartTime = Date.now();
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'],
      thumbnailSize: { width: 320, height: 240 }, // Much smaller thumbnail for faster enumeration
      fetchWindowIcons: false // Skip window icons for faster processing
    });
    const sourcesTime = Date.now() - sourcesStartTime;
    logger.info(`[PERF] Windows screen sources enumeration took: ${sourcesTime}ms`);
    
    if (sources.length === 0) {
      throw new Error('No screen sources found');
    }
    
    // Get the primary display source (first one is usually primary)
    const primarySource = sources[0];
    const primaryDisplay = screen.getPrimaryDisplay();
    
    // Use a much more efficient approach with minimal window overhead
    const captureStartTime2 = Date.now();
    const captureWindow = new BrowserWindow({
      width: 100, // Minimal size for faster creation
      height: 100,
      show: false,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false, // Prevent throttling
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    try {
      // Capture the primary display directly with optimized settings
      const screenshot = await captureWindow.webContents.capturePage({
        x: 0,
        y: 0,
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height
      });
      
      const captureTime = Date.now() - captureStartTime2;
      logger.info(`[PERF] Windows screen capture took: ${captureTime}ms`);
      
      // Convert to PNG buffer with optimized compression
      const pngBuffer = screenshot.toPNG();
      
      const totalTime = Date.now() - captureStartTime;
      logger.info(`[PERF] Windows screenshot capture completed in ${totalTime}ms`);
      
      return pngBuffer;
    } finally {
      // Ensure window is always closed
      captureWindow.close();
    }
  } catch (error) {
    const totalTime = Date.now() - captureStartTime;
    console.error(`[ERROR] Windows screenshot capture failed after ${totalTime}ms:`, error);
    logger.error('Error capturing screenshot on Windows:', error);
    throw error;
  }
}

// Permission checking functions
function hasMicrophoneAccess() {
  if (process.platform !== 'darwin') return true; // Only check on macOS
  return systemPreferences.getMediaAccessStatus('microphone') === 'granted';
}

function hasScreenRecordingAccess() {
  if (process.platform !== 'darwin') return true; // Only check on macOS
  return systemPreferences.getMediaAccessStatus('screen') === 'granted';
}

async function ensureMicrophoneAccess() {
  if (process.platform === 'darwin') {
    // macOS 15+: Swift AudioCapture handles microphone directly, no system permission check needed
    const isMac15 = isMac15Plus();
    logger.info(`[MIC] macOS version check: isMac15Plus=${isMac15}, platform=${process.platform}, release=${os.release()}`);
    if (isMac15) {
      logger.info('[MIC] Skipping system microphone permission check for macOS 15+');
      return { ok: true, skipped: true };
    }
    
    // macOS < 15: Use existing system permission checking
    if (hasMicrophoneAccess()) return { ok: true };
    
    const asked = await systemPreferences.askForMediaAccess('microphone');
    if (asked) return { ok: true };
    
    // Permission denied
    if (mainWindow) {
      mainWindow.webContents.send('permission-error', 'microphone');
    }
    return { ok: false };
  } else {
    // Windows/Linux: Use getUserMedia checking with proper request correlation
    if (micPermissionCache?.ok) return { ok: true };      // ① cached
    if (micCheckInFlight) return micCheckInFlight;        // ② reuse ongoing
    
    logger.info('[MIC] Checking microphone access via getUserMedia...');
    
    micCheckInFlight = new Promise((resolve) => {
      const requestId = Date.now().toString(36);        // ③ correlate messages
      
      const micStatusHandler = (_e, data) => {
        if (data.id !== requestId) return;              // ignore others
        ipcMain.removeListener('mic-status', micStatusHandler);
        clearTimeout(timer);
        micCheckInFlight = null;
        if (data.ok) micPermissionCache = { ok: true };  // ④ cache success
        resolve({ ok: data.ok });
      };
      
      ipcMain.on('mic-status', micStatusHandler);
      
      // Notify renderer process to perform permission check with request ID
      if (mainWindow) {
        mainWindow.webContents.send('check-microphone-access', { id: requestId });
      } else {
        // If no main window, resolve as false
        ipcMain.removeListener('mic-status', micStatusHandler);
        micCheckInFlight = null;
        resolve({ ok: false });
      }
      
      // Add a timeout to prevent hanging indefinitely
      const timer = setTimeout(() => {
        ipcMain.removeListener('mic-status', micStatusHandler);
        micCheckInFlight = null;
        logger.warn('[MIC] Microphone permission check timed out');
        resolve({ ok: false, timeout: true });
      }, 10000); // 10 second timeout
    });
    
    return micCheckInFlight;
  }
}

async function ensureScreenRecordingAccess() {
  if (process.platform !== 'darwin') return true;
  
  if (hasScreenRecordingAccess()) return true;
  
  const asked = await systemPreferences.askForMediaAccess('screen');
  if (asked) return true;
  
  // Still denied -> tell renderer to show toast
  if (mainWindow) {
    mainWindow.webContents.send('permission-error', 'screen');
  }
  return false;
}

function createWindow() {
  // Ensure we have access to screen module (app is ready at this point)
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Get saved window state from the state manager
  const savedState = windowStateManager ? windowStateManager.getState() : { width: 800, height: 400 };
  
  // Create the browser window with enhanced undetectability features
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: BAR_HEIGHT,          // ⬅️  start collapsed
    x: savedState.x || Math.floor((width - WINDOW_WIDTH) / 2),
    y: savedState.y || height - 450,
    useContentSize: true,        // height excludes title-bar / shadow
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
      sandbox: false,
      preload: (() => {
        let preloadPath;
        
        if (app.isPackaged) {
          // For packaged apps, preload.js is in asarUnpack, so it's in app.asar.unpacked
          if (process.platform === 'darwin') {
            // macOS: app.asar.unpacked is in Contents/Resources/
            preloadPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'preload.js');
          } else {
            // Windows: app.asar.unpacked is in the app directory
            preloadPath = path.join(path.dirname(process.execPath), 'resources', 'app.asar.unpacked', 'preload.js');
          }
        } else {
          // Development mode
          preloadPath = path.join(__dirname, 'preload.js');
        }
        
        if (!fs.existsSync(preloadPath)) {
          console.error('[FATAL] preload.js missing at', preloadPath);
          console.error('[DEBUG] Checked paths:');
          console.error('  - app.isPackaged:', app.isPackaged);
          console.error('  - process.platform:', process.platform);
          console.error('  - process.resourcesPath:', process.resourcesPath);
          console.error('  - process.execPath:', process.execPath);
          console.error('  - __dirname:', __dirname);
          app.quit();
        }
        return preloadPath;
      })(),
      backgroundThrottling: false, // Prevent throttling when in background
      paintWhenInitiallyHidden: true, // Ensure rendering happens even when hidden
    },
    show: true // Show window immediately instead of waiting for ready-to-show
  });

  // Apply platform-specific undetectability settings
  if (process.platform === 'darwin') {
    // macOS specific settings
    mainWindow.setHiddenInMissionControl(true); // Hide from Mission Control
  }

  // Enable content protection to prevent screen capture
  mainWindow.setContentProtection(true);

  // Load index.html directly
  mainWindow.loadFile(path.join(__dirname, 'index.html'));


  // Open DevTools only in development mode
  // if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
  // 
  //}

  mainWindow.webContents.openDevTools();

  // Set up window state tracking
  windowStateManager.trackWindow(mainWindow);
  
  // Watch for preload failures
  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    logger.error('Preload failed:', preloadPath, error);
  });
  
  // Handle window state after creation
  mainWindow.once('ready-to-show', () => {
    logger.info('Window ready-to-show event fired');
    
    // Apply saved minimized state if needed
    if (savedState.isMinimized) {
      mainWindow.minimize();
      isWindowVisible = false;
    } else {
      isWindowVisible = true;
    }
  });

  // Emitted when the window is closed
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
  
  // Handle window state events
  mainWindow.on('minimize', () => {
    isWindowVisible = false;
    logger.debug('Window minimized');
  });
  
  mainWindow.on('restore', () => {
    isWindowVisible = true;
    logger.debug('Window restored');
  });
  
  mainWindow.on('show', () => {
    isWindowVisible = true;
    logger.debug('Window shown');
  });
  
  mainWindow.on('hide', () => {
    isWindowVisible = false;
    logger.debug('Window hidden');
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

  /* ——— IPC handlers for window resizing ——— */
  ipcMain.on('ui-expand', () => {
    if (mainWindow) {
      mainWindow.setSize(WINDOW_WIDTH, EXPANDED_HEIGHT, true);   // instant resize
    }
  });
  ipcMain.on('ui-collapse', () => {
    if (mainWindow) {
      mainWindow.setSize(WINDOW_WIDTH, BAR_HEIGHT, true);
    }
  });
  
  // Handle start recording button click
  ipcMain.on('start-recording', async (event, data) => { // Make handler async
  if (serverProcess) {
    logger.info('Received start-recording request from renderer');
    
    // Check permissions first
    const hasMic = await ensureMicrophoneAccess();
    const hasScreen = await ensureScreenRecordingAccess();
    
    if (!hasMic || !hasScreen) {
      logger.warn('Recording cancelled due to missing permissions');
      return;
    }
      // Get the user ID from the auth service (ensure authService is initialized)
      const userId = authService?.getSession()?.user?.id;
      
      if (!userId) {
        logger.warn('User ID not available, cannot start recording');
        if (mainWindow) {
          mainWindow.webContents.send('error', { message: 'User ID is required to start an interview' });
        }
        return;
      }
      
      // Verify user's plan status with immediate error feedback
      let planStatus;
      try {
        planStatus = await getPlanStatus(userId);
        
        if (!planStatus.canStart) {
          // User cannot start an interview due to plan limitations
          logger.info(`User ${userId} cannot start recording: ${planStatus.reason}`);
          if (mainWindow) {
             // Send error event for status bar display
             mainWindow.webContents.send('error', { 
               message: `Plan limit reached: ${planStatus.reason || 'Unable to start interview due to plan limitations'}`,
               type: 'plan-limit'
             });
             
             logger.info('Sent plan limit error to renderer process');
           }
          return;
        }
      } catch (planError) {
        logger.error('Error checking plan status:', planError);
        if (mainWindow) {
          mainWindow.webContents.send('error', { 
            message: 'Unable to verify plan status. Please try again.',
            type: 'plan-limit'
          });
        }
        return;
      }
      
      // First retrieve any saved context for this user (before starting recording)
      logger.info('Retrieving saved context before starting interview');
      
      // Use a timeout to ensure context is processed before starting recording
      const contextTimeout = setTimeout(() => {
        logger.info('Context retrieval timeout - proceeding with interview start');
        startInterviewRecording();
      }, 3000); // 3 second timeout
      
      // Function to start the actual recording
      const startInterviewRecording = () => {
        clearTimeout(contextTimeout);
        
        // Record the session start time
        sessionStartTime = new Date();
        logger.info(`Session started at: ${sessionStartTime.toISOString()}`); // Log start time
        
        // Send the start-recording message to server process
        serverProcess.send({ 
          type: 'start-recording',
          data: { ...data, userId } // Merge incoming data with userId
        });
      };
      
      // Set up a one-time listener for context response
      const contextResponseHandler = (message) => {
        if (message.type === 'context-update' || message.type === 'error') {
          process.removeListener('message', contextResponseHandler);
          logger.info('Context processing completed - starting interview');
          startInterviewRecording();
        }
      };
      
      process.on('message', contextResponseHandler);
      
      // Send context retrieval request
      serverProcess.send({ 
        type: 'retrieve-context', 
        data: { userId }
      });
      
      // Send recording status update to the renderer
      if (mainWindow) {
        mainWindow.webContents.send('recording-status', { 
          isRecording: true,
          plan: planStatus.plan // Include plan info in the response
        });
      }
      
      // Set a timer to automatically stop recording after the plan's time limit
      // Free plan users have a 5-minute limit
      if (planStatus.plan.type === 'free') {
        const freeMinutesLimit = 5;
        const timeoutMs = freeMinutesLimit * 60 * 1000;
        
        logger.info(`Setting recording time limit: ${freeMinutesLimit} minutes for free plan user`);
        
        // Set a timer to stop recording after the time limit
        setTimeout(() => {
          if (serverProcess) {
            logger.info(`Time limit reached (${freeMinutesLimit} minutes). Automatically stopping recording for free plan user.`);
            serverProcess.send({ type: 'stop-recording' });
            
            // Notify the user that their time limit has been reached
            if (mainWindow) {
              mainWindow.webContents.send('time-limit-reached', {
                message: `Your free plan time limit of ${freeMinutesLimit} minutes has been reached.`,
                plan: planStatus.plan
              });
            }
          }
        }, timeoutMs);
      }
      
      // Note: Session will be created in Supabase when recording stops with both start and end times
      logger.info('Session will be saved to Supabase when recording stops');
      
      // If this is a non-unlimited plan, decrement the interview count
      if (planStatus.plan.interviewsRemaining > 0) {
        try {
          await decrementInterviewCount(userId);
        } catch (error) {
          logger.error('Failed to decrement interview count:', error);
          // Continue with the interview even if decrementing fails
        }
      }
    } else {
      logger.warn('Server process not ready, cannot start recording');
      if (mainWindow) {
          mainWindow.webContents.send('error', { message: 'Server process not available.' });
      }
    }
  });
  
  // Handle stop recording button click
  ipcMain.on('stop-recording', async (event) => {
    if (serverProcess) {
      logger.info('Received stop-recording request from renderer');
      serverProcess.send({ type: 'stop-recording' });

      if (mainWindow) {
        mainWindow.webContents.send('recording-status', { isRecording: false });
      }

      // Clear microphone permission cache to force fresh check next time
      micPermissionCache = null;
      logger.debug('[MIC] Cleared permission cache on recording stop');

      // Record session end time
      const sessionEndTime = new Date();
      logger.info(`Session ended at: ${sessionEndTime.toISOString()}`);

      // Create the complete session record in Supabase now that we have both start and end times
      if (sessionStartTime && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
        try {
          const supabase = createSupabaseClient();
          const userId = authService?.getSession()?.user?.id;
          
          if (userId) {
            logger.info('Creating complete interview session in Supabase...');
            
            // Insert the complete session with both start and end times
            const { data, error } = await supabase
              .from('interview_sessions')
              .insert([
                {
                  user_id: userId,
                  start_time: sessionStartTime,
                  end_time: sessionEndTime
                }
              ])
              .select();
              
            if (error) {
              logger.error('Error creating session in Supabase:', error);
              if (mainWindow) {
                mainWindow.webContents.send('error', { message: `Error saving interview session: ${error.message}` });
              }
            } else {
              logger.info('Interview session created successfully in Supabase:', data);
              if (mainWindow) {
                mainWindow.webContents.send('interview-session-saved', { userId });
              }
            }
          }
        } catch (dbError) {
          logger.error('Error creating session:', dbError);
          if (mainWindow) {
            mainWindow.webContents.send('error', { message: `Error saving interview session: ${dbError.message}` });
          }
        }
      }
      
      // Reset session start time for the next session
      sessionStartTime = null;
      logger.info('Session start time reset.');

    } else {
      logger.warn('Server process not ready, cannot stop recording');
      if (mainWindow) {
          mainWindow.webContents.send('error', { message: 'Server process not available.' });
      }
    }
  });

  // Microphone capture handlers for older macOS versions
  ipcMain.on('start-microphone-capture', (event) => {
    if (serverProcess) {
      logger.info('Forwarding start-microphone-capture to server process');
      serverProcess.send({ type: 'start-microphone-capture' });
    }
  });

  ipcMain.on('stop-microphone-capture', (event) => {
    if (serverProcess) {
      logger.info('Forwarding stop-microphone-capture to server process');
      serverProcess.send({ type: 'stop-microphone-capture' });
    }
  });

  ipcMain.on('start-windows-audio-capture', (event) => {
    logger.info('[WINDOWS-AUDIO] [DEBUG] received start start-windows-audio-capture');
  if (serverProcess) {
    logger.info('[WINDOWS-AUDIO] Received start-windows-audio-capture from renderer');
    logger.info('[WINDOWS-AUDIO] Forwarding start-windows-audio-capture to server process');
    serverProcess.send({ type: 'start-windows-audio-capture' });
  } else {
    logger.error('[WINDOWS-AUDIO] Cannot forward start-windows-audio-capture: server process not available');
  }
});

ipcMain.on('stop-windows-audio-capture', (event) => {
  if (serverProcess) {
    logger.info('Forwarding stop-windows-audio-capture to server process');
    serverProcess.send({ type: 'stop-windows-audio-capture' });
  }
});

  ipcMain.on('microphone-data', (event, audioData) => {
    // Convert ArrayBuffer to Buffer for IPC transmission
    const audioBuffer = Buffer.from(audioData);
    logger.info(`🔍 [DEBUG] Main received microphone-data from renderer: ${audioBuffer.length} bytes`);
    if (serverProcess) {
      logger.info(`🔍 [DEBUG] Main forwarding microphone-data to server`);
      serverProcess.send({ type: 'microphone-data', data: audioBuffer });
    } else {
      logger.error(`⚠️ [DEBUG] Main cannot forward microphone-data - no serverProcess`);
    }
  });

  ipcMain.on('system-audio-data', (event, audioData) => {
    // Convert ArrayBuffer to Buffer for IPC transmission
    const audioBuffer = Buffer.from(audioData);
    logger.info(`🔍 [DEBUG] Main received system-audio-data from renderer: ${audioBuffer.length} bytes`);
    if (serverProcess) {
      logger.info(`🔍 [DEBUG] Main forwarding system-audio-data to server`);
      serverProcess.send({ type: 'system-audio-data', data: audioBuffer });
    } else {
      logger.error(`⚠️ [DEBUG] Main cannot forward system-audio-data - no serverProcess`);
    }
  });

  ipcMain.on('microphone-audio-meta', (event, metadata) => {
    logger.info(`[WINDOWS-AUDIO] Microphone metadata:`, metadata);
    if (serverProcess) {
      serverProcess.send({ type: 'microphone-audio-meta', data: metadata });
    }
  });

  ipcMain.on('system-audio-meta', (event, metadata) => {
    logger.info(`[WINDOWS-AUDIO] System audio metadata:`, metadata);
    if (serverProcess) {
      serverProcess.send({ type: 'system-audio-meta', data: metadata });
    }
  });

  ipcMain.on('windows-audio-capture-success', (event) => {
    logger.info('[WINDOWS-AUDIO] Audio capture started successfully in renderer');
  });

  ipcMain.on('windows-audio-capture-error', (event, errorData) => {
    logger.error('[WINDOWS-AUDIO] Audio capture failed in renderer:', errorData);
  });

  ipcMain.on('system-audio-missing', (event) => {
    logger.warn('[WINDOWS-AUDIO] System audio stream missing - no system audio available');
    if (serverProcess) {
      serverProcess.send({ type: 'system-audio-missing' });
    }
  });

  
  // Handle send to server
  ipcMain.on('send-to-server', async (event, message) => {
    if (serverProcess) {
      // Forward messages directly to server process
    serverProcess.send(message);
  } else if (message.type === 'finalize-interview-session') {
    logger.info('[Main] Received finalize-interview-session from server process:', message.data);
    const userId = authService?.getSession()?.user?.id;

    if (!userId) {
      logger.error('[Main] User ID not available. Cannot save interview session details received from server.');
      return;
    }

    if (!message.data || !message.data.startTime || !message.data.endTime) {
      logger.error('[Main] Incomplete session data received from server. Cannot save interview session.');
      return;
    }

    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const supabase = createSupabaseClient();
        logger.info('[Main] Updating final interview session details in Supabase...');
        
        // Update the most recent session for this user that matches the start time 
        // or doesn't have an end time yet.
        // Using startTime from message.data to be more specific if possible,
        // otherwise falling back to the logic similar to stop-recording.
        const { data, error } = await supabase
          .from('interview_sessions')
          .update({
            end_time: message.data.endTime,
            // duration_ms and formatted_duration could also be stored if the schema supports it
          })
          .match({ user_id: userId, start_time: message.data.startTime }) // Try to match with startTime first
          .is('end_time', null) // Ensure we only update sessions that are not yet ended
          .order('start_time', { ascending: false })
          .limit(1);

        if (error) {
          logger.error('[Main] Error updating session details in Supabase:', error);
          // Optionally, try updating without matching startTime if the first attempt fails
          // This would be similar to the original stop-recording logic
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('interview_sessions')
            .update({ end_time: message.data.endTime })
            .match({ user_id: userId })
            .is('end_time', null)
            .order('start_time', { ascending: false })
            .limit(1);
          if (fallbackError) {
            logger.error('[Main] Fallback error updating session details in Supabase:', fallbackError);
          }
        } else {
          if (data && data.length > 0) {
             logger.info('[Main] Interview session details updated in Supabase successfully via server message.');
          } else {
             logger.warn('[Main] No matching session found to update in Supabase via server message, or already updated.');
          }
        }
      } catch (dbError) {
        logger.error('[Main] Supabase client or update operation failed for finalize-interview-session:', dbError);
      }
    } else {
      logger.warn('[Main] Supabase URL or Anon Key not configured. Skipping session finalization in DB.');
    }

  } else {
    logger.error('Server process not available');
      if (mainWindow) {
        mainWindow.webContents.send('error', { 
          message: 'Server process is not available. Please restart the application.' 
        });
      }
    }
  });
  
  // Handle process-file-content request (legacy method, kept for backward compatibility)
  ipcMain.on('process-file-content', (event, data) => {
    if (serverProcess) {
      logger.info(`Processing file content for ${data.fileName}`);
      
      // Send the file path directly to the server process
      if (data.filePath && data.fileName) {
        try {
          // Send the file path to the server process
          serverProcess.send({
            type: 'process-file-content',
            data: { 
              filePath: data.filePath, 
              fileName: data.fileName 
            }
          });
          
          // Update the UI
          if (mainWindow) {
            mainWindow.webContents.send('context-update', { 
              message: `File sent for processing: ${data.fileName}` 
            });
          }
        } catch (error) {
          logger.error('Error sending file path to server:', error);
          if (mainWindow) {
            mainWindow.webContents.send('error', { 
              message: `Error processing file: ${error.message}` 
            });
          }
        }
      }
    } else {
      logger.error('Server process not available');
      if (mainWindow) {
        mainWindow.webContents.send('error', { 
          message: 'Server process is not available. Please restart the application.' 
        });
      }
    }
  });
  
  // Handle create-temp-file request for unified file context handling
  ipcMain.handle('create-temp-file', async (event, fileData) => {
    logger.info(`Creating temporary file for: ${fileData.fileName}`);
    try {
      // Create a temporary file with the content
      const tempDir = path.join(app.getPath('temp'), 'interm-app');
      
      // Ensure the temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Create a unique filename
      const tempFilePath = path.join(tempDir, `${Date.now()}-${fileData.fileName}`);
      
      // Write the file content
      const buffer = Buffer.from(new Uint8Array(fileData.fileContent));
      fs.writeFileSync(tempFilePath, buffer);
      
      logger.info(`Created temporary file at: ${tempFilePath}`);
      return tempFilePath;
    } catch (error) {
      logger.error('Error creating temporary file:', error);
      throw error;
    }
  });
  
  // Handle hotkey actions from global shortcuts
  ipcMain.on('trigger-ai-button', (event) => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-ai-button');
    }
  });
  
  ipcMain.on('trigger-transcript-toggle', (event) => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-transcript-toggle');
    }
  });
  
  ipcMain.on('trigger-copy-ai-text', (event) => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-copy-ai-text');
    }
  });
  
}
  
  // Handle set context from text
  ipcMain.on('set-context-text', (event, text) => {
    if (serverProcess) {
      logger.info('Received set-context-text request from renderer');
      serverProcess.send({ type: 'set-context', data: { text } });
      
      // Notify the renderer that the context is being processed
      if (mainWindow) {
        mainWindow.webContents.send('context-update', { 
          message: 'Processing text context...' 
        });
      }
    } else {
      logger.error('Server process not available, cannot set text context');
      if (mainWindow) {
        mainWindow.webContents.send('error', { 
          message: 'Server process is not available. Please restart the application.' 
        });
      }
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
  
  // Handle elaboration request
  ipcMain.on('elaborate', (event, message) => {
    logger.info('[IPC] Main process received elaborate request:', message);
    if (serverProcess) {
      serverProcess.send({ type: 'elaborate', data: { message } });
    }
  });
  
  // Handle get-suggestion request
  ipcMain.on('get-suggestion', (event, data) => {
    logger.info('[IPC] Main process received get-suggestion request:', data);
    if (serverProcess) {
      logger.info('[IPC] Forwarding get-suggestion request to server process');
      serverProcess.send({ type: 'get-suggestion', data });
    } else {
      logger.error('[IPC] Cannot forward get-suggestion request: server process not available');
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Server process is not available. Please restart the application.' });
      }
    }
  });
  
  // Handle check-plan-status request directly in main process
  ipcMain.on('check-plan-status', async (event, data) => {
    logger.info('Received check-plan-status request from renderer');
    const userId = data?.userId || authService?.getSession()?.user?.id;
    
    if (!userId) {
      logger.warn('User ID not available, cannot check plan status');
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'User ID is required to check plan status' });
      }
      return;
    }
    
    try {
      const planStatus = await getPlanStatus(userId);
      
      // Send plan status back to the renderer
      if (mainWindow) {
        mainWindow.webContents.send('plan-status', {
          canStart: planStatus.canStart,
          reason: planStatus.reason,
          plan: planStatus.plan
        });
      }
    } catch (error) {
      logger.error('Error checking plan status:', error);
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Failed to check plan status' });
      }
    }
  });

  // Function to load saved context from database
async function loadSavedContext(userId) {
  if (!userId) {
    logger.warn('Cannot load saved context: No user ID provided');
    return null;
  }
  
  try {
    logger.info(`Loading saved context for user: ${userId}`);
    const supabase = createSupabaseClient();
    
    // Query the user_contexts table for the most recent context
    const { data, error } = await supabase
      .from('user_contexts')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);
    
    if (error) {
      logger.error('Error loading context from database:', error);
      return null;
    }
    
    // Log the full data response for debugging
    // logger.info(`Database query result: ${JSON.stringify(data)}`);
    
    if (data && data.length > 0) {
      // Log the first item structure
      // logger.info(`First item in data: ${JSON.stringify(data[0])}`);
      
      // Check if the context field exists in the data
      if (data[0].hasOwnProperty('content')) {
        // If the field is named 'content' instead of 'context'
        const contextData = data[0].content;
        logger.info(`Found context data in 'content' field`);
        if (contextData) {
          logger.info(`Found saved context in database, length: ${contextData.length}`);
          logger.info(`Context preview: ${contextData.substring(0, 50)}...`);
          return contextData;
        }
      } else if (data[0].hasOwnProperty('context')) {
        // If the field is named 'context' as expected
        const contextData = data[0].context;
        logger.info(`Found context data in 'context' field`);
        if (contextData) {
          logger.info(`Found saved context in database, length: ${contextData.length}`);
          logger.info(`Context preview: ${contextData.substring(0, 50)}...`);
          return contextData;
        }
      } else {
        // Log all available fields in the data
        logger.warn('Neither context nor content field found in data');
        logger.info(`Available fields: ${Object.keys(data[0]).join(', ')}`);
      }
      
      // If we reach here, context data is null, undefined, or not found
      logger.warn('Context data is null, undefined, or field not found');
      return null;
    } else {
      logger.info('No saved context found for user');
      return null;
    }
  } catch (error) {
    logger.error('Exception loading context from database:', error);
    return null;
  }
}

// Handle load context request
ipcMain.handle('load-context', async () => {
  const userId = authService?.getSession()?.user?.id;
  if (!userId) {
    logger.warn('Cannot load context: No authenticated user');
    return { success: false, message: 'Authentication required' };
  }
  
  try {
    logger.info(`Attempting to load context for user: ${userId}`);
    const savedContext = await loadSavedContext(userId);
    
    // Log the savedContext value for debugging
    logger.info(`Saved context type: ${typeof savedContext}`);
    logger.info(`Saved context is null: ${savedContext === null}`);
    logger.info(`Saved context is undefined: ${savedContext === undefined}`);
    
    if (savedContext) {
      // Add null check before accessing length
      logger.info(`Context loaded successfully, length: ${savedContext.length}`);
      
      // If context exists, send it to the server process
      if (serverProcess) {
        logger.info('Sending loaded context to server process');
        serverProcess.send({ type: 'set-context', data: { text: savedContext } });
      }
      
      // Also send a context-update event to the renderer to ensure UI is updated
      if (mainWindow) {
        logger.info('Sending context-update event to renderer process');
        mainWindow.webContents.send('context-update', { 
          message: 'Context loaded from database',
          context: savedContext
        });
      }
      
      return { success: true, context: savedContext };
    } else {
      logger.info('No saved context found for user');
      
      // Send an empty context update to the renderer to ensure UI is updated
      if (mainWindow) {
        logger.info('Sending empty context-update event to renderer process');
        mainWindow.webContents.send('context-update', { 
          message: 'No saved context found',
          context: ''
        });
      }
      
      return { success: false, message: 'No saved context found' };
    }
  } catch (error) {
    logger.error('Error in load-context handler:', error);
    
    // Send error to renderer
    if (mainWindow) {
      mainWindow.webContents.send('error', { 
        message: `Error loading context: ${error.message}`
      });
    }
    
    return { success: false, message: error.message };
  }
});

// Handle save context request
ipcMain.on('save-context', async (event, context) => {
  const userId = authService?.getSession()?.user?.id;
  if (!userId || !context) {
    logger.warn('Cannot save context: Missing user ID or context');
    if (mainWindow) {
      mainWindow.webContents.send('error', { message: 'Cannot save context: Authentication required' });
    }
    return;
  }
  
  try {
    logger.info(`Saving context for user: ${userId}`);
    const supabase = createSupabaseClient();
    
    // Insert or update the context in the user_contexts table
    const { data, error } = await supabase
      .from('user_contexts')
      .upsert({
        user_id: userId,
        context: context,
        updated_at: new Date()
      });
    
    if (error) {
      logger.error('Error saving context to database:', error);
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: `Failed to save context: ${error.message}` });
      }
    } else {
      logger.info('Context saved successfully');
      if (mainWindow) {
        mainWindow.webContents.send('context-saved', { success: true });
      }
    }
  } catch (error) {
    logger.error('Exception saving context to database:', error);
    if (mainWindow) {
      mainWindow.webContents.send('error', { message: `Exception saving context: ${error.message}` });
    }
  }
});

// Handle delete context request
ipcMain.on('delete-context', async (event) => {
  const userId = authService?.getSession()?.user?.id;
  if (!userId) {
    logger.warn('Cannot delete context: No authenticated user');
    if (mainWindow) {
      mainWindow.webContents.send('error', { message: 'Authentication required to delete context' });
    }
    return;
  }
  
  try {
    logger.info(`Deleting context for user: ${userId}`);
    const supabase = createSupabaseClient();
    
    // First check if there's any context to delete
    const { data: existingData, error: queryError } = await supabase
      .from('user_contexts')
      .select('id')
      .eq('user_id', userId);
      
    if (queryError) {
      logger.error('Error querying context before deletion:', queryError);
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: `Failed to query context: ${queryError.message}` });
      }
      return;
    }
    
    logger.info(`Found ${existingData ? existingData.length : 0} context entries to delete`);
    
    if (!existingData || existingData.length === 0) {
      logger.info('No context found to delete');
      if (mainWindow) {
        mainWindow.webContents.send('context-update', { 
          message: 'No context found to delete',
          context: ''
        });
      }
      return;
    }
    
    // Delete the context from the user_contexts table
    const { error } = await supabase
      .from('user_contexts')
      .delete()
      .eq('user_id', userId);
    
    if (error) {
      logger.error('Error deleting context from database:', error);
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: `Failed to delete context: ${error.message}` });
      }
    } else {
      logger.info('Context deleted successfully');
      
      // Clear context in server process
      if (serverProcess) {
        logger.info('Sending clear-context message to server process');
        serverProcess.send({ type: 'clear-context' });
      }
      
      // Notify renderer that context was deleted
      if (mainWindow) {
        logger.info('Sending context-update event to renderer process');
        mainWindow.webContents.send('context-update', { 
          message: 'Context deleted',
          context: ''
        });
      }
    }
  } catch (error) {
    logger.error('Exception deleting context from database:', error);
    if (mainWindow) {
      mainWindow.webContents.send('error', { message: `Exception deleting context: ${error.message}` });
    }
  }
});

// Handle set context from file
  ipcMain.on('set-context-file', (event, filePath) => {
    logger.info('Received file path in main process:', filePath);
    
    // If the file path is just a filename (not a full path), we need to handle it differently
    if (!filePath.includes('/') && !filePath.includes('\\')) {
      logger.warn('File path appears to be just a filename, not a full path');
      // In a real implementation, you might want to show a dialog to select the file
      // For now, we'll just send an error back to the renderer
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Could not access full file path. Please try again.' });
      }
      return;
    }
    
    if (serverProcess) {
      logger.info('Sending file context to server process');
      serverProcess.send({ type: 'process-file-content', data: { filePath: filePath } });
      
      // Extract filename from path for display
      const fileName = filePath.split(/[\/\\]/).pop();
      
      // Notify the renderer that the context is being processed
      if (mainWindow) {
        mainWindow.webContents.send('context-update', { 
          message: `Processing file context: ${fileName}` 
        });
      }
    } else {
      logger.error('Server process not available, cannot set file context');
      if (mainWindow) {
        mainWindow.webContents.send('error', { 
          message: 'Server process is not available. Please restart the application.' 
        });
      }
    }
  });
  
  // Handle opening external links in default browser
  ipcMain.on('open-external', (event, url) => {
    const { shell } = require('electron');
    shell.openExternal(url)
      .then(() => {
        logger.info(`External URL opened successfully: ${url}`);
      })
      .catch(err => {
        logger.error(`Error opening external URL: ${url}`, err);
        if (mainWindow) {
          mainWindow.webContents.send('error', { message: `Failed to open URL: ${err.message}` });
        }
      });
  });

  // Handle take-screenshot IPC message
  ipcMain.on('take-screenshot', () => {
    logger.info('Screenshot requested via IPC');
    takeScreenshot(false); // processAfterCapture = false for manual screenshots
  });


// Import the AuthService class
const AuthService = require('./services/auth-service');

// Plan verification functions
/**
 * Get the user's plan status
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} The plan status
 */
async function getPlanStatus(userId) {
  try {
    const supabase = createSupabaseClient();
    
    // Get the user's plan
    const { data: plan, error } = await supabase
      .from('user_plans')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error && error.code !== 'PGRST116') {
      console.error(`[Plan] Supabase query error:`, error);
      throw error;
    }
    
    // If no plan is found, return a default free plan
    const userPlan = plan || {
      user_id: userId,
      plan_type: 'free',
      interviews_remaining: 10,
      minutes_per_interview: 5,
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const isExpired = userPlan.expires_at ? new Date(userPlan.expires_at) < new Date() : false;
    const isUnlimited = userPlan.plan_type === 'guaranteed_job' || userPlan.interviews_remaining === -1;

    // Check if plan is expired (only applies to guaranteed job plan)
    if (userPlan.plan_type === 'guaranteed_job' && isExpired) {
      return {
        canStart: false,
        reason: 'Your guaranteed job plan has expired',
        plan: {
          type: userPlan.plan_type,
          interviewsRemaining: 0,
          minutesPerInterview: 0,
          isExpired: true,
          expiresAt: userPlan.expires_at
        }
      };
    }

    // Check remaining interviews for non-unlimited plans
    if (!isUnlimited && userPlan.interviews_remaining <= 0) {
      return {
        canStart: false,
        reason: `You've used all your interviews for this plan, `,
        plan: {
          type: userPlan.plan_type,
          interviewsRemaining: 0,
          minutesPerInterview: userPlan.minutes_per_interview,
          isExpired: false,
          expiresAt: userPlan.expires_at
        }
      };
    }

    return {
      canStart: true,
      plan: {
        type: userPlan.plan_type,
        interviewsRemaining: isUnlimited ? -1 : userPlan.interviews_remaining,
        minutesPerInterview: userPlan.minutes_per_interview,
        isExpired: false,
        expiresAt: userPlan.expires_at
      }
    };
  } catch (error) {
    console.error('Error checking plan status:', error);
    return {
      canStart: false,
      reason: 'Unable to verify plan status',
      plan: {
        type: 'unknown',
        interviewsRemaining: 0,
        minutesPerInterview: 0,
        isExpired: false,
        expiresAt: null
      }
    };
  }
}

/**
 * Decrement the interview count for a user
 * @param {string} userId - The user ID
 * @returns {Promise<void>}
 */
async function decrementInterviewCount(userId) {
  try {
    const supabase = createSupabaseClient();
    
    // First, get the current plan to check the interviews_remaining count
    const { data: plan, error: fetchError } = await supabase
      .from('user_plans')
      .select('interviews_remaining')
      .eq('user_id', userId)
      .maybeSingle();
    
    if (fetchError) throw fetchError;
    
    // Don't decrement if plan doesn't exist or has unlimited interviews (-1)
    if (!plan || plan.interviews_remaining === -1) {
      logger.info(`[Plan] Not decrementing interviews for user ${userId}: ${!plan ? 'no plan found' : 'unlimited plan'}`);
      return;
    }
    
    // Update with the decremented value
    const { error: updateError } = await supabase
      .from('user_plans')
      .update({
        interviews_remaining: plan.interviews_remaining - 1,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
    
    if (updateError) throw updateError;
  } catch (error) {
    console.error('Error decrementing interview count:', error);
    throw error;
  }
}

// Create an instance of the AuthService
let authService = null;

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  // Force-allow media permissions in Electron (bypasses Chrome UI)
  const { session } = require('electron');
  
  // A. Grant new permission requests
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      logger.info('[PERMISSION] Granting media permission (microphone/camera)');
      return callback(true);   // always grant mic/camera
    }
    callback(false);
  });
  
  // B. Override Chromium's "remembered" deny from earlier runs (required for Electron 25+)
  session.defaultSession.setPermissionCheckHandler((_webContents, _permission) => {
    // Returning 'granted' skips the internal deny cache
    return 'granted';
  });
  
  // C. Set up audio loopback for system audio capture without Stereo Mix
  logger.info('[AUDIO-LOOPBACK] Setting up display media request handler for audio loopback');
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    logger.info('[AUDIO-LOOPBACK] Display media request received');
    
    // Get available screen sources
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      logger.info(`[AUDIO-LOOPBACK] Found ${sources.length} screen sources`);
      
      if (sources.length > 0) {
        // Use the first screen source with audio loopback
        logger.info('[AUDIO-LOOPBACK] Granting audio loopback access');
        callback({
          video: sources[0],
          audio: 'loopback'  // This enables system audio capture at OS level
        });
      } else {
        logger.warn('[AUDIO-LOOPBACK] No screen sources found');
        callback({});
      }
    }).catch((error) => {
      logger.error('[AUDIO-LOOPBACK] Error getting screen sources:', error);
      callback({});
    });
  }, { useSystemPicker: false });
  
  // Initialize window state manager after app is ready
  windowStateManager = new WindowStateManager({
    defaultWidth: 800,
    defaultHeight: 400
  });
  
  // Now we can safely get the window state
  isWindowVisible = windowStateManager.getState().isVisible;
  // Set up a periodic check to ensure window is accessible
  // This helps recover windows that have been minimized for a long time
  setInterval(() => {
    if (mainWindow && !app.isQuitting) {
      // Check if window state indicates it should be visible but isn't
      const savedState = windowStateManager.getState();
      if (savedState.isVisible && !mainWindow.isVisible()) {
        logger.info("Window should be visible but isn't - restoring");
        mainWindow.show();
        isWindowVisible = true;
        
        // Ensure window is on screen
        const displays = screen.getAllDisplays();
        const currentPosition = mainWindow.getPosition();
        let isOnScreen = false;
        
        for (const display of displays) {
          const bounds = display.bounds;
          if (
            currentPosition[0] >= bounds.x && 
            currentPosition[1] >= bounds.y && 
            currentPosition[0] < bounds.x + bounds.width && 
            currentPosition[1] < bounds.y + bounds.height
          ) {
            isOnScreen = true;
            break;
          }
        }
        
        // If window is off-screen, center it on primary display
        if (!isOnScreen) {
          const primaryDisplay = screen.getPrimaryDisplay();
          const { width, height } = primaryDisplay.workAreaSize;
          const windowSize = mainWindow.getSize();
          
          mainWindow.setPosition(
            Math.floor((width - windowSize[0]) / 2),
            Math.floor((height - windowSize[1]) / 2)
          );
        }
      }
    }
  }, 60000); // Check every minute
  // Set up IPC handlers for update-related events
  ipcMain.handle('check-for-updates', () => {
    logger.info('Checking for updates...');
    // The actual check is handled by update-electron-app automatically
    // This handler is just for the renderer to trigger manual checks
    return { checking: true };
  });
  
  ipcMain.handle('get-version', () => {
    return app.getVersion();
  });
  
  ipcMain.handle('get-os-version', () => {
    return os.release();
  });
  
  ipcMain.handle('download-update', () => {
    logger.info('Download update requested');
    // update-electron-app handles downloads automatically
    return { downloading: true };
  });
  
  ipcMain.handle('install-update', () => {
    logger.info('Install update requested');
    // update-electron-app handles installation automatically when app restarts
    return { willInstallOnRestart: true };
  });
  // Initialize the auth service
  authService = new AuthService();
  
  // Handle auth events
  authService.on('auth-success', (session) => {
    if (mainWindow) {
      mainWindow.webContents.send('auth-success', session);
      mainWindow.webContents.send('ready', { message: 'Authentication successful' });
    }
  });
  

  
  authService.on('auth-error', (message) => {
    if (mainWindow) {
      mainWindow.webContents.send('auth-error', { message });
    }
  });
  
  authService.on('subscription-error', (message) => {
    if (mainWindow) {
      // Send a message about free plan instead of requiring purchase
      mainWindow.webContents.send('auth-error', { 
        message: 'You are using the free plan with rate limits. Upgrade for full features.', 
        isSubscriptionError: true,
        subscriptionUrl: 'https://interm.ai/'
      });
    }
  });
  
  // Initialize auth service and check for existing session
  logger.info('Initializing auth service and checking for existing session');
  const hasValidSession = await authService.initialize();
  
  if (hasValidSession) {
    logger.info('Valid session found, user is already authenticated');
  } else {
    logger.info('No valid session found, user needs to authenticate');
    // Notify the renderer process that authentication is required
    if (mainWindow) {
      setTimeout(() => {
        mainWindow.webContents.send('auth-required', { message: 'Authentication required' });
      }, 1000); // Short delay to ensure window is ready
    }
  }
  
  // Register the complete-login handler
  ipcMain.handle('complete-login', async (event, data) => {
    logger.info('[AUTH] Handling complete-login request');
    try {
      const { email, password } = data;
      const success = await authService.signInWithEmailPassword(email, password);
      return { success };
    } catch (error) {
      logger.error('[AUTH] Error in complete-login handler:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Handle sign-in request
  ipcMain.handle('sign-in', async (event, data) => {
    try {
      logger.info('Received sign-in request');
      
      if (!authService) {
        logger.warn('No auth service available for sign-in');
        return { success: false, error: 'Authentication service not available' };
      }
      
      const { email, password } = data;
      const success = await authService.signInWithEmailPassword(email, password);
      
      if (success) {
        logger.info('User signed in successfully');
        return { success: true };
      } else {
        logger.error('Sign-in failed');
        return { success: false, error: 'Invalid credentials' };
      }
    } catch (error) {
      logger.error('Error in sign-in handler:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Handle logout request
  ipcMain.handle('logout', async () => {
    try {
      logger.info('Received logout request');
      
      if (!authService) {
        logger.warn('No auth service available for logout');
        return { success: false, error: 'No active session' };
      }
      
      // Attempt to sign out
      const success = await authService.signOut();
      
      if (success) {
        logger.info('User logged out successfully');
        // Notify renderer process about logout
        if (mainWindow) {
          mainWindow.webContents.send('sign-out');
        }
        return { success: true };
      } else {
        logger.error('Logout failed');
        return { success: false, error: 'Logout failed' };
      }
    } catch (error) {
      logger.error('Error in logout handler:', error);
      return { success: false, error: error.message };
    }
  });
  
  // Register the check-session handler
  ipcMain.handle('check-session', async () => {
    logger.info('[MAIN] Checking session validity');
    try {
      const isValid = authService.hasValidSession();
      logger.info(`[MAIN] Session validity check: ${isValid}`);
      return isValid;
    } catch (error) {
      logger.error('[MAIN] Error checking session validity:', error);
      return false;
    }
  });
  
  // Register the get-user-info handler
  ipcMain.handle('get-user-info', async () => {
    logger.info('[MAIN] Getting user info');
    try {
      const session = authService.getSession();
      if (!session || !session.user) {
        logger.warn('[MAIN] No valid session found for user info request');
        return null;
      }
      
      // Get user plan information
      const userPlan = await authService.fetchUserPlan();
      
      return {
        user: session.user,
        plan: userPlan
      };
    } catch (error) {
      logger.error('[MAIN] Error getting user info:', error);
      return null;
    }
  });

// Permission checking functions


// IPC handlers for permission checking
ipcMain.handle('check-microphone-permission', async () => {
  return await ensureMicrophoneAccess();
});

ipcMain.handle('check-screen-permission', async () => {
  return await ensureScreenRecordingAccess();
});

// Handle preload microphone check requests
ipcMain.handle('preload-mic-check', async () => {
  return await ensureMicrophoneAccess();
});

ipcMain.on('open-privacy-settings', async (event, platform) => {
  if (platform === 'win32') {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: 'Windows is blocking microphone access',
      detail: 'Click "Open settings" → enable "Microphone access" and "Let desktop apps access your microphone", then restart Interview Terminator.',
      buttons: ['Open settings', 'Cancel'],
      defaultId: 0
    });
    
    if (response === 0) {
      shell.openExternal('ms-settings:privacy-microphone');
    }
  } else if (platform === 'darwin') {
    // macOS privacy settings
    const urls = {
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
    };
    
    const url = urls.microphone; // Default to microphone for this context
    if (url) {
      shell.openExternal(url);
    }
  }
});

// Handle microphone status from renderer process
ipcMain.on('mic-status', async (event, data) => {
  if (data.ok) {
    logger.info('[MIC] getUserMedia permission granted');
    // Notify renderer process that permission is granted
    if (mainWindow) {
      mainWindow.webContents.send('mic-status-update', { granted: true });
    }
  } else {
    logger.error(`[MIC] getUserMedia failed: ${data.name} – ${data.message}`);
    
    // Provide detailed logging based on error type
    if (data.name === 'NotAllowedError') {
      logger.error('[MIC] Microphone access denied by user or system policy');
    } else if (data.name === 'SecurityError') {
      logger.error('[MIC] Security error - possibly HTTPS required or invalid context');
    } else if (data.name === 'NotFoundError') {
      logger.error('[MIC] No microphone device found');
    }
    
    // Show Windows permission dialog for microphone access issues
    if (process.platform === 'win32' && (data.name === 'NotAllowedError' || data.name === 'SecurityError')) {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Microphone Access Blocked',
        message: 'Windows is currently blocking microphone access for desktop apps.',
        detail: 'Please enable "Let desktop apps access your microphone" in Settings › Privacy & security › Microphone, then retry.',
        buttons: ['Open Settings', 'Cancel'],
        defaultId: 0,
        cancelId: 1
      });

      
      if (response === 0) {
         // Open Windows microphone privacy settings
         shell.openExternal('ms-settings:privacy-microphone');
       }
    }
    
    // Notify renderer process that permission was denied
    if (mainWindow) {
      mainWindow.webContents.send('mic-status-update', { 
        granted: false, 
        error: data 
      });
      
      // Send permission error event (reuse existing permission error handling)
      mainWindow.webContents.send('perm-error', {
        type: 'microphone',
        platform: process.platform,
        error: data.name,
        message: data.message,
        isPersistent: true
      });
    }
  }
});

// Handle Windows microphone permission denied
ipcMain.on('mic-permission-denied', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Microphone access is blocked',
    message: 'Windows is currently blocking microphone access for this app.',
    detail: 'Click "Open settings", enable "Microphone access" and ' +
            '"Let desktop apps access your microphone", then restart.',
    buttons: ['Open settings', 'Cancel'],
    defaultId: 0
  });
  if (response === 0) {
    shell.openExternal('ms-settings:privacy-microphone');   // deep-link
  }
});
  
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
  
  // Register keyboard shortcut for toggling window visibility (⌘+B on Mac, Control+B on Windows)
  globalShortcut.register('CommandOrControl+B', () => {
    toggleWindowVisibility();
  });
  
  // Register keyboard shortcut for quitting the application (⌘+Q on Mac, Control+Q on Windows)
  globalShortcut.register('CommandOrControl+Q', () => {
    app.quit();
  });
  
  // Register hotkeys moved from frontend (index.html)
  // ⌘+L - Start/Stop Recording
  globalShortcut.register('CommandOrControl+L', () => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-record-button');
    }
  });
  
  // ⌘+Enter - Toggle AI card & ask AI
  globalShortcut.register('CommandOrControl+Return', () => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-ai-button');
    }
  });
  
  // ⌘+T - Toggle Transcript card
  globalShortcut.register('CommandOrControl+T', () => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-transcript-toggle');
    }
  });
  
  // ⌘+Shift+C - Copy AI text
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (mainWindow) {
      mainWindow.webContents.send('trigger-copy-ai-text');
    }
  });

  // ⌘+Shift+Enter - Take screenshot and process with AI
  globalShortcut.register('CommandOrControl+Shift+Return', () => {
    logger.info('Screenshot and AI processing triggered via global shortcut');
    takeScreenshot(true); // processAfterCapture = true
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
  
  // Function to set up all server process event handlers
  function setupServerProcessHandlers(process) {
    // Add error handling for the server process
    process.on('error', (error) => {
      logger.error('Server process error:', error);
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: `Server process error: ${error.message}` });
      }
    });
    
    // Handle server process exit
    process.on('exit', (code, signal) => {
      logger.error(`Server process exited with code ${code} and signal ${signal}`);
      
      // Only show error to user if this wasn't a normal shutdown
      if (mainWindow && !app.isQuitting && code !== 0) {
        mainWindow.webContents.send('error', { message: `Server process exited unexpectedly` });
      }
      
      // Restart the server process if it exits unexpectedly and app is not quitting
      if (!app.isQuitting) {
        logger.info('Attempting to restart server process...');
        
        // Short delay before restarting to avoid rapid restart cycles
        setTimeout(() => {
          // Create a new server process with the same configuration and environment variables
          serverProcess = fork(serverPath, [], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          });
          
          // Re-attach all the event handlers
          setupServerProcessHandlers(serverProcess);

  // Explicit forwarder system to avoid duplicates and make message handling clear
  function forward(channel, data = null) {
    if (mainWindow) {
      mainWindow.webContents.send(channel, data);
    }
  }

  const relay = {
    'start-microphone-capture': () => forward('start-microphone-capture'),
    'stop-microphone-capture': () => forward('stop-microphone-capture'),
    'start-windows-audio-capture': () => {
      logger.info('[WINDOWS-AUDIO] Server requested start-windows-audio-capture, forwarding to renderer');
      forward('start-windows-audio-capture');
    },
    'stop-windows-audio-capture': () => {
      logger.info('[WINDOWS-AUDIO] Server requested stop-windows-audio-capture, forwarding to renderer');
      forward('stop-windows-audio-capture');
    },
    'recording-failed': (message) => {
      logger.error('[MAIN] Recording failed:', message.reason);
      if (mainWindow) {
        mainWindow.webContents.send('recording-failed', { reason: message.reason });
      }
    }
  };

  // Single, consolidated message handler for server process
  serverProcess.on('message', async (message) => {
    // Handle audio capture relay messages
    logger.info('🔍 [DEBUG] Main received server message:', message?.type);
    
    // Special handling for test message
    if (message.type === 'test-ipc-connection') {
      logger.info(`✅ [DEBUG] IPC CONNECTION TEST SUCCESSFUL: ${message.data}`);
      return;
    }
    
    // Handle pong response from server
    if (message.type === 'pong-from-server') {
      const latency = Date.now() - message.originalTimestamp;
      logger.info(`✅ [WINDOWS-DEBUG] RECEIVED PONG FROM SERVER - Latency: ${latency}ms`);
      return;
    }
    
    if (relay[message.type]) {
      logger.info('🔍 [DEBUG] Found relay handler for:', message?.type);
      relay[message.type](message);
      return;
    }
    else {
      logger.info(`🔍 [DEBUG] No relay handler for: ${message?.type}`);
    }

    // Handle persistent errors
    if (message.type === 'error' && message.data.isPersistent) {
      if (mainWindow) {
        mainWindow.webContents.send('perm-error', message.data);
      }
      return;
    }

    // Handle save-context message to save context data to database
    if (message.type === 'save-context' && message.data) {
      try {
        // Get the user ID from the auth service
        const userId = authService?.getSession()?.user?.id;

        if (!userId) {
          logger.warn('User ID not available, cannot save context');
          return;
        }

        // Initialize Supabase client
        const supabase = createSupabaseClient();

        // Prepare context data for insertion
        const contextData = {
          user_id: userId,
          type: message.data.type,
          title: message.data.title,
          content: message.data.content,
          metadata: message.data.metadata || {}
        };

        logger.info(`Saving ${message.data.type} context to database: ${message.data.title}`);

        // Insert context into the user_contexts table
        const { data, error } = await supabase
          .from('user_contexts')
          .insert([contextData]);

        if (error) {
          logger.error('Error saving context to database:', error);
          if (mainWindow) {
            mainWindow.webContents.send('error', {
              message: `Error saving context: ${error.message}`
            });
          }
        } else {
          logger.info('Context saved successfully to database');
          if (mainWindow) {
            mainWindow.webContents.send('context-saved', {
              success: true,
              message: 'Context saved successfully'
            });
          }
        }
      } catch (error) {
        logger.error('Unexpected error saving context:', error);
        if (mainWindow) {
          mainWindow.webContents.send('error', {
            message: `Unexpected error saving context: ${error.message}`
          });
        }
      }
      return;
    }

    // Handle get-user-context message to retrieve context data from database
    if (message.type === 'get-user-context' && message.data && message.data.userId) {
      try {
        // Initialize Supabase client
        const supabase = createSupabaseClient();
        
        // Query the user_contexts table for the most recent context
        const { data, error } = await supabase
          .from('user_contexts')
          .select('*')
          .eq('user_id', message.data.userId)
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (error) {
          logger.error('[MAIN] Error retrieving user context from Supabase:', error.message);
          serverProcess.send({
            type: 'user-context-response',
            data: null
          });
        } else if (data && data.length > 0) {
          serverProcess.send({
            type: 'user-context-response',
            data: data[0]
          });
        } else {
          serverProcess.send({
            type: 'user-context-response',
            data: null
          });
        }
      } catch (error) {
        logger.error('[MAIN] Unexpected error retrieving user context:', error);
        serverProcess.send({
          type: 'user-context-response',
          data: null
        });
      }
      return;
    }
    
    // Handle plan status check request from server
    if (message.type === 'check-plan-status-request') {
      const userId = message.data?.userId || authService?.getSession()?.user?.id;
      
      if (!userId) {
        if (mainWindow) {
          mainWindow.webContents.send('error', { message: 'User ID is required to check plan status' });
        }
        return;
      }
      
      try {
        const planStatus = await getPlanStatus(userId);
        
        // Send plan status back to the renderer
        if (mainWindow) {
          mainWindow.webContents.send('plan-status', {
            canStart: planStatus.canStart,
            reason: planStatus.reason,
            plan: planStatus.plan
          });
        }
      } catch (error) {
        logger.error('Error checking plan status:', error);
        if (mainWindow) {
          mainWindow.webContents.send('error', { message: 'Failed to check plan status' });
        }
      }
      return;
    }

    // Handle time limit reached
    if (message.type === 'time-limit-reached' && mainWindow) {
      logger.warn(`Time limit reached: ${message.data.message}`);
      mainWindow.webContents.send('time-limit-reached', message.data);
      return;
    }

    // Handle interview session saved
    if (message.type === 'interview-session-saved' && mainWindow) {
      const userId = message.data?.userId || authService?.getSession()?.user?.id;
      
      if (userId) {
        try {
          // Get updated plan status
          const planStatus = await getPlanStatus(userId);
          
          // Send updated plan status to the renderer
          mainWindow.webContents.send('plan-status-update', {
            plan: planStatus.plan
          });
        } catch (error) {
          logger.error('Error updating plan status after interview session:', error);
        }
      }
      return;
    }

    // Handle pong response
    if (message.type === 'pong') {
      logger.debug('Received pong from server process - server is alive');
      return;
    }

    // Forward all other messages to the renderer process
    if (mainWindow) {
      const forwardableMessages = [
        'transcript', 'interim-transcript', 'suggestion', 'suggestion-chunk', 
        'suggestion-partial', 'error', 'ready', 'recording-status', 
        'context-update', 'elaboration', 'screenshot-processed', 'processing-screenshot'
      ];
      
      if (forwardableMessages.includes(message.type)) {
        if (message.type === 'error') {
          logger.error('Server error:', message.data.message);
        }
        mainWindow.webContents.send(message.type, message.data);
      }
    }
  });
          
          // Notify the renderer that we're reconnecting
          if (mainWindow) {
            mainWindow.webContents.send('server-reconnecting');
          }
        }, 1000);
      }
    });

    
    // Log server output
    process.stdout.on('data', (data) => {
      logger.info(`[Server]: ${data}`);
    });
    
    process.stderr.on('data', (data) => {
      logger.error(`[Server Error]: ${data}`);
    });
  }
  
  // Start the server process
  const serverPath = app.isPackaged 
    ? (() => {
        if (process.platform === 'darwin') {
          // macOS: server.js is in extraResources
          return path.join(process.resourcesPath, 'server.js');
        } else {
          // Windows: server.js is in extraResources
          return path.join(path.dirname(process.execPath), 'resources', 'server.js');
        }
      })()
    : path.join(__dirname, 'server.js');

  logger.info(`Starting server process from: ${serverPath}`);
  
  // Fork the server process with environment variables
  serverProcess = fork(serverPath, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  
  // Set up all the event handlers
  setupServerProcessHandlers(serverProcess);

  // Windows-specific debugging
  logger.info(`🔍 [WINDOWS-DEBUG] Server process created:`);
  logger.info(`  - PID: ${serverProcess.pid}`);
  logger.info(`  - Connected: ${serverProcess.connected}`);
  logger.info(`  - Killed: ${serverProcess.killed}`);
  logger.info(`  - Platform: ${process.platform}`);
  logger.info(`  - Node version: ${process.version}`);
  logger.info(`  - Electron version: ${process.versions.electron}`);
  
  // Test immediate IPC right after process creation
  setTimeout(() => {
    logger.info('🔍 [WINDOWS-DEBUG] Testing immediate IPC after 1 second...');
    if (serverProcess && serverProcess.connected) {
      try {
        serverProcess.send({ type: 'ping-from-main', timestamp: Date.now() });
        logger.info('🔍 [WINDOWS-DEBUG] Ping message sent to server');
      } catch (error) {
        logger.error('🔍 [WINDOWS-DEBUG] Failed to send ping:', error);
      }
    } else {
      logger.error('🔍 [WINDOWS-DEBUG] Cannot ping - server not connected');
    }
  }, 1000);
  
  // Log when server is ready
  logger.info('Server process setup complete, waiting for ready signal...');

  app.on('activate', function () {
    // On macOS it's common to re-create a window when the dock icon is clicked
    if (mainWindow === null) createWindow();
    mainWindow.on('ready-to-show', () => {
      if (!process.env.IS_TEST) mainWindow.show();
      
      // Check existing session validity
      checkExistingSession()
        .then(isValid => {
          mainWindow.webContents.send('session-status', isValid);
          logger.info(`Session validity check completed: ${isValid}`);
        })
        .catch(error => {
          logger.error('Session check failed:', error);
          mainWindow.webContents.send('session-status', false);
        });
    });
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.isQuitting = true;
    app.quit();
  }
});

// Handle before-quit event to clean up resources
app.on('before-quit', () => {
  logger.info('Application is about to quit');
  app.isQuitting = true;
  if (serverProcess) {
    try {
      logger.info('Removing server process listeners and terminating process');
      serverProcess.removeAllListeners();
      serverProcess.kill();
      logger.info('Server process terminated successfully');
    } catch (error) {
      logger.error('Error killing server process:', error);
    }
  }
});

// Clean up the server process when the app is quitting
app.on('quit', () => {
  logger.info('Application quit event triggered');
  if (serverProcess) {
    try {
      serverProcess.kill();
      logger.info('Server process killed during quit');
    } catch (error) {
      logger.error('Error killing server process during quit:', error);
    }
  }
  
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  logger.info('Global shortcuts unregistered');
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
    // Save current window state before hiding
    windowStateManager.saveState(mainWindow);
    
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
    
    // Restore position and size from saved state
    const savedState = windowStateManager.getState();
    if (savedState.x !== undefined && savedState.y !== undefined) {
      mainWindow.setPosition(savedState.x, savedState.y);
    }
    
    if (savedState.width && savedState.height) {
      mainWindow.setSize(savedState.width, savedState.height);
    }
    
    // Ensure window is visible on screen
    const displays = screen.getAllDisplays();
    const currentPosition = mainWindow.getPosition();
    let isOnScreen = false;
    
    for (const display of displays) {
      const bounds = display.bounds;
      if (
        currentPosition[0] >= bounds.x && 
        currentPosition[1] >= bounds.y && 
        currentPosition[0] < bounds.x + bounds.width && 
        currentPosition[1] < bounds.y + bounds.height
      ) {
        isOnScreen = true;
        break;
      }
    }
    
    // If window is off-screen, center it on primary display
    if (!isOnScreen) {
      logger.info('Window was off-screen, centering on primary display');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      const windowSize = mainWindow.getSize();
      
      mainWindow.setPosition(
        Math.floor((width - windowSize[0]) / 2),
        Math.floor((height - windowSize[1]) / 2)
      );
    }
    
    isWindowVisible = true;
  }
}

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.isQuitting = true;
    app.quit();
  }
});

// Handle before-quit event to clean up resources
app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    try {
      serverProcess.removeAllListeners();
      serverProcess.kill();
    } catch (error) {
      console.error('Error killing server process:', error);
    }
  }
});

function checkExistingSession() {
  const sessionStore = require('./utils/session-store');
  return new Promise((resolve) => {
    try {
      // Check if there's a stored session since validateSession doesn't exist
      const isValid = sessionStore.hasStoredSession();
      resolve(isValid);
    } catch (error) {
      logger.error('Session validation error:', error);
      resolve(false);
    }
  });
}