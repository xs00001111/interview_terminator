const { app, BrowserWindow, screen, ipcMain, globalShortcut, dialog, desktopCapturer } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const os = require('os');
const dotenv = require('dotenv');

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
const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
const electronLog = require('electron-log');
const { createSupabaseClient } = require('./utils/supabase'); // Import Supabase client

// Initialize automatic updates only in production environment
if (process.env.NODE_ENV === 'production' || app.isPackaged) {
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: 'xs00001111/realtime_convo_helper'
    },
    updateInterval: '1 hour',
    logger: electronLog,
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
      // Save window state before hiding
      windowStateManager.saveState(mainWindow);
      mainWindow.hide();
    }
    
    // Reduced delay to minimize latency while still ensuring window is hidden
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Get screenshot buffer using native methods based on platform
    const screenshotBuffer = 
      process.platform === "darwin" 
        ? await captureScreenshotMac() 
        : await captureScreenshotWindows();
    
    // Pin functionality removed
    
    // Generate a unique filename using timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
    screenshotPath = path.join(screenshotDir, `screenshot-${timestamp}.png`);
    
    // Save the screenshot to the temp directory
    fs.writeFileSync(screenshotPath, screenshotBuffer);
    
    // Verify the file was written correctly
    const stats = fs.statSync(screenshotPath);
    if (stats.size === 0) {
      logger.error('Screenshot file was created but is empty');
      if (mainWindow) {
        mainWindow.webContents.send('error', { message: 'Failed to save screenshot: File is empty' });
      }
      return;
    }
    
    logger.info(`Screenshot saved to: ${screenshotPath} (${stats.size} bytes)`);
    
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
          logger.debug(`Removed old screenshot: ${fileToRemove}`);
        } catch (error) {
          logger.error(`Error removing old screenshot: ${error}`, error);
        }
      }
    }
    
    // Show the main window again if it was visible before
    if (wasVisible && mainWindow) {
      // Minimal delay before showing window again to reduce latency
      await new Promise(resolve => setTimeout(resolve, 25));
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
    
    // If processAfterCapture is true, send the screenshot to the server for processing
    if (processAfterCapture && serverProcess) {
      logger.info('Sending screenshot to server for processing...');
      serverProcess.send({ type: 'process-screenshot', data: { path: screenshotPath } });
      if (mainWindow) {
        mainWindow.webContents.send('processing-screenshot', { message: 'Processing screenshot...' });
      }
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
    logger.error('Error capturing screenshot on macOS:', error);
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
    logger.error('Error capturing screenshot on Windows:', error);
    throw error;
  }
}

function createWindow() {
  // Ensure we have access to screen module (app is ready at this point)
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  // Get saved window state from the state manager
  const savedState = windowStateManager ? windowStateManager.getState() : { width: 800, height: 400 };
  
  // Create the browser window with enhanced undetectability features
  mainWindow = new BrowserWindow({
    width: savedState.width || 800,
    height: savedState.height || 400,
    x: savedState.x || Math.floor((width - 800) / 2),
    y: savedState.y || height - 450,
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
      preload: app.isPackaged 
        ? path.join(process.resourcesPath, 'preload.js') 
        : path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // Prevent throttling when in background
      paintWhenInitiallyHidden: true // Ensure rendering happens even when hidden
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
  mainWindow.loadURL('file://' + path.join(__dirname, 'index.html'));

  // Open DevTools only in development mode
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Set up window state tracking
  windowStateManager.trackWindow(mainWindow);
  
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
  
  // Handle start recording button click
  ipcMain.on('start-recording', async (event, data) => { // Make handler async
    if (serverProcess) {
      logger.info('Received start-recording request from renderer');
      // Get the user ID from the auth service (ensure authService is initialized)
      const userId = authService?.getSession()?.user?.id;
      
      if (!userId) {
        logger.warn('User ID not available, cannot start recording');
        if (mainWindow) {
          mainWindow.webContents.send('error', { message: 'User ID is required to start an interview' });
        }
        return;
      }
      
      // Verify user's plan status
      const planStatus = await getPlanStatus(userId);
      
      if (!planStatus.canStart) {
        // User cannot start an interview due to plan limitations
        logger.info(`User ${userId} cannot start recording: ${planStatus.reason}`);
        if (mainWindow) {
          // Send the plan-limit-reached event to the renderer process
          // This will trigger the modal to be displayed
          mainWindow.webContents.send('plan-limit-reached', { 
            reason: planStatus.reason || 'Unable to start interview due to plan limitations',
            plan: planStatus.plan
          });
          
          logger.info('Sent plan-limit-reached event to renderer process');
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
    console.log('[DEBUG] Main process received elaborate request:', message);
    if (serverProcess) {
      serverProcess.send({ type: 'elaborate', data: { message } });
    }
  });
  
  // Handle get-suggestion request
  ipcMain.on('get-suggestion', (event, data) => {
    console.log('[DEBUG] Main process received get-suggestion request:', data);
    if (serverProcess) {
      console.log('[DEBUG] Forwarding get-suggestion request to server process');
      serverProcess.send({ type: 'get-suggestion', data });
    } else {
      console.error('[DEBUG] Cannot forward get-suggestion request: server process not available');
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
        console.log(`Opened external URL: ${url}`);
      })
      .catch(err => {
        console.error(`Error opening external URL: ${url}`, err);
        if (mainWindow) {
          mainWindow.webContents.send('error', { message: `Failed to open URL: ${err.message}` });
        }
      });
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
      console.log(`[Plan] Not decrementing interviews for user ${userId}: ${!plan ? 'no plan found' : 'unlimited plan'}`);
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
    console.log('[MAIN] Handling complete-login with data:', data);
    try {
      const { email, password } = data;
      const success = await authService.signInWithEmailPassword(email, password);
      return { success };
    } catch (error) {
      console.error('[MAIN] Error in complete-login handler:', error);
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
  
  // Register keyboard shortcut for taking screenshots (⌘+H on Mac, Control+H on Windows)
  globalShortcut.register('CommandOrControl+H', () => {
    takeScreenshot(false);
  });
  
  // Register keyboard shortcut for taking and processing screenshots (⌘+Enter on Mac, Control+Enter on Windows)
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

  // Handle save-context message from server process
  serverProcess.on('message', async (message) => {
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
    }
    
    // Forward messages to the renderer process
    if (mainWindow) {
      if (message.type === 'transcript') {
        mainWindow.webContents.send('transcript', message.data);
      } else if (message.type === 'interim-transcript') {
        mainWindow.webContents.send('interim-transcript', message.data);
      } else if (message.type === 'suggestion') {
        mainWindow.webContents.send('suggestion', message.data);
      } else if (message.type === 'error') {
        logger.error('Server error:', message.data.message);
        mainWindow.webContents.send('error', message.data);
      } else if (message.type === 'ready') {
        mainWindow.webContents.send('server-ready', message.data);
      } else if (message.type === 'recording-status') {
        mainWindow.webContents.send('recording-status', message.data);
      } else if (message.type === 'context-update') {
        mainWindow.webContents.send('context-update', message.data);
      } else if (message.type === 'elaboration') {
        mainWindow.webContents.send('elaboration', message.data);
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
    
    // Handle messages from the server process
    process.on('message', async (message) => {
      if (message.type === 'check-plan-status-request') {
        // Handle plan status check request from server
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
      } else if (message.type === 'elaboration' && mainWindow) {
        mainWindow.webContents.send('elaboration', message.data);
      } else if (message.type === 'time-limit-reached' && mainWindow) {
        logger.warn(`Time limit reached: ${message.data.message}`);
        mainWindow.webContents.send('time-limit-reached', message.data);
      } else if (message.type === 'interview-session-saved' && mainWindow) {
        // When an interview session is saved, update the plan status
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
      } else if (message.type === 'pong') {
        logger.debug('Received pong from server process - server is alive');
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
    ? path.join(process.resourcesPath, 'server.js')
    : path.join(__dirname, 'server.js');

  logger.info(`Starting server process from: ${serverPath}`);
  
  // Fork the server process with environment variables
  serverProcess = fork(serverPath, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  
  // Set up all the event handlers
  setupServerProcessHandlers(serverProcess);

  // Handle save-context message from server process
  serverProcess.on('message', async (message) => {
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
    }
    
    // Forward messages to the renderer process
    if (mainWindow) {
      if (message.type === 'transcript') {
        mainWindow.webContents.send('transcript', message.data);
      } else if (message.type === 'interim-transcript') {
        mainWindow.webContents.send('interim-transcript', message.data);
      } else if (message.type === 'suggestion') {
        mainWindow.webContents.send('suggestion', message.data);
      } else if (message.type === 'error') {
        logger.error('Server error:', message.data.message);
        mainWindow.webContents.send('error', message.data);
      } else if (message.type === 'ready') {
        mainWindow.webContents.send('server-ready', message.data);
      } else if (message.type === 'recording-status') {
        mainWindow.webContents.send('recording-status', message.data);
      } else if (message.type === 'context-update') {
        mainWindow.webContents.send('context-update', message.data);
      } else if (message.type === 'elaboration') {
        mainWindow.webContents.send('elaboration', message.data);
      }
    }
  });
  
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