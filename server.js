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

const languageCode = 'en-US';
const streamingLimit = 60000;

// Audio quality optimization settings
const AUDIO_CONFIG = {
  // Primary sample rate (16kHz is optimal for speech recognition)
  OPTIMAL_SAMPLE_RATE: 16000,
  // Alternative sample rates for different quality needs
  HIGH_QUALITY_SAMPLE_RATE: 48000, // For high-fidelity capture if needed
  TELEPHONE_QUALITY_SAMPLE_RATE: 8000, // For bandwidth-constrained scenarios
  // Audio format settings
  ENCODING: 'LINEAR16', // Lossless encoding for best accuracy

  // Recognition optimization
  ENABLE_AUTOMATIC_PUNCTUATION: true, // Enable for better transcript readability
  ENABLE_WORD_TIME_OFFSETS: true, // Enable for potential future features
}; 

// Audio format conversion function: 32-bit float to 16-bit LINEAR16
function convertFloat32ToLinear16(float32Buffer) {
  // Each 32-bit float sample is 4 bytes, each 16-bit sample is 2 bytes
  const numSamples = float32Buffer.length / 4;
  const linear16Buffer = Buffer.alloc(numSamples * 2);
  
  for (let i = 0; i < numSamples; i++) {
    // Read 32-bit float (little-endian)
    const floatValue = float32Buffer.readFloatLE(i * 4);
    
    // Convert to 16-bit signed integer
    // Clamp to [-1, 1] range and scale to 16-bit range
    const clampedValue = Math.max(-1, Math.min(1, floatValue));
    const int16Value = Math.round(clampedValue * 32767);
    
    // Write 16-bit value (little-endian)
    linear16Buffer.writeInt16LE(int16Value, i * 2);
  }
  
  return linear16Buffer;
}

const {Writable} = require('stream');
const { spawn } = require('child_process');
const os = require('os');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const events = require('events');
const dotenvExpand = require('dotenv-expand');

const log = require('electron-log');

// Handle EPIPE errors in console logging to prevent crashes
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors (broken pipe) - this happens when the process terminates
    // while we're trying to write to stdout
    return;
  }
  // Re-throw other errors
  throw err;
});

process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') {
    // Ignore EPIPE errors (broken pipe) - this happens when the process terminates
    // while we're trying to write to stderr
    return;
  }
  // Re-throw other errors
  throw err;
});

// Override console methods to handle EPIPE errors gracefully
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

console.log = (...args) => {
  try {
    originalConsoleLog.apply(console, args);
  } catch (err) {
    if (err.code !== 'EPIPE') {
      // Only re-throw non-EPIPE errors
      throw err;
    }
  }
};

console.error = (...args) => {
  try {
    originalConsoleError.apply(console, args);
  } catch (err) {
    if (err.code !== 'EPIPE') {
      // Only re-throw non-EPIPE errors
      throw err;
    }
  }
};

console.warn = (...args) => {
  try {
    originalConsoleWarn.apply(console, args);
  } catch (err) {
    if (err.code !== 'EPIPE') {
      // Only re-throw non-EPIPE errors
      throw err;
    }
  }
};

console.info = (...args) => {
  try {
    originalConsoleInfo.apply(console, args);
  } catch (err) {
    if (err.code !== 'EPIPE') {
      // Only re-throw non-EPIPE errors
      throw err;
    }
  }
};

// Removed shared memory audio integration

// Lazy-loaded modules (only load when needed)
let GoogleAuth, grpc, GoogleGenerativeAI, OpenAI, speech;
let client, genAI, model, openai;



// Optimize PATH setup
function setupBinPath() {
  if (process.env.NODE_ENV === 'production') {
    let binPath;
    if (process.platform === 'darwin') {
      // macOS: binaries are in extraResources
      binPath = path.join(process.resourcesPath, 'bin');
    } else {
      // Windows: binaries are in extraResources
      binPath = path.join(path.dirname(process.execPath), 'resources', 'bin');
    }
    const pathSeparator = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${binPath}${pathSeparator}${process.env.PATH}`;
    console.log('Production mode: Using bundled binaries from', binPath);
  } else {
    const binPath = path.join(__dirname, 'bin');
    const pathSeparator = process.platform === 'win32' ? ';' : ':';
    process.env.PATH = `${binPath}${pathSeparator}${process.env.PATH}`;
    console.log('Development mode: Using bundled binaries from', binPath);
  }
}



// Consolidate environment loading
function loadEnvironmentVariables() {
  let envConfig;
  if (process.env.NODE_ENV === 'production') {
    let envPath;
    if (process.platform === 'darwin') {
      // macOS: .env.production is in extraResources
      envPath = path.join(process.resourcesPath, '.env.production');
    } else {
      // Windows: .env.production is in extraResources
      envPath = path.join(path.dirname(process.execPath), 'resources', '.env.production');
    }
    envConfig = dotenv.config({ path: envPath });
  } else {
    envConfig = dotenv.config();
  }
  dotenvExpand.expand(envConfig);
  
  console.log('Supabase URL available:', !!process.env.SUPABASE_URL);
  console.log('Supabase Anon Key available:', !!process.env.SUPABASE_ANON_KEY);
}

// Initialize core components immediately
setupBinPath();
loadEnvironmentVariables();
events.EventEmitter.defaultMaxListeners = 15;

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('file', {
    alias: 'f',
    description: 'Path to a file to use as context for the AI',
    type: 'string',
  })
  .help()
  .alias('help', 'h')
  .argv;



const GOOGLE_CLOUD_SPEECH_API_KEY = process.env.GOOGLE_CLOUD_SPEECH_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

function initializeGoogleSpeechClient() {
  if (!client) {
    const {GoogleAuth: GoogleAuthLib, grpc: grpcLib} = require('google-gax');
    GoogleAuth = GoogleAuthLib;
    grpc = grpcLib;
    speech = require('@google-cloud/speech').v1p1beta1;
    
    const sslCreds = grpc.credentials.createSsl();
    const googleAuth = new GoogleAuth();
    const authClient = googleAuth.fromAPIKey(GOOGLE_CLOUD_SPEECH_API_KEY);
    const credentials = grpc.credentials.combineChannelCredentials(
      sslCreds,
      grpc.credentials.createFromGoogleCredential(authClient)
    );
    
    client = new speech.SpeechClient({sslCreds: credentials});
  }
  return client;
}

const https = require('https');

const openaiAgent = new https.Agent({
  keepAlive: true,
});

// Create HTTP agent for Gemini API with connection pooling
const geminiAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000, // Keep connections alive for 30 seconds
  maxSockets: 10, // Maximum number of sockets per host
  maxFreeSockets: 5, // Maximum number of free sockets per host
  timeout: 60000, // Socket timeout
});

function initializeOpenAI() {
  if (!openai) {
    const { OpenAI: OpenAILib } = require('openai');
    openai = new OpenAILib({
      apiKey: OPENAI_API_KEY,
      httpAgent: openaiAgent,
    });
  }
  return openai;
}

function initializeGemini() {
  if (!genAI) {
    const { GoogleGenerativeAI: GeminiLib } = require('@google/generative-ai');
    
    // Configure Gemini with custom fetch that uses our HTTP agent
    const customFetch = (url, options = {}) => {
      // Only apply agent for HTTPS requests to Gemini API
      if (url.includes('generativelanguage.googleapis.com')) {
        return fetch(url, {
          ...options,
          agent: geminiAgent
        });
      }
      return fetch(url, options);
    };
    
    genAI = new GeminiLib(GOOGLE_GEMINI_API_KEY, {
      fetch: customFetch
    });
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: {temperature: 0.3, maxOutputTokens: 2048, topK: 32} });
  }
  return { genAI, model };
}

// AI provider configuration
const AI_PROVIDER = 'openai'; // Set to 'openai' or 'gemini'

let chatHistory = [];

// Recording state
let isRecording = false;
let recordingStream = null;
let recordingTimer = null; // Timer for limiting recording duration

// Timing tracking for startup latency
let recordingStartClickTime = null;
let streamsReadyTime = null;
let firstAudioDataTime = null;
// Remove scHelperProcess variable


// Swift audio capture process
let swiftAudioProcess = null;



// OS version detection for Swift audio capture compatibility
function getMacOSVersion() {
  if (process.platform !== 'darwin') {
    return null; // Not macOS
  }

  try {
    const release = os.release();
    const majorVersion = parseInt(release.split('.')[0]);

    // macOS 15 (Sequoia) is Darwin 24.x
    if (majorVersion >= 24) {
      return { major: 15, minor: 0, isSupported: true }; // macOS 15+
    } else {
      // For versions older than macOS 15, we'll use the dual-stream method
      const macVersion = majorVersion - 4; // Approximate mapping
      return { major: macVersion, minor: 0, isSupported: false };
    }
  } catch (error) {
    console.error('Error detecting macOS version:', error);
    return { major: 0, minor: 0, isSupported: false };
  }
}

// Detect OS version and set Swift audio capture availability
const osVersion = getMacOSVersion();
let swiftAudioCaptureSupported = false;

if (osVersion) {
  swiftAudioCaptureSupported = osVersion.isSupported;
  console.log(`Detected macOS ${osVersion.major}.${osVersion.minor} (Darwin ${os.release()})`);
  // console.log(`Swift audio capture supported: ${swiftAudioCaptureSupported}`);
} else if (process.platform === 'darwin') {
  // console.log('Running on macOS but version detection failed - disabling Swift audio capture');
  swiftAudioCaptureSupported = false;
} else {
  // console.log(`Running on ${process.platform} - Swift audio capture not available`);
  swiftAudioCaptureSupported = false;
}

// Audio source selection
let useSwiftAudioCapture = swiftAudioCaptureSupported; // Use Swift only if supported

function startScreenCaptureKitAndMicrophone() {
  console.log('Starting microphone capture via getUserMedia...');
  
  // Signal the renderer process to start getUserMedia microphone capture
  process.send({ type: 'start-microphone-capture' });

  console.log('Microphone capture request sent to renderer.');
}

function startWindowsWebAPICapture() {
  console.log('🔍 [DEBUG] startWindowsWebAPICapture() function called');
  console.log('🔍 [DEBUG] Server process.send available:', typeof process.send);
  console.log('🔍 [DEBUG] Server process.connected:', process.connected);
  
  // Signal the renderer process to start both microphone and system audio capture
  console.log('🔍 [DEBUG] About to send start-windows-audio-capture message to main process');
  
  try {
    process.send({ type: 'start-windows-audio-capture' });
    console.log('🔍 [DEBUG] start-windows-audio-capture message sent successfully');
  } catch (error) {
    console.error('🔍 [DEBUG] Failed to send message to main process:', error);
  }
  
  console.log('🎙️ Windows audio capture request sent to renderer.');
}



async function startRecordingWithSwiftCapture() {
  const captureStartTime = Date.now();
  // console.log('Starting Swift audio capture tool...');
  
  // Start the speech recognition streams first for minimal latency
  const streamStartTime = Date.now();
  startStream();
  const streamDuration = Date.now() - streamStartTime;
  console.log(`⏱️ [LATENCY] Speech recognition streams started: ${streamDuration}ms`);
  
  startSwiftProcess();
  const captureDuration = Date.now() - captureStartTime;
  console.log(`⏱️ [LATENCY] Swift capture startup took: ${captureDuration}ms`);
}

function startSwiftProcess() {
  const startTime = Date.now();
  // console.log('⏱️ [LATENCY] Starting Swift audio process...');
  
  const swiftToolPath = process.env.NODE_ENV === 'production'
    ? path.join(process.resourcesPath, 'bin', 'AudioCapture')
    : path.join(__dirname, 'bin', 'AudioCapture');
  
  const spawnStartTime = Date.now();
  swiftAudioProcess = spawn(swiftToolPath, [], {
    stdio: 'pipe'
  });
  const spawnDuration = Date.now() - spawnStartTime;
  console.log(`⏱️ [LATENCY] Swift process spawn took: ${spawnDuration}ms`);
  
  swiftAudioProcess.on('error', (err) => {
    console.error('Swift audio process error:', err);
    process.send({ type: 'error', data: { message: `Swift audio capture error: ${err.message}` } });
    
    // TODO: Implement fallback for non-macOS 15+ versions
    console.log('Swift audio capture failed. Need to implement fallback.');
  });
  
  swiftAudioProcess.on('close', (code) => {
    console.log(`Swift audio process exited with code ${code}`);
    if (code === 2) {
      // Screen recording permission denied
      sendPermissionError('screen-recording', 'denied');
      return;
    }
    
    if (isRecording) {
      // If we're still supposed to be recording, try to restart
      setTimeout(() => {
        if (isRecording) {
          console.log('Restarting Swift audio capture...');
          startSwiftProcess();
        }
      }, 1000);
    }
  });
  
  let firstDataReceived = false;
  let swiftProcessStartTime = startTime;
  
  // Buffers to hold incomplete data chunks (persistent between events)
  let stdoutBuffer = Buffer.alloc(0);
  let stderrBuffer = Buffer.alloc(0);
  
  swiftAudioProcess.stdout.on('data', (data) => {
    if (!isRecording) return;

    // Measure time to first data
    if (!firstDataReceived) {
      const timeToFirstData = Date.now() - swiftProcessStartTime;
      // // console.log(`⏱️ [LATENCY] Time to first Swift audio data: ${timeToFirstData}ms`);
      firstDataReceived = true;
    }

    // Append new data to buffer
    stdoutBuffer = Buffer.concat([stdoutBuffer, data]);

    // Process complete messages from buffer
    let separatorIndex;
    while ((separatorIndex = stdoutBuffer.indexOf('\n')) >= 0) {
      const message = stdoutBuffer.slice(0, separatorIndex).toString();
      stdoutBuffer = stdoutBuffer.slice(separatorIndex + 1);

      // Process system audio data (base64 encoded) from stdout
      if (message.trim().length > 0) {
        try {
          const audioChunk = Buffer.from(message, 'base64');
          if (systemAudioInputStreamTransform) {
            // Convert from 32-bit float to 16-bit LINEAR16 for Google Speech API
            const convertedChunk = convertFloat32ToLinear16(audioChunk);
            // // console.log(`🔊 System audio data received via stdout: ${audioChunk.length} bytes -> ${convertedChunk.length} bytes`);
            systemAudioInputStreamTransform.write(convertedChunk);
          }
        } catch (error) {
          // If not valid base64, log as debug message
          console.log(`Swift process stdout: ${message}`);
        }
      }
    }
  });

  swiftAudioProcess.stderr.on('data', (data) => {
    if (!isRecording) return;

    if (!firstDataReceived) {
      const timeToFirstData = Date.now() - swiftProcessStartTime;
      console.log(`⏱️ [LATENCY] Time to first Swift audio data: ${timeToFirstData}ms`);
      firstDataReceived = true;
    }

    // Append new data to buffer
    stderrBuffer = Buffer.concat([stderrBuffer, data]);

    // Process complete messages from buffer
    let separatorIndex;
    while ((separatorIndex = stderrBuffer.indexOf('\n')) >= 0) {
      const message = stderrBuffer.slice(0, separatorIndex).toString();
      stderrBuffer = stderrBuffer.slice(separatorIndex + 1);

      // Process microphone audio data (base64 encoded) from stderr
      if (message.trim().length > 0) {
        try {
          const audioChunk = Buffer.from(message, 'base64');
          if (microphoneAudioInputStreamTransform) {
            // Convert from 32-bit float to 16-bit LINEAR16 for Google Speech API
            const convertedChunk = convertFloat32ToLinear16(audioChunk);
            // //console.log(`🎤 Microphone audio data received via stderr: ${audioChunk.length} bytes -> ${convertedChunk.length} bytes`);
            microphoneAudioInputStreamTransform.write(convertedChunk);
          }
        } catch (error) {
          // If not valid base64, log as debug/error message
          console.error(`Swift process stderr: ${message}`);
        }
      }
    }
  });

  // Start the speech recognition stream immediately as pipes are no longer used
  startStream();
}



function startRecording() {
  if (isRecording) {
    console.log('Already recording.');
    return;
  }
  
  // Track timing from user click to streams ready
  recordingStartClickTime = Date.now();
  console.log('🎯 [TIMING] User clicked "Start Listening" - beginning audio capture startup');
  
  // Test IPC connection by sending a test message first
  console.log('🔍 [DEBUG] Testing IPC connection - sending test message');
  try {
    process.send({ type: 'test-ipc-connection', data: 'IPC test from server' });
    console.log('🔍 [DEBUG] Test IPC message sent successfully');
  } catch (error) {
    console.error('🔍 [DEBUG] Failed to send test IPC message:', error);
  }
  
  isRecording = true;
  process.send({ type: 'recording-started' });

  const overallStartTime = Date.now();
  
  // Reset dual stream manager for new recording session
  dualStreamManager.stopConcurrentProcessing();

  if (process.platform === 'win32') {
    // Windows: Use Web APIs for both microphone and system audio
    console.log('🔄 Starting Windows Web API audio capture');
    startWindowsWebAPICapture();
    startStream();
  } else if (useSwiftAudioCapture) {
    startRecordingWithSwiftCapture();
  } else {
    // On older macOS versions, use ScreenCaptureKit for system audio
    // and getUserMedia for microphone audio - enabling dual stream processing
    console.log('🔄 Starting dual stream audio capture (system + microphone)');
    startSwiftProcess(); // For system audio
    startScreenCaptureKitAndMicrophone(); // For microphone
    startStream();
  }

  setTimeout(() => {
    const overallDuration = Date.now() - overallStartTime;
    console.log(`⏱️ [LATENCY] Overall recording startup completed: ${overallDuration}ms`);
  }, 100);
}

// Stop the recording and speech recognition
async function stopRecording() {
  if (!isRecording) return;
  
  // Set recording state to false before stopping streams
  // to prevent error handlers from firing during intentional shutdown
  isRecording = false;
  
  // Stop dual stream concurrent processing
  dualStreamManager.stopConcurrentProcessing();
  console.log('🛑 Dual stream processing stopped');
  
  // Clear the recording timer if it exists
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }
  
  try {
    // First stop the speech recognition streams to prevent further writes
    if (microphoneRecognizeStream) {
      try {
        microphoneRecognizeStream.removeListener('data', microphoneSpeechCallback);
        microphoneRecognizeStream.end();
      } catch (streamError) {
        const errorMessage = streamError && streamError.message ? streamError.message : 'unknown error';
        console.error(`Non-fatal microphone recognize stream error: ${errorMessage}`);
      }
      microphoneRecognizeStream = null;
    }
    
    if (systemAudioRecognizeStream) {
      try {
        systemAudioRecognizeStream.removeListener('data', systemAudioSpeechCallback);
        systemAudioRecognizeStream.end();
      } catch (streamError) {
        const errorMessage = streamError && streamError.message ? streamError.message : 'unknown error';
        console.error(`Non-fatal system audio recognize stream error: ${errorMessage}`);
      }
      systemAudioRecognizeStream = null;
    }
    
    // Stop the recording stream (fallback for direct stream handling)
    if (recordingStream) {
      // Remove any existing error listeners before destroying the stream
      recordingStream.removeAllListeners('error');
      
      // Add a one-time error handler that just logs but doesn't crash
      recordingStream.once('error', (err) => {
        const errorMessage = err && err.message ? err.message : 'unknown error';
        console.error(`Non-fatal error during stream cleanup: ${errorMessage}`);
      });
      
      // Safely unpipe and destroy the stream
      try {
        recordingStream.unpipe(audioInputStreamTransform);
      } catch (unpipeError) {
        const errorMessage = unpipeError && unpipeError.message ? unpipeError.message : 'unknown error';
        console.error(`Non-fatal unpipe error: ${errorMessage}`);
      }
      
      try {
        recordingStream.destroy();
      } catch (destroyError) {
        const errorMessage = destroyError && destroyError.message ? destroyError.message : 'unknown error';
        console.error(`Non-fatal destroy error: ${errorMessage}`);
      }
      
      recordingStream = null;
    }
    
    // Stop Swift audio capture if it's running
    if (swiftAudioProcess) {
      try {
        swiftAudioProcess.kill('SIGTERM');
        swiftAudioProcess = null;
        // console.log('Swift audio process terminated');
      } catch (killError) {
        const errorMessage = killError && killError.message ? killError.message : 'unknown error';
        console.error(`Non-fatal Swift process kill error: ${errorMessage}`);
      }
    }
    
    // Stop Windows Web API audio capture if it's running
    if (process.platform === 'win32') {
      process.send({ type: 'stop-windows-audio-capture' });
    }
    
    // Shared memory recording functionality removed
    
    // Pipe streams are no longer used, so no need to destroy them here.
    
    // Reset audio input arrays to free memory
    audioInput = [];
    lastAudioInput = [];
    
    // Reset microphone audio arrays
    microphoneAudioInput = [];
    lastMicrophoneAudioInput = [];
    
    // Reset system audio arrays
    systemAudioInput = [];
    lastSystemAudioInput = [];
    
    // Reset timing tracking variables
    recordingStartClickTime = null;
    streamsReadyTime = null;
    firstAudioDataTime = null;
    
    // Clear audio buffers and timers
    microphoneAudioBuffer = [];
    microphoneBufferStartTime = null;
    systemAudioBuffer = [];
    systemAudioBufferStartTime = null;
    
    if (microphoneBufferTimer) {
      clearTimeout(microphoneBufferTimer);
      microphoneBufferTimer = null;
    }
    
    if (systemAudioBufferTimer) {
      clearTimeout(systemAudioBufferTimer);
      systemAudioBufferTimer = null;
    }
    
    // Notify frontend that recording has stopped successfully
    process.send({ type: 'recording-status', data: { isRecording: false } });
    
  } catch (error) {
    // Only log the error, don't send it to the frontend when intentionally stopping
    const errorMessage = error && error.message ? error.message : 'unknown error';
    console.error(`Error during recording cleanup: ${errorMessage}`);
    // Don't send error to frontend for normal stop operations
  }
}

// Pin functionality removed

// Function to retrieve user context from database
async function retrieveUserContext(userId) {
  if (!userId) {
    console.error('[SERVER] Error: User ID not available. Cannot retrieve context.');
    log.error('[SERVER] Error: User ID not available. Cannot retrieve context.');
    return null;
  }

  try {
    // Forward the request to main process which has access to Supabase
    return new Promise((resolve) => {
      // Set up a one-time listener for the response
      const contextResponseHandler = (message) => {
        if (message.type === 'user-context-response') {
          process.removeListener('message', contextResponseHandler);
          resolve(message.data);
        }
      };

      // Add the temporary listener
      process.on('message', contextResponseHandler);

      // Send the request to main process
      process.send({
        type: 'get-user-context',
        data: { userId }
      });

      // Set a timeout to prevent hanging if no response
      setTimeout(() => {
        process.removeListener('message', contextResponseHandler);
        resolve(null);
      }, 2000); // Reduced timeout to 2 seconds
    });
  } catch (error) {
    console.error('[SERVER] Error retrieving user context:', error);
    return null;
  }
}

// Windows-specific debugging for outgoing IPC messages
if (process.platform === 'win32') {
  let outgoingCount = 0;
  const originalSend = process.send;
  if (originalSend) {
    process.send = function(message) {
      outgoingCount++;
      console.log(`🔍 [SERVER→MAIN] #${outgoingCount} Attempting to send:`, message.type);
      console.log(`🔍 [SERVER→MAIN] Process connected:`, process.connected);
      console.log(`🔍 [SERVER→MAIN] Process PID:`, process.pid);
      
      try {
        const result = originalSend.call(this, message);
        console.log(`🔍 [SERVER→MAIN] #${outgoingCount} Send result:`, result);
        console.log(`🔍 [SERVER→MAIN] #${outgoingCount} Still connected after send:`, process.connected);
        return result;
      } catch (error) {
        console.error(`❌ [SERVER→MAIN] #${outgoingCount} Send failed:`, error.message);
        console.error(`❌ [SERVER→MAIN] #${outgoingCount} Error stack:`, error.stack);
        throw error;
      }
    };
  } else {
    console.error('❌ [SERVER→MAIN] process.send is not available!');
  }
}

// Listen for messages from the main process
process.on('message', async (message) => { // Make handler async
  console.log('🔍 [WINDOWS-DEBUG] Server received message from main:', message.type);
  
  if (message.type === 'ping-from-main') {
    console.log('🔍 [WINDOWS-DEBUG] Received ping from main, sending pong back');
    try {
      process.send({ type: 'pong-from-server', originalTimestamp: message.timestamp, serverTimestamp: Date.now() });
      console.log('🔍 [WINDOWS-DEBUG] Pong sent back to main');
    } catch (error) {
      console.error('🔍 [WINDOWS-DEBUG] Failed to send pong back:', error);
    }
    return;
  }
  
  if (message.type === 'start-recording') {
    if (!isRecording) {
      // Plan verification is now handled in main.js
      // Just start the recording process
      startRecording();
      process.send({ 
        type: 'recording-status', 
        data: { isRecording: true } 
      });
    }
  } else if (message.type === 'stop-recording') {
    if (isRecording) {
      await stopRecording();
      process.send({ type: 'recording-status', data: { isRecording: false } });
    }
  } else if (message.type === 'start-microphone-capture') {
    // Signal renderer to start getUserMedia microphone capture
    process.send({ type: 'start-microphone-capture' });
  } else if (message.type === 'stop-microphone-capture') {
    // Signal renderer to stop getUserMedia microphone capture
    process.send({ type: 'stop-microphone-capture' });
  } else if (message.type === 'start-windows-audio-capture') {
    // Signal renderer to start Windows Web API audio capture
    console.log('🔍 [DEBUG] Server sending start-windows-audio-capture to main process');
    process.send({ type: 'start-windows-audio-capture' });
    console.log('🔍 [DEBUG] Server sent start-windows-audio-capture message');
  } else if (message.type === 'stop-windows-audio-capture') {
    // Signal renderer to stop Windows Web API audio capture
    process.send({ type: 'stop-windows-audio-capture' });
  } else if (message.type === 'microphone-data') {
    // Handle microphone audio data from renderer
    console.log(`🔍 [DEBUG] Server received microphone-data message: ${message.data ? message.data.length || 'unknown size' : 'no data'} bytes`);
    if (message.data && microphoneAudioInputStreamTransform) {
      // Ensure data is a Buffer for stream writing
      const audioBuffer = Buffer.isBuffer(message.data) ? message.data : Buffer.from(message.data);
      console.log(`🔍 [DEBUG] Writing microphone data to stream: ${audioBuffer.length} bytes`);
      microphoneAudioInputStreamTransform.write(audioBuffer);
    } else {
      console.log(`⚠️ [DEBUG] Microphone data dropped - data: ${!!message.data}, stream: ${!!microphoneAudioInputStreamTransform}`);
    }
  } else if (message.type === 'system-audio-data') {
    // Handle system audio data from renderer (Windows Web API capture)
    console.log(`🔍 [DEBUG] Server received system-audio-data message: ${message.data ? message.data.length || 'unknown size' : 'no data'} bytes`);
    if (message.data && systemAudioInputStreamTransform) {
      // Ensure data is a Buffer for stream writing
      const audioBuffer = Buffer.isBuffer(message.data) ? message.data : Buffer.from(message.data);
      console.log(`🔍 [DEBUG] Writing system audio data to stream: ${audioBuffer.length} bytes`);
      systemAudioInputStreamTransform.write(audioBuffer);
    } else {
      console.log(`⚠️ [DEBUG] System audio data dropped - data: ${!!message.data}, stream: ${!!systemAudioInputStreamTransform}`);
    }
  } else if (message.type === 'microphone-audio-meta') {
    // Handle microphone audio metadata (sample rate, etc.)
    if (message.data && message.data.rate) {
      console.log(`🎵 Microphone sample rate: ${message.data.rate}Hz`);
      // Update speech config if needed for different sample rates
      // Google Speech API supports 8kHz, 16kHz, 44.1kHz, 48kHz
    }
  } else if (message.type === 'system-audio-meta') {
    // Handle system audio metadata (sample rate, etc.)
    if (message.data && message.data.rate) {
      console.log(`🎵 System audio sample rate: ${message.data.rate}Hz`);
      // Update speech config if needed for different sample rates
      // Google Speech API supports 8kHz, 16kHz, 44.1kHz, 48kHz
    }
  } else if (message.type === 'system-audio-missing') {
    // Handle system audio missing (mic-only mode)
    console.warn('⚠️ System audio missing – enabling mic-only mode');
    if (dualStreamManager) {
      dualStreamManager.enableMicOnlyMode();
    }
  } else if (message.type === 'retrieve-context') {
    // Skip context retrieval if interview is already in progress
    if (isRecording) {

      return;
    }
    
    // Handle context retrieval before interview starts
    if (message.data && message.data.userId) {

      try {
        const contextData = await retrieveUserContext(message.data.userId);
        
        if (contextData && contextData.content) {

          
          // Process the context with AI if needed
          let processedContext = contextData.content;
          if (AI_PROVIDER === 'gemini' || AI_PROVIDER === 'openai') {
            try {
              processedContext = await processWithGemini(contextData.content);

            } catch (processError) {
              console.error('[SERVER] Error processing context with AI:', processError);
              // Fall back to original content if processing fails
              processedContext = contextData.content;
            }
          }
          
          // Set the retrieved context as the primary context
          fileContext = processedContext;
          extractedContent = processedContext;
          
          process.send({
            type: 'context-update',
            data: {
              message: 'User context retrieved and set',
              contextTitle: contextData.title || 'Saved Context'
            }
          });
        } else {

          process.send({
            type: 'context-update',
            data: { message: 'No saved context found' }
          });
        }
      } catch (error) {
        console.error('[SERVER] Error in context retrieval:', error);
        process.send({
          type: 'error',
          data: { message: 'Failed to retrieve context: ' + (error.message || 'Unknown error') }
        });
      }
    } else {
      console.error('[SERVER] Invalid retrieve-context message: missing userId');
      process.send({
        type: 'error',
        data: { message: 'Invalid context retrieval request: missing user ID' }
      });
    }
  } else if (message.type === 'process-text-context') {

    if (isRecording) {

      return;
    }
    
    if (message.data && message.data.text) {
      const textContext = message.data.text;

      try {
        const processedContext = await processWithGemini(textContext);
        // Set the processed text as the primary context
        fileContext = processedContext; 
        extractedContent = processedContext; // Keep extractedContent consistent

        process.send({ 
          type: 'context-update', 
          data: { message: 'Text context processed and set.' } 
        });
      } catch (error) {
        console.error('Error processing text context with Gemini:', error);
        process.send({ type: 'error', data: { message: 'Failed to process text context.' } });
      }
    }
  } else if (message.type === 'process-file-content') {
    console.log('Received process-file-content message:', message);
    if (!isRecording && message.data) {
        // Handle both direct file path and file content approaches
        if (message.data.filePath) {
            // This is the legacy or direct file path approach
            const filePath = message.data.filePath;
            const fileName = message.data.fileName || path.basename(filePath) || 'uploaded file';
            console.log(`Processing file at path: ${filePath}`);
            
            // Use the unified processContextFile function
            processContextFile(filePath, fileName);
        } else if (message.data.fileName && message.data.fileContent) {
            // This is the legacy approach where file content is sent directly
            // We'll create a temporary file and then process it
            console.log(`Processing file content for: ${message.data.fileName}`);
            try {
                // Create a temporary file
                const tempDir = path.join(os.tmpdir(), 'interm-app');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                const tempFilePath = path.join(tempDir, `${Date.now()}-${message.data.fileName}`);
                const buffer = Buffer.from(new Uint8Array(message.data.fileContent));
                fs.writeFileSync(tempFilePath, buffer);
                
                // Process the temporary file using the unified function
                processContextFile(tempFilePath, message.data.fileName);
            } catch (error) {
                console.error(`Error processing file content for ${message.data.fileName}:`, error);
                process.send({ 
                    type: 'error', 
                    data: { message: `Error processing file: ${error.message}` } 
                });
            }
        } else {
            console.error('Invalid process-file-content message: missing filePath or fileContent');
            process.send({ 
                type: 'error', 
                data: { message: 'Invalid file processing request: missing file path or content' } 
            });
        }
    } else if (isRecording) {
        console.error('Cannot process file while recording is active');
        process.send({ 
            type: 'error', 
            data: { message: 'Cannot process file while recording is active' } 
        });
    } else {
        console.error('Invalid process-file-content message: missing data');
        process.send({ 
            type: 'error', 
            data: { message: 'Invalid file processing request: missing data' } 
        });
    }
  } else if (message.type === 'process-screenshot') {
    if (message.data && message.data.path) {
      processScreenshot(message.data.path);
    }
  // Pin functionality removed
  } else if (message.type === 'elaborate') {
    if (message.data && message.data.message) {
      elaborate(message.data.message);
    }
  } else if (message.type === 'get-suggestion') {
    if (message.data && message.data.text) {
      console.log('[SERVER] Received get-suggestion request with text:', message.data.text);
      generateAISuggestion(message.data.text);
    }
  } else if (message.type === 'interview-session') {
    if (message.data) {
      // Log interview session timing data
      console.log('=== INTERVIEW SESSION TIMING ===');
      console.log(`Start Time: ${message.data.startTime}`);
      console.log(`End Time: ${message.data.endTime}`);
      console.log(`Duration: ${message.data.formattedDuration} (${message.data.durationMs}ms)`);
      console.log('===============================');

      // userId is no longer expected from message.data for this step.
      // It will be handled by main.js.

      // Forward the interview session timing data to main process
      console.log('[SERVER] Forwarding interview session timing data to main process for final save');
      log.info('[SERVER] Forwarding interview session timing data to main process for final save');
      
      // Send the session timing data to main process
      process.send({
        type: 'finalize-interview-session', // New, more descriptive type
        data: {
          // userId will be added by main.js
          startTime: message.data.startTime,
          endTime: message.data.endTime,
          durationMs: message.data.durationMs,
          formattedDuration: message.data.formattedDuration
        }
      });
    }
  } else if (message.type === 'check-plan-status') {
    // Plan status checking is now handled in main.js
    // Just forward the request to main process
    process.send({
      type: 'check-plan-status-request',
      data: message.data
    });
  } else if (message.type === 'ping') {
    // Respond to ping messages to confirm the server is still alive
    process.send({ type: 'pong' });
  }
});

// Function to process text with Gemini
async function processWithGemini(text) {
  console.log('[GEMINI] Processing text for context extraction...');
  if (AI_PROVIDER !== 'gemini') {
      console.warn('[GEMINI] AI_PROVIDER is not set to gemini. Skipping Gemini processing.');
      // Return the original text if not using Gemini, or handle differently
      // For now, just return the original text to avoid breaking flow
      return text; 
  }
  try {
    // Create a prompt that instructs Gemini to extract structured information
    const extractionPrompt = `Extract the key information from the following text in a structured format suitable for use as conversational context. Focus on entities, relationships, and main topics:

${text}`;
    
    // Generate content with the extraction prompt
    const result = await model.generateContent([extractionPrompt]);
    const processedText = result.response.text();
    console.log('[GEMINI] Text processed successfully.');
    return processedText;
  } catch (error) {
    const errorMessage = error?.message || 'unknown error';
    console.error(`[GEMINI] Error processing text: ${errorMessage}`);
    throw new Error(`Gemini processing failed: ${errorMessage}`);
  }
}

// Function to elaborate on a concise response
async function elaborate(text) {
  console.log('[DEBUG] Elaborate function called with text:', text);
  try {
    // Prepare context for inclusion in the system prompt
    let contextData = '';
    if (extractedContent) {
      contextData = extractedContent;
      console.log('[DEBUG] Including extracted content in elaborate function');
    } else if (fileContext) {
      contextData = fileContext;
      console.log('[DEBUG] Including file context in elaborate function');
    }

    // Format the context data for inclusion in the system prompt
    const formattedContext = contextData ? `### Context Information:\n${contextData}\n\n` : "";
    
    // Use the processed context as the primary system prompt if available
    let interviewSystemPrompt = systemPrompt;
    if (contextData) {
      // Combine the formatted context with the system prompt
      interviewSystemPrompt = formattedContext + systemPrompt;
      console.log('[DEBUG] Using processed context as primary system prompt for interview');
    }

    const elaborationPrompt = `Take this concise response: "${text}" and expand it into a detailed technical explanation. Provide specific examples, implementation details, or architectural considerations. Keep the response focused and professional, limited to one paragraph with maximum 5 sentences.`;
    console.log('[DEBUG] Using AI provider:', AI_PROVIDER);

    if (AI_PROVIDER === 'gemini') {
      console.log('[DEBUG] Calling Gemini API');
      
      // Create a system instruction that uses the processed context as the primary system prompt
      const systemInstruction = interviewSystemPrompt + 
        "\nUse the provided context information to craft a detailed response that references specific details from the context when appropriate.";
      
      // Generate content with the enhanced system instruction
      const result = await model.generateContent([
        systemInstruction,
        elaborationPrompt
      ]);
      
      const elaboratedResponse = result.response.text();
      console.log('[DEBUG] Received Gemini response');
      process.send({ type: 'elaboration', data: { elaboration: elaboratedResponse } });
    } else if (AI_PROVIDER === 'openai') {
      console.log('[DEBUG] Calling OpenAI API');
      
      // Initialize OpenAI client if not already initialized
      const openaiClient = await initializeOpenAI();
      
      // Prepare enhanced system message with processed context as the primary system prompt
      const systemMessageContent = interviewSystemPrompt + 
        "\n\nUse the provided context information to craft a detailed response that references specific details from the context when appropriate.";
      
      const result = await openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemMessageContent },
          { role: 'user', content: elaborationPrompt }
        ],
        temperature: 0.3,
      });
      const elaboratedResponse = result.choices[0].message.content;
      console.log('[DEBUG] Received OpenAI response');
      process.send({ type: 'elaboration', data: { elaboration: elaboratedResponse } });
    }
  } catch (error) {
    const errorMessage = error && error.message ? error.message : 'unknown error';
    console.error(`Error generating elaboration: ${errorMessage}`);
    process.send({ type: 'error', data: { message: `Error generating elaboration: ${errorMessage}` } });
  }
}


// Read file content if provided
let fileContext = "";
let fileContentPart = null;
let documentSummary = "";
let extractedContent = "";

// Performance optimization caches
const promptCache = new Map(); // Cache for frequently used prompts
const contextCache = new Map(); // Cache for context data
let lastProcessedTime = 0;
const MIN_PROCESSING_INTERVAL = 200; // Minimum 200ms between processing requests

// Optimized prompt templates for faster generation
const OPTIMIZED_PROMPTS = {
  screenshot: `Analyze this screenshot and provide a concise technical solution:

• For code issues: Identify problems and provide corrected code with proper syntax highlighting
• For errors: Diagnose root cause and provide step-by-step solutions  
• For math: Use LaTeX notation ($...$ inline, $$...$$ block)
• For architecture: Suggest improvements and best practices
• Otherwise: Provide helpful insights and optimization tips

Use markdown formatting. Be concise but comprehensive.`,
  
  withContext: `Analyze this screenshot and provide a concise technical solution:

• For code issues: Identify problems and provide corrected code with proper syntax highlighting
• For errors: Diagnose root cause and provide step-by-step solutions  
• For math: Use LaTeX notation ($...$ inline, $$...$$ block)
• For architecture: Suggest improvements and best practices
• Otherwise: Provide helpful insights and optimization tips

Use markdown formatting. Be concise but comprehensive.

### Context Information:
{context}

Reference context when relevant.`
};

async function generateDocumentSummary() {
  if (!argv.file) return;
  
  try {
    const filePath = argv.file;
    const fileExtension = filePath.split('.').pop().toLowerCase();
    
    // Determine MIME type based on file extension
    let mimeType = 'text/plain';
    if (['pdf'].includes(fileExtension)) {
      mimeType = 'application/pdf';
    } else if (['png', 'jpg', 'jpeg', 'gif'].includes(fileExtension)) {
      mimeType = `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;
    } else if (['docx'].includes(fileExtension)) {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    
    // For text files, read as UTF-8
    if (mimeType === 'text/plain') {
      const rawFileContent = fs.readFileSync(filePath, 'utf8');
      
      if (AI_PROVIDER === 'gemini') {
        // Extract structured content from the document using Gemini
        const extractResult = await model.generateContent([
          `Read the following document and extract the key information in a structured format that can be used as context for a conversation:\n\n${rawFileContent}`
        ]);
        extractedContent = extractResult.response.text();
        
        // Generate summary for text content
        const result = await model.generateContent([
          `Summarize this document in 3-5 sentences:\n\n${rawFileContent}`
        ]);
        documentSummary = result.response.text();
      } else if (AI_PROVIDER === 'openai') {
        // Extract structured content from the document using OpenAI
        const extractResult = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: `Read the following document and extract the key information in a structured format that can be used as context for a conversation:\n\n${rawFileContent}` }
          ],
          temperature: 0.3,
        });
        extractedContent = extractResult.choices[0].message.content;
        
        // Generate summary for text content
        const result = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: `Summarize this document in 3-5 sentences:\n\n${rawFileContent}` }
          ],
          temperature: 0.3,
        });
        documentSummary = result.choices[0].message.content;
      }
      
      // Use the extracted content instead of raw file content
      fileContext = extractedContent;
      fileContentPart = null; // Ensure fileContentPart is null for text files
    } 
    // For binary files, read as base64 for Gemini multimodal input
    else {
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      fileContentPart = {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      };
      
      if (AI_PROVIDER === 'gemini') {
        // Extract structured content from the document using Gemini
        const extractResult = await model.generateContent([
          fileContentPart,
          'Read this document and extract the key information in a structured format that can be used as context for a conversation'
        ]);
        extractedContent = extractResult.response.text();
        
        // Generate summary for binary content
        const result = await model.generateContent([
          fileContentPart,
          'Summarize this document in 3-5 sentences'
        ]);
        documentSummary = result.response.text();
      } else if (AI_PROVIDER === 'openai') {
        // For OpenAI, we can't directly process binary files, so we'll need to extract text first

        // For simplicity, we'll just use a placeholder message
        extractedContent = 'Binary document content (OpenAI cannot directly process binary files)';
        documentSummary = 'Binary document (OpenAI cannot directly process binary files)';
      }
      
      // Store the extracted content as text for use in chat
      fileContext = extractedContent;
    }
    
    // Initialize chat with the new context
    await initializeChat();
    
  } catch (error) {
    process.exit(1);
  }
}

// Initialize chat after summary generation
async function initializeChat() {
  if (AI_PROVIDER === 'gemini') {
    // Prepare context for inclusion in the system prompt
    let contextData = '';
    if (extractedContent) {
      contextData = extractedContent;
      console.log('[DEBUG] Using extracted content as primary context for system prompt');
    } else if (fileContext) {
      contextData = fileContext;
      console.log('[DEBUG] Using file context as primary context for system prompt');
    }

    // Format the context data for inclusion in the system prompt
    const formattedContext = contextData ? `### Context Information:\n${contextData}\n\n` : "";

    // Create chat configuration with system instruction that prioritizes the processed context
    const chatConfig = {
      history: chatHistory,
      temprature: 0.2,
      systemInstruction: {
        role: "system",
        parts: [{ 
          text: formattedContext + 
                systemPrompt + 
                (contextData ? "\nUse the provided context information to craft responses that reference specific details from the context when appropriate. Prioritize information from the context when answering questions." : "\nUse the previous conversation responses to maintain a consistent personality and background knowledge throughout the conversation.")
    }]
    }
  };

    // If we have a binary file content, add it to the history instead of system instruction
    if (fileContentPart) {
      chatConfig.history = [
        {
          role: "user",
          parts: [fileContentPart, { text: "Use this document as context for our conversation." }]
        },
        {
          role: "model",
          parts: [{ text: "I'll use this document as context for our conversation." }]
        }
      ];
    } else if (fileContext) {
      // If we have text context, add it to the history
      chatConfig.history = [
        {
          role: "user",
          parts: [{ text: `Here's the document content to use as context:\n\n${fileContext}` }]
        },
        {
          role: "model",
          parts: [{ text: "I'll use this document content as context for our conversation." }]
        }
      ];
    }

    // Initialize the chat with the configuration
    chat = model.startChat(chatConfig);
  } else if (AI_PROVIDER === 'openai') {
    // For OpenAI, we don't need to initialize a chat session in the same way
    // We'll handle messages directly when sending them
    chatHistory = [];
    
    // If we have context, add it to the chat history
    if (fileContext) {
      chatHistory.push(
        { role: "user", content: `Here's the document content to use as context:\n\n${fileContext}` },
        { role: "assistant", content: "I'll use this document content as context for our conversation." }
      );
    }
  }
}

// Initialize chat with default configuration
// Will be properly initialized when context is loaded or by initializeChat()
// Read system prompt from file using three-candidate approach
const candidatePaths = [
  path.join(__dirname, 'system_prompt.txt'),             // current directory
  path.join(process.cwd(), 'system_prompt.txt'),         // working directory
  path.join(process.resourcesPath || '', 'system_prompt.txt') // packaged app resources
];

let systemPrompt = '';
for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    systemPrompt = fs.readFileSync(p, 'utf8');
    console.log(`✅ Loaded system_prompt.txt from: ${p}`);
    break;
  }
}
if (!systemPrompt) {
  console.warn('[WARN] system_prompt.txt not found, continuing with empty prompt');
}

// Initialize chat based on selected AI provider
let chat;
if (AI_PROVIDER === 'gemini') {
  chat = model.startChat({
    history: [],
    systemInstruction: {
      role: "system",
      parts: [{ 
        text: systemPrompt
      }]
    }
  });
}

// Initialize chat properly after startup
initializeChat();

// Function to get speech recognition config based on audio capture method
function getSpeechConfig() {
  const baseConfig = {
    encoding: AUDIO_CONFIG.ENCODING,
    sampleRateHertz: AUDIO_CONFIG.OPTIMAL_SAMPLE_RATE,
    languageCode: languageCode,
    audioChannelCount: AUDIO_CONFIG.CHANNELS,
    // Performance optimizations based on Google's recommendations
    enableAutomaticPunctuation: AUDIO_CONFIG.ENABLE_AUTOMATIC_PUNCTUATION,
    enableWordTimeOffsets: AUDIO_CONFIG.ENABLE_WORD_TIME_OFFSETS,
    enableWordConfidence: false, // Disable for speed
    profanityFilter: false, // Disable for speed
    useEnhanced: AUDIO_CONFIG.USE_ENHANCED_MODEL,
    model: AUDIO_CONFIG.MODEL, // Optimized model for short audio segments
    singleUtterance: false, // Allow continuous recognition
    interimResults: true, // Enable interim results for faster response
    enableVoiceActivityDetection: false, // Disable aggressive silence detection
    maxAlternatives: 1, // Only get the top result for efficiency
    speechContexts: [], // No custom vocabulary for general use
    // Audio quality settings
    enableSeparateRecognitionPerChannel: false, // Single channel processing
  };
  
  return baseConfig;
}

// Optimized Google Speech API configuration using AUDIO_CONFIG settings
const config = getSpeechConfig();

const request = {
  config,
  interimResults: true,
};

// Microphone stream variables
let microphoneRecognizeStream = null;
let microphoneRestartCounter = 0;
let microphoneAudioInput = [];
let lastMicrophoneAudioInput = [];
let microphoneResultEndTime = 0;
let microphoneIsFinalEndTime = 0;
let microphoneFinalRequestEndTime = 0;
let newMicrophoneStream = true;
let microphoneBridgingOffset = 0;
let lastMicrophoneTranscriptWasFinal = false;

// System audio stream variables
let systemAudioRecognizeStream = null;
let systemAudioRestartCounter = 0;
let systemAudioInput = [];
let lastSystemAudioInput = [];
let systemAudioResultEndTime = 0;
let systemAudioIsFinalEndTime = 0;
let systemAudioFinalRequestEndTime = 0;
let newSystemAudioStream = true;
let systemAudioBridgingOffset = 0;
let lastSystemAudioTranscriptWasFinal = false;
// Initialize global variable to track the last speaker role

// Pre-initialization variables
let speechClientPreInitialized = false;
let preInitializedSpeechClient = null;

// Pre-initialize speech recognition client for faster startup
async function preInitializeSpeechRecognition() {
  const preInitStartTime = Date.now();
  console.log('⏱️ [LATENCY] Pre-initializing speech recognition client...');
  
  try {
    // Initialize the Google Speech client early
    preInitializedSpeechClient = initializeGoogleSpeechClient();
    
    // Verify the client is working by creating a test stream and immediately closing it
    const testStream = preInitializedSpeechClient.streamingRecognize(request);
    testStream.end();
    
    speechClientPreInitialized = true;
    const preInitDuration = Date.now() - preInitStartTime;
    console.log(`⏱️ [LATENCY] Speech recognition pre-initialization completed: ${preInitDuration}ms`);
  } catch (error) {
    console.error('Failed to pre-initialize speech recognition client:', error);
    speechClientPreInitialized = false;
    preInitializedSpeechClient = null;
  }
}

function startStream() {
  // Don't start a new stream if we're not recording
  if (!isRecording) {
    return;
  }
  // Always start microphone stream
  startMicrophoneStream();
  startSystemAudioStream();
  
  // Track when streams are ready
  streamsReadyTime = Date.now();
  if (recordingStartClickTime) {
    const streamsReadyDuration = streamsReadyTime - recordingStartClickTime;
    console.log(`🎯 [TIMING] Streams created and ready: ${streamsReadyDuration}ms from user click`);
  }
  console.log('🎯 Started dual audio streams (microphone + system audio)');
    
    // Monitor for concurrent processing activation
  setTimeout(() => {
    const status = dualStreamManager.getStreamStatus();
    if (status.concurrent) {
      console.log('✅ Dual stream concurrent processing is active');
      
      // Log comprehensive timing summary when fully operational
      if (recordingStartClickTime && streamsReadyTime && firstAudioDataTime) {
        const totalStartupTime = firstAudioDataTime - recordingStartClickTime;
        const streamCreationTime = streamsReadyTime - recordingStartClickTime;
        const dataFlowTime = firstAudioDataTime - streamsReadyTime;
        
        console.log('📊 [TIMING SUMMARY] Audio capture startup breakdown:');
        console.log(`   • Stream creation: ${streamCreationTime}ms`);
        console.log(`   • Data flow start: ${dataFlowTime}ms`);
        console.log(`   • Total startup: ${totalStartupTime}ms`);
      }
    } else {
      console.log('⚠️ Waiting for both streams to become active...');
    }
    }, 1000);
    
  // System audio is critical - fail if it doesn't start within timeout
  const SYSTEM_AUDIO_TIMEOUT = 5000;
  setTimeout(() => {
    const status = dualStreamManager.getStreamStatus();
    console.log(`🔍 [DEBUG] Timeout check - Stream status:`, status);
    console.log(`🔍 [DEBUG] isRecording: ${isRecording}, recordingStartClickTime: ${recordingStartClickTime}`);
    
    if (!status.systemAudio) {
      console.error('❌ CRITICAL: System audio failed to start within 5 seconds');
      console.error('❌ System audio is required to hear interviewer questions');
      console.error('❌ Stopping recording session...');
      
      // Stop recording and notify user of failure
      isRecording = false;
      
      // Send failure message to main process
      process.send({ 
        type: 'recording-failed', 
        reason: 'System audio capture failed to start. Please check your audio settings and try again.' 
      });
      
      // Stop any active streams
      stopRecording();
    } else if (!status.microphone) {
      console.warn('⚠️ Microphone missing but system audio active - continuing with system audio only');
      // System audio is working, that's what matters most
      if (!status.concurrent) {
        dualStreamManager.enableSystemAudioOnlyMode();
      }
    }
  }, SYSTEM_AUDIO_TIMEOUT);  
}

function startMicrophoneStream() {
  // Don't start a new stream if we're not recording
  if (!isRecording) {
    return;
  }
  
  // Use pre-initialized client if available, otherwise initialize on demand
  const speechClient = speechClientPreInitialized && preInitializedSpeechClient 
    ? preInitializedSpeechClient 
    : initializeGoogleSpeechClient();
  
  // if (speechClientPreInitialized) {
  //   console.log('✅ Using pre-initialized speech client for microphone stream');
  // }
  
  // Clear current microphoneAudioInput
  microphoneAudioInput = [];
  
  // Make sure any existing stream is properly closed before creating a new one
  if (microphoneRecognizeStream) {
    try {
      microphoneRecognizeStream.removeListener('data', microphoneSpeechCallback);
      if (!microphoneRecognizeStream.destroyed && !microphoneRecognizeStream.writableEnded) {
        microphoneRecognizeStream.end();
      }
    } catch (err) {
      console.error('Error cleaning up existing microphone stream:', err.message);
    }
    microphoneRecognizeStream = null;
  }
  
  // Update config for current audio capture method before creating stream
  const currentConfig = getSpeechConfig();
  const currentRequest = {
    config: currentConfig,
    interimResults: true,
  };
  
  // Initiate (Reinitiate) a microphone recognize stream
  try {
    microphoneRecognizeStream = speechClient
      .streamingRecognize(currentRequest)
      .on('error', err => {
        if (err.code === 11) {
          console.log('Microphone stream exceeded time limit, restarting...');
        } else {
          console.error('Microphone API request error:', err);
        }
      })
      .on('data', microphoneSpeechCallback);
  } catch (err) {
    console.error('Error creating microphone recognize stream:', err.message);
    return;
  }

  // Restart stream when streamingLimit expires
  if (isRecording) {
    setTimeout(() => {
      if (isRecording) {
        restartMicrophoneStream();
      }
    }, streamingLimit);
  }
}

function startSystemAudioStream() {
  // Don't start a new stream if we're not recording
  if (!isRecording) {
    return;
  }
  
  // Use pre-initialized client if available, otherwise initialize on demand
  const speechClient = speechClientPreInitialized && preInitializedSpeechClient 
    ? preInitializedSpeechClient 
    : initializeGoogleSpeechClient();
  
  if (speechClientPreInitialized) {
    // console.log('✅ Using pre-initialized speech client for system audio stream');
  }
  
  // Clear current systemAudioInput
  systemAudioInput = [];
  
  // Make sure any existing stream is properly closed before creating a new one
  if (systemAudioRecognizeStream) {
    try {
      systemAudioRecognizeStream.removeListener('data', systemAudioSpeechCallback);
      if (!systemAudioRecognizeStream.destroyed && !systemAudioRecognizeStream.writableEnded) {
        systemAudioRecognizeStream.end();
      }
    } catch (err) {
      console.error('Error cleaning up existing system audio stream:', err.message);
    }
    systemAudioRecognizeStream = null;
  }
  
  // Update config for current audio capture method before creating stream
  const currentConfig = getSpeechConfig();
  const currentRequest = {
    config: currentConfig,
    interimResults: true,
  };
  
  // Initiate (Reinitiate) a system audio recognize stream
  try {
    systemAudioRecognizeStream = speechClient
      .streamingRecognize(currentRequest)
      .on('error', err => {
        if (err.code === 11) {
          // console.log('System audio stream exceeded time limit, restarting...');
        } else {
          console.error('System audio API request error:', err);
        }
      })
      .on('data', systemAudioSpeechCallback);
  } catch (err) {
    console.error('Error creating system audio recognize stream:', err.message);
    return;
  }

  // Restart stream when streamingLimit expires
  if (isRecording) {
    setTimeout(() => {
      if (isRecording) {
        restartSystemAudioStream();
      }
    }, streamingLimit);
  }
}

const microphoneSpeechCallback = (stream) => {
  // console.log('[DEBUG] Microphone audio speech callback called with stream:', JSON.stringify(stream, null, 2));
  // Convert API result end time from seconds + nanoseconds to milliseconds
  microphoneResultEndTime =
    stream.results[0].resultEndTime.seconds * 1000 +
    Math.round(stream.results[0].resultEndTime.nanos / 1000000);

  // Calculate correct time based on offset from audio sent twice
  const correctedTime =
    microphoneResultEndTime - microphoneBridgingOffset + streamingLimit * microphoneRestartCounter;

  // Fix: Check if process.stdout.clearLine exists before calling it
  if (process.stdout.clearLine) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
  }
  
  let stdoutText = '';
  let speakerInfo = {};
  
  if (stream.results[0] && stream.results[0].alternatives[0]) {
    const transcript = stream.results[0].alternatives[0].transcript;
    stdoutText = correctedTime + ': ' + transcript;
    
    // LATENCY: Calculate buffer-to-transcript time
    const transcriptReceivedAt = Date.now();
    if (microphoneAudioInput.length > 0) {
      const lastChunk = microphoneAudioInput[microphoneAudioInput.length - 1];
      if (lastChunk && lastChunk.bufferReceivedAt) {
        const bufferToTranscriptLatency = transcriptReceivedAt - lastChunk.bufferReceivedAt;
        // console.log(`⏱️ [LATENCY] Microphone buffer-to-transcript: ${bufferToTranscriptLatency}ms`);
      }
    }
    
    // DEBUG: Print transcript data
    // console.log(`🎤 [MICROPHONE TRANSCRIPT] Length: ${transcript.length}, Content: "${transcript}", isFinal: ${stream.results[0].isFinal}`);
    
    // Extract speaker diarization information if available (for SoX fallback version)
    if (stream.results[0].alternatives[0].words && 
        stream.results[0].alternatives[0].words.length > 0 && 
        stream.results[0].alternatives[0].words[0].speakerTag !== undefined) {
      
      // Group words by speaker
      const wordsBySpeaker = {};
      
      stream.results[0].alternatives[0].words.forEach(word => {
        const speakerTag = word.speakerTag || 0;
        if (!wordsBySpeaker[speakerTag]) {
          wordsBySpeaker[speakerTag] = [];
        }
        wordsBySpeaker[speakerTag].push(word.word);
      });
      
      // Create speaker information object with role detection
      const speakers = Object.keys(wordsBySpeaker).map(tag => ({
        speakerTag: parseInt(tag),
        text: wordsBySpeaker[tag].join(' ')
      }));
      
      // Check macOS version for speaker role assignment
      const macOSVersion = getMacOSVersion();
      const isMacOS15Plus = macOSVersion && macOSVersion.isSupported;
      
      // For macOS 15+: Microphone is always 'me', no speaker tags
      // For older macOS: Fallback to no speaker tags
      if (isMacOS15Plus) {
        // On macOS 15+, microphone input is always from the user
        speakerInfo = {
          hasSpeakerInfo: false, // Don't show speaker tags
          speakers: [{
            speakerTag: 0,
            text: transcript,
            role: 'me'
          }]
        };
      } else {
        // Fallback for older macOS versions - no speaker diarization
        speakerInfo = {
          hasSpeakerInfo: false,
          speakers: [{
            speakerTag: 0,
            text: transcript,
            role: 'me' // Treat all input as 'me'
          }]
        };
      }
      
      console.log(`🎯 [DIARIZATION] Detected ${speakers.length} speakers:`, speakerInfo.speakers.map(s => `${s.role}: "${s.text}"`).join(', '));
    }
    
    // Process interim results immediately (not just final ones)
    if (!stream.results[0].isFinal) {
      // Skip sending empty interim transcripts
      if (!transcript || transcript.trim().length === 0) {
        console.log(`🎤 [MICROPHONE] Skipping empty interim transcript`);
        return;
      }
      
      // Format speaker information for interim results
      let formattedSpeakerInfo = {
        hasSpeakerInfo: speakerInfo.hasSpeakerInfo || false,
        segments: []
      };
      
      if (speakerInfo.hasSpeakerInfo && speakerInfo.speakers) {
        formattedSpeakerInfo.segments = speakerInfo.speakers.map(speaker => ({
          speakerId: speaker.speakerTag,
          text: speaker.text,
          role: speaker.role || 'UNKNOWN'
        }));
      } else {
        // Fallback for non-diarized audio (Swift capture) or macOS 15+
        formattedSpeakerInfo.segments = [{
          speakerId: 'microphone',
          text: transcript,
          role: 'me'
        }];
      }
      
      // Send interim transcript for immediate display
      process.send({ 
        type: 'interim-transcript', 
        data: { 
          text: transcript, 
          interim: true, 
          source: 'microphone',
          speakerInfo: formattedSpeakerInfo
        }
      });
    }
  }

  if (stream.results[0].isFinal) {
    // Get the finalized transcript
    const userMessage = stream.results[0].alternatives[0].transcript;
    
    // Skip sending empty transcripts
    if (!userMessage || userMessage.trim().length === 0) {
      console.log(`🎤 [MICROPHONE] Skipping empty final transcript`);
      return;
    }
    
    // Format speaker information with segments for the frontend
    let formattedSpeakerInfo = {
      hasSpeakerInfo: speakerInfo.hasSpeakerInfo || false,
      segments: []
    };
    
    if (speakerInfo.hasSpeakerInfo && speakerInfo.speakers) {
      formattedSpeakerInfo.segments = speakerInfo.speakers.map(speaker => ({
        speakerId: speaker.speakerTag,
        text: speaker.text,
        role: speaker.role || 'UNKNOWN'
      }));
    } else {
      // Fallback for non-diarized audio (Swift capture) or macOS 15+
      formattedSpeakerInfo.segments = [{
        speakerId: 'microphone',
        text: userMessage,
        role: 'me'
      }];
    }
    
    // Send transcript to the Electron frontend via IPC
    process.send({ 
      type: 'transcript', 
      data: { 
        text: userMessage,
        speakerInfo: formattedSpeakerInfo,
        source: 'microphone'
      } 
    });
    
    microphoneIsFinalEndTime = microphoneResultEndTime;
    lastMicrophoneTranscriptWasFinal = true;
  } else {
    // Make sure transcript does not exceed console character length
    if (stdoutText.length > process.stdout.columns) {
      stdoutText =
        stdoutText.substring(0, process.stdout.columns - 4) + '...';
    }
    // Process interim results immediately (not just final ones)
    if (stream.results[0] && stream.results[0].alternatives[0] && !stream.results[0].isFinal) {
      const transcript = stream.results[0].alternatives[0].transcript;
      // Skip sending empty interim transcripts
      if (transcript && transcript.trim().length > 0) {
        // Send interim transcript for immediate display
        process.send({ 
          type: 'interim-transcript', 
          data: { text: transcript, interim: true, source: 'microphone' } 
        });
      }
    }
    
    lastMicrophoneTranscriptWasFinal = false;
  }
};

const systemAudioSpeechCallback = stream => {
  // console.log(`[DEBUG] System audio speech callback called with stream:`, JSON.stringify(stream, null, 2));
  
  // Check if stream has results before processing
  if (!stream.results || !stream.results[0]) {
    // console.log(`[DEBUG] System audio callback: No results in stream`);
    return;
  }

  // Convert API result end time from seconds + nanoseconds to milliseconds
  systemAudioResultEndTime =
    stream.results[0].resultEndTime.seconds * 1000 +
    Math.round(stream.results[0].resultEndTime.nanos / 1000000);

  // Calculate correct time based on offset from audio sent twice
  const correctedTime =
    systemAudioResultEndTime - systemAudioBridgingOffset + streamingLimit * systemAudioRestartCounter;

  // Fix: Check if process.stdout.clearLine exists before calling it
  if (process.stdout.clearLine) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
  }
  
  let stdoutText = '';
  
  if (stream.results[0] && stream.results[0].alternatives[0]) {
    const transcript = stream.results[0].alternatives[0].transcript;
    stdoutText = correctedTime + ': ' + transcript;
    
    // LATENCY: Calculate buffer-to-transcript time
    const transcriptReceivedAt = Date.now();
    if (systemAudioInput.length > 0) {
      const lastChunk = systemAudioInput[systemAudioInput.length - 1];
      if (lastChunk && lastChunk.bufferReceivedAt) {
        const bufferToTranscriptLatency = transcriptReceivedAt - lastChunk.bufferReceivedAt;
        // console.log(`⏱️ [LATENCY] System audio buffer-to-transcript: ${bufferToTranscriptLatency}ms`);
      }
    }
    
    // DEBUG: Print transcript data
    // console.log(`🔊 [SYSTEM AUDIO TRANSCRIPT] Length: ${transcript.length}, Content: "${transcript}", isFinal: ${stream.results[0].isFinal}`);"${transcript}", isFinal: ${stream.results[0].isFinal}`);
    
    // Process interim results immediately (not just final ones)
    if (!stream.results[0].isFinal) {
      // Send interim transcript for immediate display
      process.send({ 
        type: 'interim-transcript', 
        data: { text: transcript, interim: true, source: 'systemAudio' }
      });
    }
  }

  if (stream.results[0].isFinal) {
    // Get the finalized transcript
    const userMessage = stream.results[0].alternatives[0].transcript;
    
    // Send transcript to the Electron frontend via IPC for system audio (interviewer)
    // This will go to the interview question box
    process.send({ 
      type: 'transcript', 
      data: { 
        text: userMessage,
        speakerInfo: {
          hasSpeakerInfo: true,
          segments: [{
            speakerId: 'systemAudio',
            text: userMessage,
            role: 'interviewer'
          }]
        },
        source: 'systemAudio'
      } 
    });
    
    systemAudioIsFinalEndTime = systemAudioResultEndTime;
    lastSystemAudioTranscriptWasFinal = true;
  } else {
    // Make sure transcript does not exceed console character length
    if (stdoutText.length > process.stdout.columns) {
      stdoutText =
        stdoutText.substring(0, process.stdout.columns - 4) + '...';
    }
    
    lastSystemAudioTranscriptWasFinal = false;
  }
};

let systemAudioBuffer = []; // Buffer for system audio
const TARGET_AUDIO_BUFFER_SIZE = 8 * 1024; // 8KB target buffer size
const BUFFER_FLUSH_TIMEOUT = 500; // 500ms timeout for buffer flushing

// Timer variables for time-based buffer flushing
let microphoneBufferTimer = null;
let systemAudioBufferTimer = null;

// Dual Stream Management
class DualStreamManager {
  constructor() {
    this.microphoneStreamActive = false;
    this.systemAudioStreamActive = false;
    this.concurrentProcessing = false;
  }

  startConcurrentProcessing() {
    this.concurrentProcessing = true;
    console.log('🔄 Dual stream concurrent processing enabled');
  }

  stopConcurrentProcessing() {
    this.concurrentProcessing = false;
    this.microphoneStreamActive = false;
    this.systemAudioStreamActive = false;
    console.log('⏹️ Dual stream concurrent processing disabled');
  }

  setMicrophoneStreamStatus(active) {
    this.microphoneStreamActive = active;
    if (active && this.systemAudioStreamActive) {
      this.startConcurrentProcessing();
    }
  }

  setSystemAudioStreamStatus(active) {
    this.systemAudioStreamActive = active;
    if (active && this.microphoneStreamActive) {
      this.startConcurrentProcessing();
    }
  }

  isConcurrentProcessingActive() {
    return this.concurrentProcessing && this.microphoneStreamActive && this.systemAudioStreamActive;
  }

  enableMicOnlyMode() {
    if (this.microphoneStreamActive && !this.systemAudioStreamActive) {
      this.concurrentProcessing = true;
      console.log('🎤 Microphone-only processing enabled');
      
      // Start speech stream processing for microphone only
      if (microphoneRecognizeStream) {
        console.log('✅ Microphone stream is active and processing');
      }
    }
  }

  enableSystemAudioOnlyMode() {
    if (this.systemAudioStreamActive) {
      this.concurrentProcessing = true;
      console.log('🖥️ System audio-only processing enabled (most important for interview questions)');
      
      // Start speech stream processing for system audio only
      if (systemAudioRecognizeStream) {
        console.log('✅ System audio stream is active and processing');
      }
    }
  }

  getStreamStatus() {
    return {
      microphone: this.microphoneStreamActive,
      systemAudio: this.systemAudioStreamActive,
      concurrent: this.concurrentProcessing
    };
  }
}

const dualStreamManager = new DualStreamManager();

// Separate audio input transforms for microphone and system audio
const microphoneAudioInputStreamTransform = new Writable({
  write(chunk, encoding, next) {
    console.log(`🔍 [DEBUG] Microphone audio data received - isRecording: ${isRecording}, chunk size: ${chunk?.length || 'unknown'}`);
    
    // Only process chunks if we're actively recording
    if (!isRecording) {
      console.log(`⚠️ [DEBUG] Dropping microphone chunk because isRecording=${isRecording}`);
      next();
      return;
    }
    
    // Mark microphone stream as active for dual stream management
    if (!dualStreamManager.microphoneStreamActive) {
      console.log('✅ [DEBUG] Marking microphone stream as ACTIVE');
      dualStreamManager.setMicrophoneStreamStatus(true);
      
      // Track first audio data received
      if (!firstAudioDataTime && recordingStartClickTime) {
        firstAudioDataTime = Date.now();
        const firstDataDuration = firstAudioDataTime - recordingStartClickTime;
        console.log(`🎯 [TIMING] First microphone audio data received: ${firstDataDuration}ms from user click`);
      }
    }
    
    if (newMicrophoneStream && lastMicrophoneAudioInput.length !== 0) {
      // Approximate math to calculate time of chunks
      const chunkTime = streamingLimit / lastMicrophoneAudioInput.length;
      if (chunkTime !== 0) {
        if (microphoneBridgingOffset < 0) {
          microphoneBridgingOffset = 0;
        }
        if (microphoneBridgingOffset > microphoneFinalRequestEndTime) {
          microphoneBridgingOffset = microphoneFinalRequestEndTime;
        }
        const chunksFromMS = Math.floor(
          (microphoneFinalRequestEndTime - microphoneBridgingOffset) / chunkTime
        );
        microphoneBridgingOffset = Math.floor(
          (lastMicrophoneAudioInput.length - chunksFromMS) * chunkTime
        );
        
        // Check if microphoneRecognizeStream is valid before writing to it
        if (microphoneRecognizeStream && !microphoneRecognizeStream.destroyed && !microphoneRecognizeStream.writableEnded) {
          for (let i = chunksFromMS; i < lastMicrophoneAudioInput.length; i++) {
            try {
              microphoneRecognizeStream.write(lastMicrophoneAudioInput[i]);
            } catch (err) {
              console.error('Error writing to microphoneRecognizeStream:', err.message);
              break;
            }
          }
        }
      }
      newMicrophoneStream = false;
    }

    // DEBUG: Print buffer data
    //console.log(`🎤 [MICROPHONE BUFFER] Received chunk: ${chunk.length} bytes, isRecording: ${isRecording}`);
    
    // LATENCY: Track buffer processing time
    const bufferProcessStartTime = Date.now();
    chunk.bufferReceivedAt = bufferProcessStartTime;
    
    // Only store audio input if we're actively recording
    if (isRecording) {
      microphoneAudioInput.push(chunk);
      microphoneAudioBuffer.push(chunk); // Add chunk to our new buffer
      
      // Set buffer start time if this is the first chunk
      if (microphoneBufferStartTime === null) {
        microphoneBufferStartTime = Date.now();
      }

      let totalBufferSize = 0;
      for (const buf of microphoneAudioBuffer) {
        totalBufferSize += buf.length;
      }

      // Function to flush microphone buffer
      const flushMicrophoneBuffer = () => {
        if (microphoneAudioBuffer.length > 0) {
          const concatenatedBuffer = Buffer.concat(microphoneAudioBuffer);
          if (microphoneRecognizeStream && !microphoneRecognizeStream.destroyed && !microphoneRecognizeStream.writableEnded) {
            try {
              microphoneRecognizeStream.write(concatenatedBuffer);
            } catch (err) {
              console.error('Error writing buffered data to microphoneRecognizeStream:', err.message);
            }
          }
          microphoneAudioBuffer = []; // Clear the buffer
          microphoneBufferStartTime = null;
          if (microphoneBufferTimer) {
            clearTimeout(microphoneBufferTimer);
            microphoneBufferTimer = null;
          }
        }
      };

      // If buffer is large enough, flush immediately
      if (totalBufferSize >= TARGET_AUDIO_BUFFER_SIZE) {
        flushMicrophoneBuffer();
      } else {
        // Set up time-based flushing if not already set
        if (!microphoneBufferTimer) {
          microphoneBufferTimer = setTimeout(() => {
            flushMicrophoneBuffer();
          }, BUFFER_FLUSH_TIMEOUT);
        }
      }
    }

    next();
  },

  final() {
    // Mark microphone stream as inactive
    dualStreamManager.setMicrophoneStreamStatus(false);
    
    // Flush any remaining data in the buffer before ending the stream
    if (microphoneAudioBuffer.length > 0) {
      const concatenatedBuffer = Buffer.concat(microphoneAudioBuffer);
      if (microphoneRecognizeStream && !microphoneRecognizeStream.destroyed && !microphoneRecognizeStream.writableEnded) {
        try {
          microphoneRecognizeStream.write(concatenatedBuffer);
        } catch (err) {
          console.error('Error writing remaining buffered data to microphoneRecognizeStream:', err.message);
        }
      }
      microphoneAudioBuffer = []; // Clear the buffer
    }

    // Check if microphoneRecognizeStream is valid before ending it
    if (microphoneRecognizeStream && !microphoneRecognizeStream.destroyed) {
      try {
        microphoneRecognizeStream.end();
      } catch (err) {
        console.error('Error ending microphoneRecognizeStream:', err.message);
      }
    }
    
    console.log('🎤 Microphone stream finalized');
  },
});

let microphoneAudioBuffer = []; // Buffer for microphone audio
let microphoneBufferStartTime = null; // Track when buffer started accumulating
let systemAudioBufferStartTime = null; // Track when system audio buffer started accumulating

const systemAudioInputStreamTransform = new Writable({
  write(chunk, encoding, next) {
    console.log(`🔍 [DEBUG] System audio data received - isRecording: ${isRecording}, chunk size: ${chunk?.length || 'unknown'}`);
    
    // Only process chunks if we're actively recording
    if (!isRecording) {
      console.log(`⚠️ [DEBUG] Dropping system audio chunk because isRecording=${isRecording}`);
      next();
      return;
    }
    
    // Mark system audio stream as active for dual stream management
    if (!dualStreamManager.systemAudioStreamActive) {
      console.log('✅ [DEBUG] Marking system audio stream as ACTIVE');
      dualStreamManager.setSystemAudioStreamStatus(true);
      
      // Track first system audio data received (only if microphone hasn't already logged)
      if (!firstAudioDataTime && recordingStartClickTime) {
        firstAudioDataTime = Date.now();
        const firstDataDuration = firstAudioDataTime - recordingStartClickTime;
        console.log(`🎯 [TIMING] First system audio data received: ${firstDataDuration}ms from user click`);
      }
    }
    
    if (newSystemAudioStream && lastSystemAudioInput.length !== 0) {
      // Approximate math to calculate time of chunks
      const chunkTime = streamingLimit / lastSystemAudioInput.length;
      if (chunkTime !== 0) {
        if (systemAudioBridgingOffset < 0) {
          systemAudioBridgingOffset = 0;
        }
        if (systemAudioBridgingOffset > systemAudioFinalRequestEndTime) {
          systemAudioBridgingOffset = systemAudioFinalRequestEndTime;
        }
        const chunksFromMS = Math.floor(
          (systemAudioFinalRequestEndTime - systemAudioBridgingOffset) / chunkTime
        );
        systemAudioBridgingOffset = Math.floor(
          (lastSystemAudioInput.length - chunksFromMS) * chunkTime
        );
        
        // Check if systemAudioRecognizeStream is valid before writing to it
        if (systemAudioRecognizeStream && !systemAudioRecognizeStream.destroyed && !systemAudioRecognizeStream.writableEnded) {
          for (let i = chunksFromMS; i < lastSystemAudioInput.length; i++) {
            try {
              systemAudioRecognizeStream.write(lastSystemAudioInput[i]);
            } catch (err) {
              console.error('Error writing to systemAudioRecognizeStream:', err.message);
              break;
            }
          }
        }
      }
      newSystemAudioStream = false;
    }

    // DEBUG: Print buffer data
    //  Received chunk: ${chunk.length} bytes, isRecording: ${isRecording}`);
    
    // LATENCY: Track buffer processing time
    const bufferProcessStartTime = Date.now();
    chunk.bufferReceivedAt = bufferProcessStartTime;
    
    // Only store audio input if we're actively recording
    if (isRecording) {
      systemAudioInput.push(chunk);
      systemAudioBuffer.push(chunk); // Add chunk to our new buffer
      
      // Set buffer start time if this is the first chunk
      if (systemAudioBuffer.length === 1) {
        systemAudioBufferStartTime = Date.now();
      }

      let totalBufferSize = 0;
      for (const buf of systemAudioBuffer) {
        totalBufferSize += buf.length;
      }

      // Function to flush system audio buffer
      const flushSystemAudioBuffer = () => {
        if (systemAudioBuffer.length > 0) {
          const concatenatedBuffer = Buffer.concat(systemAudioBuffer);
          if (systemAudioRecognizeStream && !systemAudioRecognizeStream.destroyed && !systemAudioRecognizeStream.writableEnded) {
            try {
              systemAudioRecognizeStream.write(concatenatedBuffer);
            } catch (err) {
              console.error('Error writing buffered data to systemAudioRecognizeStream:', err.message);
            }
          }
          systemAudioBuffer = []; // Clear the buffer
          if (systemAudioBufferTimer) {
            clearTimeout(systemAudioBufferTimer);
            systemAudioBufferTimer = null;
          }
        }
      };

      // If buffer is large enough, flush immediately
      if (totalBufferSize >= TARGET_AUDIO_BUFFER_SIZE) {
        flushSystemAudioBuffer();
      } else {
        // Set up time-based flushing if not already set
        if (!systemAudioBufferTimer) {
          systemAudioBufferTimer = setTimeout(() => {
            flushSystemAudioBuffer();
          }, BUFFER_FLUSH_TIMEOUT);
        }
      }
    }

    next();
  },

  final() {
    // Mark system audio stream as inactive
    dualStreamManager.setSystemAudioStreamStatus(false);
    
    // Flush any remaining data in the buffer before ending the stream
    if (systemAudioBuffer.length > 0) {
      const concatenatedBuffer = Buffer.concat(systemAudioBuffer);
      if (systemAudioRecognizeStream && !systemAudioRecognizeStream.destroyed && !systemAudioRecognizeStream.writableEnded) {
        try {
          systemAudioRecognizeStream.write(concatenatedBuffer);
        } catch (err) {
          console.error('Error writing remaining buffered data to systemAudioRecognizeStream:', err.message);
        }
      }
      systemAudioBuffer = []; // Clear the buffer
    }

    // Check if systemAudioRecognizeStream is valid before ending it
    if (systemAudioRecognizeStream && !systemAudioRecognizeStream.destroyed) {
      try {
        systemAudioRecognizeStream.end();
      } catch (err) {
        console.error('Error ending systemAudioRecognizeStream:', err.message);
      }
    }
    
    console.log('🔊 System audio stream finalized');
  },
});

function restartStream() {
  // Don't restart if we're not recording
  if (!isRecording) {
    return;
  }
  
  // Always restart microphone stream
  restartMicrophoneStream();
  
  // Only restart system audio stream if using Swift audio capture (dual stream)
  // SoX provides a mixed stream (mic + system audio) that goes through the microphone pipeline
  if (useSwiftAudioCapture && swiftAudioCaptureSupported) {
    restartSystemAudioStream();
  }
};

function restartMicrophoneStream() {
  if (microphoneRecognizeStream) {
    try {
      // First remove the listener to prevent callbacks during cleanup
      microphoneRecognizeStream.removeListener('data', microphoneSpeechCallback);
      // Then safely end the stream if it's not already destroyed or ended
      if (!microphoneRecognizeStream.destroyed && !microphoneRecognizeStream.writableEnded) {
        microphoneRecognizeStream.end();
      }
    } catch (err) {
      console.error('Error during microphone stream restart:', err.message);
    } finally {
      microphoneRecognizeStream = null;
    }
  }
  if (microphoneResultEndTime > 0) {
    microphoneFinalRequestEndTime = microphoneIsFinalEndTime;
  }
  microphoneResultEndTime = 0;

  lastMicrophoneAudioInput = microphoneAudioInput;
  microphoneAudioInput = [];
  microphoneResultEndTime = 0;
  microphoneIsFinalEndTime = 0;
  microphoneFinalRequestEndTime = 0;
  newMicrophoneStream = true;
  microphoneRestartCounter++;
  
  // Clear microphone buffer and timer
  microphoneAudioBuffer = [];
  microphoneBufferStartTime = null;
  if (microphoneBufferTimer) {
    clearTimeout(microphoneBufferTimer);
    microphoneBufferTimer = null;
  }

  if (!lastMicrophoneTranscriptWasFinal) {
    process.stdout.write('\n');
  }
  process.stdout.write(
    `${microphoneRestartCounter * streamingLimit}ms: RESTARTING MICROPHONE REQUEST\n`
  );

  startMicrophoneStream();
};

function restartSystemAudioStream() {
  if (systemAudioRecognizeStream) {
    try {
      // First remove the listener to prevent callbacks during cleanup
      systemAudioRecognizeStream.removeListener('data', systemAudioSpeechCallback);
      // Then safely end the stream if it's not already destroyed or ended
      if (!systemAudioRecognizeStream.destroyed && !systemAudioRecognizeStream.writableEnded) {
        systemAudioRecognizeStream.end();
      }
    } catch (err) {
      console.error('Error during system audio stream restart:', err.message);
    } finally {
      systemAudioRecognizeStream = null;
    }
  }
  if (systemAudioResultEndTime > 0) {
    systemAudioFinalRequestEndTime = systemAudioIsFinalEndTime;
  }
  systemAudioResultEndTime = 0;

  lastSystemAudioInput = [];
  lastSystemAudioInput = systemAudioInput;
  
  // Reset audio input for the new stream
  systemAudioInput = [];

  systemAudioRestartCounter++;
  
  // Clear system audio buffer and timer
  systemAudioBuffer = [];
  systemAudioBufferStartTime = null;
  if (systemAudioBufferTimer) {
    clearTimeout(systemAudioBufferTimer);
    systemAudioBufferTimer = null;
  }

  if (!lastSystemAudioTranscriptWasFinal) {
    process.stdout.write('\n');
  }

  systemAudioNewStream = true;

  // Small delay before starting the new stream to ensure proper cleanup
  setTimeout(() => {
    if (isRecording) {
      startSystemAudioStream();
    }
  }, 100);
};
// Process text context provided by the user
async function setTextContext(text) {
  // Skip context processing if interview is in progress
  if (isRecording) {
    console.log('[SERVER] setTextContext: Skipping text context processing - interview in progress');
    return;
  }
  
  console.log('[SERVER] setTextContext: Processing text context, length:', text.length);
  try {
    // Extract structured content from the text
    console.log('[SERVER] setTextContext: Extracting structured content from text...');
    const extractResult = await model.generateContent([
      `Read the following document and extract the key information in a structured format that can be used as context for a conversation:\n\n${text}`
    ]);
    extractedContent = extractResult.response.text();
    console.log('[SERVER] setTextContext: Extracted content length:', extractedContent.length);
    
    // Generate summary for text content
    console.log('[SERVER] setTextContext: Generating summary...');
    const result = await model.generateContent([
      `Summarize this document in 3-5 sentences:\n\n${text}`
    ]);
    documentSummary = result.response.text();
    console.log('[SERVER] setTextContext: Generated summary:', documentSummary);
    
    // Use the extracted content
    fileContext = extractedContent;
    fileContentPart = null;
    
    // Initialize chat with the new context
    console.log('[SERVER] setTextContext: Initializing chat with new context...');
    await initializeChat();
    
    // Send the summary to the frontend
    console.log('[SERVER] setTextContext: Preparing context-update message with summary...');
    const contextUpdateData = { 
      summary: documentSummary,
      isFile: false
    };
    // Context update data prepared (log removed for cleaner output)
    
    // Send the message to the main process
    process.send({ 
      type: 'context-update', 
      data: contextUpdateData
    });
    console.log('[SERVER] setTextContext: context-update message sent to main process');
    
    // Send context data to main process for saving to database
    console.log('[SERVER] setTextContext: Sending save-context message to main process...');
    process.send({
      type: 'save-context',
      data: {
        type: 'text',
        title: 'Text Context ' + new Date().toISOString().split('T')[0],
        content: extractedContent,
        metadata: {
          summary: documentSummary,
          rawLength: text.length,
          processedAt: new Date().toISOString()
        }
      }
    });
    console.log('[SERVER] setTextContext: save-context message sent to main process');
    
  } catch (error) {
    process.send({ type: 'error', data: { message: `Error processing text: ${error.message}` } });
  }
}

// Process a context file uploaded by the user
async function processContextFile(filePath, fileName) {
  // Skip context processing if interview is in progress
  if (isRecording) {
    console.log('[SERVER] processContextFile: Skipping file context processing - interview in progress');
    return;
  }
  
  // Use the provided fileName or extract it from the path if not provided
  fileName = fileName || path.basename(filePath);
  console.log('[SERVER] processContextFile: Processing file context:', fileName);
  try {
    const fileExtension = filePath.split('.').pop().toLowerCase();
    console.log('[SERVER] processContextFile: File extension:', fileExtension);
    
    // Determine MIME type based on file extension
    let mimeType = 'text/plain';
    if (['pdf'].includes(fileExtension)) {
      mimeType = 'application/pdf';
    } else if (['png', 'jpg', 'jpeg', 'gif'].includes(fileExtension)) {
      mimeType = `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;
    } else if (['docx'].includes(fileExtension)) {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    console.log('[SERVER] processContextFile: Using MIME type:', mimeType);
    
    // For text files, read as UTF-8
    if (mimeType === 'text/plain') {
      console.log('[SERVER] processContextFile: Processing as text file...');
      const rawFileContent = fs.readFileSync(filePath, 'utf8');
      console.log('[SERVER] processContextFile: Loaded text file, content length:', rawFileContent.length);
      
      // Extract structured content from the document
      console.log('[SERVER] processContextFile: Extracting structured content...');
      const extractResult = await model.generateContent([
        `Read the following document and extract the key information in a structured format that can be used as context for a conversation:\n\n${rawFileContent}`
      ]);
      extractedContent = extractResult.response.text();
      console.log('[SERVER] processContextFile: Extracted content length:', extractedContent.length);
      
      // Generate summary for text content
      console.log('[SERVER] processContextFile: Generating summary...');
      const result = await model.generateContent([
        `Summarize this document in 3-5 sentences:\n\n${rawFileContent}`
      ]);
      documentSummary = result.response.text();
      console.log('[SERVER] processContextFile: Generated summary:', documentSummary);
      
      // Use the extracted content instead of raw file content
      fileContext = extractedContent;
      fileContentPart = null;
    } 
    // For binary files, read as base64 for Gemini multimodal input
    else {
      console.log('[SERVER] processContextFile: Processing as binary file...');
      const fileBuffer = fs.readFileSync(filePath);
      const base64Data = fileBuffer.toString('base64');
      fileContentPart = {
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      };
      console.log('[SERVER] processContextFile: Loaded binary file, size:', fileBuffer.length);
      
      // Extract structured content from the document
      console.log('[SERVER] processContextFile: Extracting structured content from binary...');
      const extractResult = await model.generateContent([
        fileContentPart,
        'Read this document and extract the key information in a structured format that can be used as context for a conversation'
      ]);
      extractedContent = extractResult.response.text();
      console.log('[SERVER] processContextFile: Extracted content length:', extractedContent.length);
      
      // Generate summary for binary content
      console.log('[SERVER] processContextFile: Generating summary from binary...');
      const result = await model.generateContent([
        fileContentPart,
        'Summarize this document in 3-5 sentences'
      ]);
      documentSummary = result.response.text();
      console.log('[SERVER] processContextFile: Generated summary:', documentSummary);
    }
    
    // Initialize chat with the new context
    console.log('[SERVER] processContextFile: Initializing chat with new context...');
    await initializeChat();
    
    // Prepare context update data with detailed logging
    console.log('[SERVER] processContextFile: Preparing context-update message...');
    const contextUpdateData = { 
      message: `File context set: ${fileName}`,
      summary: documentSummary,
      isFile: true
    };
    
    // Log the exact data being sent
    // Context update data structure prepared (log removed for cleaner output)
    
    // Send confirmation and summary to the renderer via main process
    console.log('[SERVER] processContextFile: Sending context-update to main process...');
    process.send({ 
      type: 'context-update', 
      data: contextUpdateData
    });
    console.log('[SERVER] processContextFile: context-update message sent to main process');
    
    // Send context data to main process for saving to database
    process.send({
      type: 'save-context',
      data: {
        type: 'file',
        title: fileName,
        content: extractedContent,
        metadata: {
          summary: documentSummary,
          fileType: mimeType,
          fileName: fileName,
          processedAt: new Date().toISOString()
        }
      }
    });
    
  } catch (error) {
    // console.error(chalk.red(`Error processing file: ${error.message}`));
    process.send({ type: 'error', data: { message: `Error processing file: ${error.message}` } });
  }
}

// Start the recording and send the microphone input to the Speech API
async function main() {
  // Initialize Gemini for screenshot processing
  initializeGemini();
  
  // Generate document summary if file is provided
  await generateDocumentSummary();
  
  // Initialize chat with the document context
  await initializeChat();
  
  // Pre-initialize speech recognition for faster startup
  await preInitializeSpeechRecognition();
  
  // Don't automatically start recording
  console.log('Click Start to begin recording.');
  
  // Notify the frontend that we're ready
  process.send({ type: 'ready', data: { isReady: true } });
}

// Run the main function
(async () => {
  await main();
})().catch(error => {
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', async () => {
  // Stop recording if it's running
  if (isRecording) {
    await stopRecording();
  }
  console.log('Closing connections and exiting...');
  process.exit(0);
});

// Process a screenshot using optimized single Gemini call
// Function to enhance formatting for code and math content
function enhanceFormatting(text) {
  let enhanced = text;
  
  // Ensure proper code block formatting with language detection
  enhanced = enhanced.replace(/```([\s\S]*?)```/g, (match, code) => {
    const trimmedCode = code.trim();
    
    // If no language specified, try to detect it
    if (!trimmedCode.match(/^\w+\n/)) {
      const detectedLang = detectCodeLanguage(trimmedCode);
      if (detectedLang) {
        return `\`\`\`${detectedLang}\n${trimmedCode}\n\`\`\``;
      }
    }
    
    // Ensure proper formatting
    return `\`\`\`${trimmedCode}\n\`\`\``;
  });
  
  // Enhance inline code formatting
  enhanced = enhanced.replace(/`([^`]+)`/g, (match, code) => {
    return `\`${code.trim()}\``;
  });
  
  // Ensure LaTeX math formatting is preserved and enhanced
  // Block math equations
  enhanced = enhanced.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    return `$$${math.trim()}$$`;
  });
  
  // Inline math expressions
  enhanced = enhanced.replace(/\$([^$\n]+)\$/g, (match, math) => {
    return `$${math.trim()}$`;
  });
  
  // Improve markdown formatting
  enhanced = enhanced.replace(/^(#{1,6})\s*(.+)$/gm, (match, hashes, title) => {
    return `${hashes} ${title.trim()}`;
  });
  
  // Ensure proper list formatting
  enhanced = enhanced.replace(/^[\s]*[-*+]\s+(.+)$/gm, (match, item) => {
    return `- ${item.trim()}`;
  });
  
  // Ensure proper numbered list formatting
  enhanced = enhanced.replace(/^[\s]*\d+\.\s+(.+)$/gm, (match, item) => {
    const num = match.match(/^[\s]*(\d+)\./)[1];
    return `${num}. ${item.trim()}`;
  });
  
  return enhanced;
}

// Function to detect programming language from code content
function detectCodeLanguage(code) {
  const trimmedCode = code.trim().toLowerCase();
  
  // JavaScript/TypeScript patterns
  if (trimmedCode.includes('function') || trimmedCode.includes('const ') || 
      trimmedCode.includes('let ') || trimmedCode.includes('var ') ||
      trimmedCode.includes('console.log') || trimmedCode.includes('=>') ||
      trimmedCode.includes('import ') || trimmedCode.includes('export ')) {
    return 'javascript';
  }
  
  // Python patterns
  if (trimmedCode.includes('def ') || trimmedCode.includes('import ') ||
      trimmedCode.includes('print(') || trimmedCode.includes('if __name__') ||
      trimmedCode.includes('class ') && trimmedCode.includes(':')) {
    return 'python';
  }
  
  // Java patterns
  if (trimmedCode.includes('public class') || trimmedCode.includes('public static void main') ||
      trimmedCode.includes('System.out.println') || trimmedCode.includes('import java.')) {
    return 'java';
  }
  
  // C/C++ patterns
  if (trimmedCode.includes('#include') || trimmedCode.includes('int main(') ||
      trimmedCode.includes('printf(') || trimmedCode.includes('cout <<')) {
    return trimmedCode.includes('cout') ? 'cpp' : 'c';
  }
  
  // HTML patterns
  if (trimmedCode.includes('<html') || trimmedCode.includes('<!doctype') ||
      trimmedCode.includes('<div') || trimmedCode.includes('<script')) {
    return 'html';
  }
  
  // CSS patterns
  if (trimmedCode.includes('{') && trimmedCode.includes('}') &&
      (trimmedCode.includes(':') && trimmedCode.includes(';'))) {
    return 'css';
  }
  
  // SQL patterns
  if (trimmedCode.includes('select ') || trimmedCode.includes('insert ') ||
      trimmedCode.includes('update ') || trimmedCode.includes('delete ') ||
      trimmedCode.includes('create table')) {
    return 'sql';
  }
  
  // JSON patterns
  if ((trimmedCode.startsWith('{') && trimmedCode.endsWith('}')) ||
      (trimmedCode.startsWith('[') && trimmedCode.endsWith(']'))) {
    try {
      JSON.parse(code);
      return 'json';
    } catch (e) {
      // Not valid JSON
    }
  }
  
  // Shell/Bash patterns
  if (trimmedCode.includes('#!/bin/bash') || trimmedCode.includes('echo ') ||
      trimmedCode.includes('cd ') || trimmedCode.includes('ls ') ||
      trimmedCode.includes('grep ')) {
    return 'bash';
  }
  
  return null; // No language detected
}

// Smart cropping function to focus on relevant UI elements
async function smartCropImage(sharpInstance, width, height) {
  const cropStartTime = Date.now();
  const CROP_TIMEOUT = 1000; // 1 second timeout
  
  try {
    // Add timeout wrapper
    const cropPromise = (async () => {
      // Convert to grayscale for edge detection
      const grayBuffer = await sharpInstance.clone().grayscale().raw().toBuffer();
      
      // Analyze image for UI elements using simple heuristics
      const cropRegions = await detectUIElements(grayBuffer, width, height);
      
      if (cropRegions.length > 0) {
        // Select the most relevant crop region
        const bestRegion = selectBestCropRegion(cropRegions, width, height);
        
        if (bestRegion) {
          // Apply the crop
          const croppedBuffer = await sharpInstance
            .extract({
              left: bestRegion.left,
              top: bestRegion.top,
              width: bestRegion.width,
              height: bestRegion.height
            })
            .toBuffer();
          
          return {
            cropped: true,
            buffer: croppedBuffer,
            description: `${bestRegion.type} region (${bestRegion.width}x${bestRegion.height}) in ${Date.now() - cropStartTime}ms`
          };
        }
      }
      
      // No suitable crop region found, return original
      return { cropped: false, buffer: await sharpInstance.toBuffer() };
    })();
    
    // Race between crop operation and timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Crop timeout')), CROP_TIMEOUT);
    });
    
    return await Promise.race([cropPromise, timeoutPromise]);
    
  } catch (error) {
    const elapsed = Date.now() - cropStartTime;
    console.log(`[PERF] Smart crop ${error.message === 'Crop timeout' ? 'timed out' : 'failed'} after ${elapsed}ms, using original image`);
    return { cropped: false, buffer: await sharpInstance.toBuffer() };
  }
}

// Detect UI elements in the image using edge detection and pattern analysis
async function detectUIElements(grayBuffer, width, height) {
  const regions = [];
  const minRegionSize = Math.min(width, height) * 0.1; // Minimum 10% of smallest dimension
  
  // Optimized scanning with larger step size and early termination
  const stepSize = Math.max(8, Math.floor(Math.min(width, height) / 50)); // Increased step size
  const maxRegions = 20; // Limit number of regions to analyze
  
  for (let y = 0; y < height - minRegionSize && regions.length < maxRegions; y += stepSize) {
    for (let x = 0; x < width - minRegionSize && regions.length < maxRegions; x += stepSize) {
      const region = analyzeRegion(grayBuffer, x, y, width, height, minRegionSize);
      if (region && region.score > 0.3) { // Threshold for UI element detection
        regions.push(region);
      }
    }
  }
  
  return regions;
}

// Analyze a specific region for UI element characteristics (optimized)
function analyzeRegion(grayBuffer, startX, startY, imageWidth, imageHeight, regionSize) {
  const endX = Math.min(startX + regionSize, imageWidth);
  const endY = Math.min(startY + regionSize, imageHeight);
  
  let edgeCount = 0;
  let textLikePixels = 0;
  let totalPixels = 0;
  
  // Optimized sampling: check every 4th pixel for speed
  const sampleStep = 4;
  
  for (let y = startY; y < endY - 1; y += sampleStep) {
    for (let x = startX; x < endX - 1; x += sampleStep) {
      const idx = y * imageWidth + x;
      const current = grayBuffer[idx];
      const right = grayBuffer[idx + 1];
      const below = grayBuffer[(y + 1) * imageWidth + x];
      
      // Edge detection (simple gradient)
      const edgeStrength = Math.abs(current - right) + Math.abs(current - below);
      if (edgeStrength > 30) edgeCount++;
      
      // Text-like pattern detection (high contrast variations)
      if (current < 100 || current > 200) textLikePixels++;
      
      totalPixels++;
    }
  }
  
  const edgeRatio = edgeCount / totalPixels;
  const textRatio = textLikePixels / totalPixels;
  
  // Score based on edge density and text-like patterns
  const score = (edgeRatio * 0.7) + (textRatio * 0.3);
  
  if (score > 0.3) {
    return {
      left: startX,
      top: startY,
      width: endX - startX,
      height: endY - startY,
      score: score,
      type: textRatio > 0.4 ? 'text' : 'ui-element'
    };
  }
  
  return null;
}

// Select the best crop region based on relevance and size
function selectBestCropRegion(regions, imageWidth, imageHeight) {
  if (regions.length === 0) return null;
  
  // Sort regions by score and prefer larger, more central regions
  const scoredRegions = regions.map(region => {
    const centerX = region.left + region.width / 2;
    const centerY = region.top + region.height / 2;
    const imageCenterX = imageWidth / 2;
    const imageCenterY = imageHeight / 2;
    
    // Distance from image center (normalized)
    const centerDistance = Math.sqrt(
      Math.pow((centerX - imageCenterX) / imageWidth, 2) +
      Math.pow((centerY - imageCenterY) / imageHeight, 2)
    );
    
    // Size factor (prefer larger regions)
    const sizeFactor = (region.width * region.height) / (imageWidth * imageHeight);
    
    // Combined score: base score + size bonus - center distance penalty
    const finalScore = region.score + (sizeFactor * 0.5) - (centerDistance * 0.3);
    
    return { ...region, finalScore };
  });
  
  // Sort by final score and return the best region
  scoredRegions.sort((a, b) => b.finalScore - a.finalScore);
  
  const bestRegion = scoredRegions[0];
  
  // Ensure minimum crop size (at least 25% of original)
  const minCropArea = (imageWidth * imageHeight) * 0.25;
  const cropArea = bestRegion.width * bestRegion.height;
  
  if (cropArea >= minCropArea) {
    return bestRegion;
  }
  
  return null;
}

async function processScreenshot(screenshotPath) {
  const processingStartTime = Date.now();
  
  try {
    console.log(`[PERF] Starting screenshot processing: ${screenshotPath}`);
    
    // Read the screenshot file as base64 with async operation
    const readStartTime = Date.now();
    const fileBuffer = await fs.promises.readFile(screenshotPath);
    const readTime = Date.now() - readStartTime;
    console.log(`[PERF] File read took: ${readTime}ms (${fileBuffer.length} bytes)`);
    
    // Smart cropping and compression for faster Gemini processing
    const processStartTime = Date.now();
    const sharp = require('sharp');
    
    // Get image metadata for smart cropping
    const imageInfo = await sharp(fileBuffer).metadata();
    const { width, height } = imageInfo;
    console.log(`[PERF] Original image dimensions: ${width}x${height}`);
    
    // Apply smart cropping to focus on relevant UI elements
    let processedBuffer = fileBuffer;
    const cropResult = await smartCropImage(sharp(fileBuffer), width, height);
    if (cropResult.cropped) {
      processedBuffer = cropResult.buffer;
      console.log(`[PERF] Smart crop applied: ${cropResult.description}`);
    }
    
    // Compress the processed image
    const compressedBuffer = await sharp(processedBuffer)
      .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const processTime = Date.now() - processStartTime;
    console.log(`[PERF] Image processing took: ${processTime}ms (${fileBuffer.length} -> ${compressedBuffer.length} bytes, ${Math.round((1 - compressedBuffer.length/fileBuffer.length) * 100)}% reduction)`);
    
    // Create the image part for Gemini
    const imagePart = {
      inlineData: {
        data: compressedBuffer.toString('base64'),
        mimeType: 'image/jpeg'
      }
    };
    
    // Check for rate limiting to prevent overwhelming the AI service
    const currentTime = Date.now();
    if (currentTime - lastProcessedTime < MIN_PROCESSING_INTERVAL) {
      const waitTime = MIN_PROCESSING_INTERVAL - (currentTime - lastProcessedTime);
      console.log(`[PERF] Rate limiting: waiting ${waitTime}ms before processing`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastProcessedTime = Date.now();

    // Prepare context with caching for better performance
    let contextData = '';
    let promptKey = 'screenshot';
    
    if (fileContext) {
      // Use cached context if available
      const contextKey = `file_${fileContext.length}_${fileContext.substring(0, 100)}`;
      if (contextCache.has(contextKey)) {
        contextData = contextCache.get(contextKey);
        console.log('[SERVER] Using cached file context');
      } else {
        contextData = fileContext;
        contextCache.set(contextKey, contextData);
        console.log('[SERVER] Cached file context for future use');
      }
      promptKey = 'withContext';
    } else if (extractedContent) {
      // Use cached context if available
      const contextKey = `extracted_${extractedContent.length}_${extractedContent.substring(0, 100)}`;
      if (contextCache.has(contextKey)) {
        contextData = contextCache.get(contextKey);
        console.log('[SERVER] Using cached extracted content');
      } else {
        contextData = extractedContent;
        contextCache.set(contextKey, contextData);
        console.log('[SERVER] Cached extracted content for future use');
      }
      promptKey = 'withContext';
    }

    // Use optimized cached prompts
    let optimizedPrompt;
    if (promptCache.has(promptKey)) {
      optimizedPrompt = promptCache.get(promptKey);
      console.log(`[PERF] Using cached prompt template: ${promptKey}`);
    } else {
      if (promptKey === 'withContext') {
        optimizedPrompt = OPTIMIZED_PROMPTS.withContext.replace('{context}', contextData);
      } else {
        optimizedPrompt = OPTIMIZED_PROMPTS.screenshot;
      }
      promptCache.set(promptKey, optimizedPrompt);
      console.log(`[PERF] Cached prompt template: ${promptKey}`);
    }
    
    // For context-based prompts, replace the placeholder
    if (promptKey === 'withContext' && contextData) {
      optimizedPrompt = OPTIMIZED_PROMPTS.withContext.replace('{context}', contextData);
    }

    // AI processing with streaming for better UX
    const aiStartTime = Date.now();
    console.log('[PERF] Starting AI processing (streaming)...');

    // Show processing indicator in the UI
    process.send({ type: 'suggestion-processing' });

    const streamResult = await model.generateContentStream([
      imagePart,
      optimizedPrompt
    ]);

    let solutionText = '';
    for await (const chunk of streamResult.stream) {
      const chunkText = chunk.text();
      solutionText += chunkText;
      // Stream partial results to the UI with accumulated text
      process.send({
        type: 'suggestion-partial',
        data: { 
          fullText: solutionText,
          isFinal: false,
          source: 'screenshot'
        }
      });
    }

    const aiTime = Date.now() - aiStartTime;
    console.log(`[PERF] AI processing took: ${aiTime}ms`);

    // Enhanced formatting for better code and math presentation
    const formatStartTime = Date.now();
    const formattedSolution = enhanceFormatting(solutionText);
    const formatTime = Date.now() - formatStartTime;

    const totalTime = Date.now() - processingStartTime;
    console.log(`[PERF] Screenshot analysis completed in ${totalTime}ms (read: ${readTime}ms, AI: ${aiTime}ms, format: ${formatTime}ms)`);

    // Send the final, formatted solution
    process.send({
      type: 'suggestion',
      data: {
        text: formattedSolution,
        fullText: formattedSolution,
        isFinal: true,
        source: 'screenshot',
        processingTime: totalTime
      }
    });
    
    // Also send as suggestion-partial for consistency with streaming
    process.send({
      type: 'suggestion-partial',
      data: {
        fullText: formattedSolution,
        isFinal: true,
        source: 'screenshot'
      }
    });
    
    // Send minimal success notification
    process.send({
      type: 'screenshot-processed',
      data: {
        success: true,
        processingTime: totalTime
      }
    });
    
    // Asynchronously clean up screenshot file to free disk space
    setImmediate(() => {
      try {
        fs.unlinkSync(screenshotPath);
        console.log(`[CLEANUP] Removed processed screenshot: ${screenshotPath}`);
      } catch (error) {
        console.log(`[CLEANUP] Could not remove screenshot file: ${error.message}`);
      }
    });
    
    return { text: formattedSolution, source: 'screenshot', processingTime: totalTime };
  } catch (error) {
    const totalTime = Date.now() - processingStartTime;
    console.error(`[ERROR] Screenshot processing failed after ${totalTime}ms:`, error.message);
    
    // Combine error messages to reduce number of IPC calls
    process.send({
      type: 'error',
      data: {
        message: `Error processing screenshot: ${error.message}`,
        processingTime: totalTime
      }
    });
    
    // Send screenshot processed event with error
    process.send({
      type: 'screenshot-processed',
      data: {
        success: false,
        error: error.message,
        processingTime: totalTime,
        clearSuggestion: true
      }
    });
    
    return null;
  }
}

// Function to generate AI suggestions when explicitly requested
async function generateAISuggestion(transcript) {
  console.log('[SERVER] generateAISuggestion called');
  
  // Pin functionality removed
  
  // Check if the transcript is too short to generate a meaningful response
  if (transcript.trim().length < 20) {
    console.log('[SERVER] Skipping AI suggestion - transcript too short');
    process.send({ type: 'error', data: { message: 'Question is too short to generate a meaningful response.' } });
    return;
  }
  
  // Extract and log the most recent interviewer question for debugging
  const lines = transcript.split('\n');
  let mostRecentQuestion = '';
  
  // Scan through the transcript lines in reverse to find the most recent INTERVIEWER question
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('INTERVIEWER:')) {
      mostRecentQuestion = line.substring('INTERVIEWER:'.length).trim();
      break;
    }
  }
  
  console.log('[SERVER] Most recent interviewer question identified:', mostRecentQuestion);
  console.log('[SERVER] Full transcript being sent to AI:', transcript);
  
  // Prepare context for inclusion in the system prompt
  let contextData = '';
  if (extractedContent) {
    contextData = extractedContent;
    console.log('[SERVER] Including extracted content in system prompt');
  } else if (fileContext) {
    contextData = fileContext;
    console.log('[SERVER] Including file context in system prompt');
  }
  
  // Format the context data for inclusion in the system prompt
  const formattedContext = contextData ? `### Context Information:\n${contextData}\n\n` : "";
  
  try {
    if (AI_PROVIDER === 'gemini') {
      console.log('[SERVER] Using Gemini for suggestion');
      
      // Initialize Gemini client when needed
      const { model: geminiModel } = initializeGemini();
      
      // Create a new system instruction that prioritizes the processed context
      const systemInstruction = {
        role: "system",
        parts: [{ 
          text: formattedContext + 
                systemPrompt + 
                "\nUse the provided context information to craft responses that reference specific details from the context when appropriate. Prioritize information from the context when answering questions."
        }]
      };
      
      // Initialize a new chat with the updated system instruction
      const contextualChat = geminiModel.startChat({
        history: chatHistory,
        systemInstruction: systemInstruction
      });
      
      // Send the message with the updated chat object
      contextualChat.sendMessageStream(transcript)
        .then(async (result) => {
          let fullResponse = '';
          for await (const chunk of result.stream) {
            const content = chunk.text();
            if (content) {
              fullResponse += content;
              // Send each chunk to the frontend as it arrives
              process.send({ 
                type: 'suggestion-chunk', 
                data: { 
                  text: content,
                  fullText: fullResponse,
                  isFinal: false,
                  source: 'voice'
                } 
              });
            }
          }

          // Send the final complete response
          console.log('[SERVER] Sending final suggestion via IPC:', fullResponse);
          process.send({ 
            type: 'suggestion', 
            data: { 
              text: fullResponse,
              isFinal: true,
              source: 'voice'
            } 
          });

          // Update chat history
          chatHistory.push(
            { role: 'user', parts: [{ text: transcript }] },
            { role: 'model', parts: [{ text: fullResponse }] }
          );

          // Update the global chat object with the new history
          chat = geminiModel.startChat({
            history: chatHistory,
            systemInstruction: systemInstruction
          });
        })
      .catch(error => {
        console.error('[SERVER] Error generating Gemini suggestion:', error.message);
        process.send({ type: 'error', data: { message: `Error generating AI suggestion: ${error.message}` } });
      });
    } else if (AI_PROVIDER === 'openai') {
      console.log('[SERVER] Using OpenAI for suggestion');
      (async () => {
        try {
          // Initialize OpenAI client when needed
          const openaiClient = initializeOpenAI();
          
          // Prepare enhanced system message that prioritizes the processed context
          const systemMessageContent = formattedContext + 
                systemPrompt + 
                "\n\nUse the provided context information to craft responses that reference specific details from the context when appropriate. Prioritize information from the context when answering questions.";
          
          console.log('[SERVER] System prompt with context prepared');
          
          const messages = [
            { role: 'system', content: systemMessageContent },
            ...chatHistory,
            { role: 'user', content: transcript }
          ];
          
          console.log('[SERVER] Sending request to OpenAI API');
          // Create a streaming completion
          const stream = await openaiClient.chat.completions.create({
            model: 'gpt-4o',
            messages: messages,
            stream: true,
            temperature: 0.3,
          });
          
          let fullResponse = '';
          
          // Process the stream and send each chunk to the frontend
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              
              // Send each chunk to the frontend as it arrives
              process.send({ 
                type: 'suggestion-chunk', 
                data: { 
                  text: content,
                  fullText: fullResponse,
                  isFinal: false,
                  source: 'voice'
                } 
              });
            }
          }
          
          // Send the final complete response
          console.log('[SERVER] Sending final suggestion via IPC:', fullResponse);
          process.send({ 
            type: 'suggestion', 
            data: { 
              text: fullResponse,
              isFinal: true,
              source: 'voice'
            } 
          });
          
          // Update chat history
          chatHistory.push(
            { role: 'user', content: transcript },
            { role: 'assistant', content: fullResponse }
          );
        } catch (error) {
          console.error('[SERVER] Error generating OpenAI suggestion:', error.message);
          process.send({ type: 'error', data: { message: `Error generating AI suggestion: ${error.message}` } });
        }
      })();
    }
  } catch (error) {
    console.error('[SERVER] Unexpected error in generateAISuggestion:', error.message);
    process.send({ type: 'error', data: { message: `Unexpected error generating AI suggestion: ${error.message}` } });
  }
}

// Pre-initialize audio capture to eliminate startup delay
let audioPreInitialized = false;

// Function to request permissions interactively
function requestPermissionsInteractively(permissionType) {
  let swiftToolPath;
  if (process.env.NODE_ENV === 'production') {
    if (process.platform === 'darwin') {
      // macOS: AudioCapture is in extraResources
      swiftToolPath = path.join(process.resourcesPath, 'bin', 'AudioCapture');
    } else {
      // Windows: AudioCapture is in extraResources
      swiftToolPath = path.join(path.dirname(process.execPath), 'resources', 'bin', 'AudioCapture');
    }
  } else {
    swiftToolPath = path.join(__dirname, 'bin', 'AudioCapture');
  }

  if (!fs.existsSync(swiftToolPath)) {
    console.error('Swift audio capture tool not found for permission request');
    sendPermissionError(permissionType, 'tool-not-found');
    return;
  }

  console.log(`🔄 Requesting ${permissionType} permissions interactively...`);
  
  try {
    const { spawn } = require('child_process');
    const permissionRequestProcess = spawn(swiftToolPath, ['--request-permissions']);

    permissionRequestProcess.stdout.on('data', (data) => {
      console.log(`[Swift Permission Request]: ${data}`);
    });

    permissionRequestProcess.stderr.on('data', (data) => {
      console.error(`[Swift Permission Request Error]: ${data}`);
    });

    permissionRequestProcess.on('close', (code) => {
      console.log(`Swift permission request process exited with code ${code}`);
      if (code === 0) {
        console.log('✅ Permissions granted successfully!');
        // Send success message to renderer
        if (process.send) {
          process.send({ 
            type: 'info', 
            data: { 
              message: 'Permissions granted successfully! You can now start recording.',
              code: 'permissions-granted'
            } 
          });
        }
      } else {
        console.error('❌ Permission request failed or was denied.');
        sendPermissionError(permissionType, 'request-failed');
      }
    });
  } catch (error) {
    console.error('Error spawning Swift for permission request:', error);
    sendPermissionError(permissionType, 'spawn-failed');
  }
}

// Helper function to send permission error messages
function sendPermissionError(permissionType, errorCode) {
  if (!process.send) return;

  let message, url;
  switch (permissionType) {
    case 'microphone':
      message = 'This app needs microphone access to work. Click here to re-enable it in System Settings.';
      url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
      break;
    case 'screen-recording':
      message = 'This app needs screen recording access to work. Click here to re-enable it in System Settings.';
      url = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
      break;
    default:
      message = 'This app needs microphone and screen recording access to work. Click here to re-enable it in System Settings.';
      url = 'x-apple.systempreferences:com.apple.preference.security';
  }

  process.send({
    type: 'error',
    data: {
      message,
      code: `${permissionType}-permission-denied`,
      isPersistent: true,
      url
    }
  });
}

async function preInitializeAudioCapture() {
  if (audioPreInitialized || process.platform !== 'darwin') {
    return;
  }
  
  const preInitStartTime = Date.now();
  
  try {
    // Shared memory support removed
    
    // Pre-spawn the Swift process but don't start capture yet
    let swiftToolPath;
    if (process.env.NODE_ENV === 'production') {
      if (process.platform === 'darwin') {
        // macOS: AudioCapture is in extraResources
        swiftToolPath = path.join(process.resourcesPath, 'bin', 'AudioCapture');
      } else {
        // Windows: AudioCapture is in extraResources
        swiftToolPath = path.join(path.dirname(process.execPath), 'resources', 'bin', 'AudioCapture');
      }
    } else {
      swiftToolPath = path.join(__dirname, 'bin', 'AudioCapture');
    }
    
    // Just verify the tool exists and is executable, then run permission check
    if (fs.existsSync(swiftToolPath)) {
      // console.log('✅ Swift audio capture tool found. Checking permissions...');
      try {
        const { spawn } = require('child_process');
        const permissionCheckProcess = spawn(swiftToolPath, ['--permission-check']);

        let swiftOutput = '';
        permissionCheckProcess.stdout.on('data', (data) => {
          const output = data.toString();
          swiftOutput += output;
          console.log(`[Swift Permission Check]: ${output}`);
        });

        permissionCheckProcess.stderr.on('data', (data) => {
          console.error(`[Swift Permission Check Error]: ${data}`);
        });

        permissionCheckProcess.on('close', (code) => {
          console.log(`Swift permission check process exited with code ${code}`);

          const micDenied = swiftOutput.includes('🎤 Microphone: ❌ Not Available');
          const screenDenied = swiftOutput.includes('🖥️  Screen Recording: ❌ Not Available');

          if (micDenied) {
            console.error('❌ Microphone permission is required but not granted.');
            requestPermissionsInteractively('microphone');
          } else if (screenDenied) {
            console.error('❌ Screen recording permission is required but not granted.');
            requestPermissionsInteractively('screen-recording');
          } else if (code !== 0) {
            console.warn('⚠️ Swift audio permission check failed with unexpected error.');
            requestPermissionsInteractively('all');
          } else {
            console.log('✅ All required permissions are available.');
          }

          audioPreInitialized = true;
          const preInitDuration = Date.now() - preInitStartTime;
          // console.log(`⏱️ [LATENCY] Audio pre-initialization and permission check took: ${preInitDuration}ms`);
        });
      } catch (permError) {
        console.error('Error spawning Swift for permission check:', permError);
        useSwiftAudioCapture = true; // Fallback if permission check itself fails
      }
    } else {
      // console.log('⚠️ Swift audio capture tool not found, will use SoX fallback');
      useSwiftAudioCapture = true;
    }
  } catch (error) {
    console.error('Failed to pre-initialize audio capture:', error);
    // console.log('Will initialize audio capture on demand');
  }
}

// Pre-initialize audio capture
setTimeout(() => {
  preInitializeAudioCapture().catch(err => {
    console.error('Error during audio pre-initialization:', err);
  });
}, 100);
