
const encoding = 'LINEAR16';
const sampleRateHertz = 16000;
const languageCode = 'en-US';
const streamingLimit = 40000; 


const {Writable} = require('stream');
const recorder = require('node-record-lpcm16');
const {GoogleAuth, grpc} = require('google-gax');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const events = require('events');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');



// Ensure PATH prioritizes our bundled binaries over system binaries
if (process.env.NODE_ENV === 'production') {
  // In production, use the bundled binaries in the resources directory
  const binPath = path.join(process.resourcesPath, 'bin');
  process.env.PATH = `${binPath}:${process.env.PATH}`;
  console.log('Production mode: Using bundled binaries from', binPath);
} else {
  // In development, use the local bin directory
  const binPath = path.join(__dirname, 'bin');
  process.env.PATH = `${binPath}:${process.env.PATH}`;
  console.log('Development mode: Using bundled binaries from', binPath);
}

// Verify sox binary exists and is executable
const soxBinPath = process.env.NODE_ENV === 'production'
  ? path.join(process.resourcesPath, 'bin', 'sox')
  : path.join(__dirname, 'bin', 'sox');

try {
  fs.accessSync(soxBinPath, fs.constants.X_OK);
  console.log(`Sox binary found and is executable at: ${soxBinPath}`);
} catch (err) {
  console.error(`Sox binary not found or not executable at: ${soxBinPath}`);
  console.error(`Error details: ${err.message}`);
  console.error('Current PATH:', process.env.PATH);
}

// Load environment variables from .env file
dotenv.config();

// Increase the default max listeners to prevent warnings
events.EventEmitter.defaultMaxListeners = 15;

// Imports the Google Cloud client library
// Currently, only v1p1beta1 contains result-end-time
const speech = require('@google-cloud/speech').v1p1beta1;

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

  if (process.resourcesPath) {
    // When running in packaged app
    const envConfig = dotenv.config({ path: path.join(process.resourcesPath, '.env') });
    dotenvExpand.expand(envConfig);
  } else {
    // When running in development
    const envConfig = dotenv.config();
    dotenvExpand.expand(envConfig);
  }

const GOOGLE_CLOUD_SPEECH_API_KEY = process.env.GOOGLE_CLOUD_SPEECH_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;

function getApiKeyCredentials() {
  const sslCreds = grpc.credentials.createSsl();
  const googleAuth = new GoogleAuth();
  const authClient = googleAuth.fromAPIKey(GOOGLE_CLOUD_SPEECH_API_KEY);
  const credentials = grpc.credentials.combineChannelCredentials(
    sslCreds,
    grpc.credentials.createFromGoogleCredential(authClient)
  );
  return credentials;
}

const sslCreds = getApiKeyCredentials();

const client = new speech.SpeechClient({sslCreds});

// AI provider configuration
const AI_PROVIDER = 'openai'; // Set to 'openai' or 'gemini'

// Initialize Gemini
const genAI = new GoogleGenerativeAI(GOOGLE_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", temperature: 0.3 });

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

let chatHistory = [];

// Recording state
let isRecording = false;
let recordingStream = null;

function startRecording() {
  if (isRecording) return;
  
  isRecording = true;
  audioInput = [];
  lastAudioInput = [];
  restartCounter = 0;
  
  // Start the recording
  recordingStream = recorder
    .record({
      sampleRateHertz: sampleRateHertz,
      threshold: 0, // Silence threshold
      silence: 1000,
      keepSilence: true,
      recordProgram: 'sox',
      options: ['-d', '-b', '16', '-c', '1', '-r', '16000', '-t', 'wav', '-'],
    })
    .stream()
    .on('error', err => {
      // Ensure we always have a valid error message to send to the frontend
      const errorMessage = err && err.message ? err.message : 'Unknown recording error';
      process.send({ type: 'error', data: { message: `Audio recording error: ${errorMessage}` } });
      
      // Log additional debugging information
      console.error('Recording options:', {
        sampleRateHertz,
        recordProgram: 'sox',
      options: ['-d', '-b', '16', '-c', '1', '-r', '16000', '-t', 'wav', '-'],
        PATH: process.env.PATH
      });
      
      isRecording = false;
    });
  
  // Pipe the recording stream to the audio input stream transform
  recordingStream.pipe(audioInputStreamTransform);
  
  
  // Start the speech recognition stream
  startStream();
}

// Stop the recording and speech recognition
function stopRecording() {
  if (!isRecording) return;
  
  // Set recording state to false before stopping streams
  // to prevent error handlers from firing during intentional shutdown
  isRecording = false;
  
  try {
    // First stop the speech recognition stream to prevent further writes
    if (recognizeStream) {
      try {
        recognizeStream.removeListener('data', speechCallback);
        recognizeStream.end();
      } catch (streamError) {
        const errorMessage = streamError && streamError.message ? streamError.message : 'unknown error';
        console.error(`Non-fatal recognize stream error: ${errorMessage}`);
      }
      recognizeStream = null;
    }
    
    // Then stop the recording stream
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
    
    // Stop the speech recognition stream
    if (recognizeStream) {
      try {
        recognizeStream.end();
        recognizeStream.removeListener('data', speechCallback);
      } catch (streamError) {
        const errorMessage = streamError && streamError.message ? streamError.message : 'unknown error';
        console.error(`Non-fatal recognize stream error: ${errorMessage}`);
      }
      recognizeStream = null;
    }
    
    // Reset audio input arrays to free memory
    audioInput = [];
    lastAudioInput = [];
    
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

// Listen for messages from the main process
process.on('message', (message) => {
  if (message.type === 'start-recording') {
    if (!isRecording) {
      // console.log(chalk.green('Starting recording...'));
      startRecording();
      process.send({ type: 'recording-status', data: { isRecording: true } });
    }
  } else if (message.type === 'stop-recording') {
    if (isRecording) {
      // console.log(chalk.yellow('Stopping recording...'));
      stopRecording();
      process.send({ type: 'recording-status', data: { isRecording: false } });
    }
  } else if (message.type === 'set-context') {
    if (!isRecording && message.data) {
      
      if (message.data.text) {
        setTextContext(message.data.text);
      } else if (message.data.file) {
        processContextFile(message.data.file);
      }
    }
  } else if (message.type === 'process-screenshot') {
    if (message.data && message.data.path) {
      // console.log(chalk.green('Processing screenshot...'));
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
  } else if (message.type === 'ping') {
    // Respond to ping messages to confirm the server is still alive
    process.send({ type: 'pong' });
  }
});

// Function to elaborate on a concise response
async function elaborate(text) {
  console.log('[DEBUG] Elaborate function called with text:', text);
  try {
    const elaborationPrompt = `Take this concise response: "${text}" and expand it into a detailed technical explanation. Provide specific examples, implementation details, or architectural considerations. Keep the response focused and professional, limited to one paragraph with maximum 5 sentences.`;
    console.log('[DEBUG] Using AI provider:', AI_PROVIDER);
    
    if (AI_PROVIDER === 'gemini') {
      console.log('[DEBUG] Calling Gemini API');
      const result = await model.generateContent([elaborationPrompt]);
      const elaboratedResponse = result.response.text();
      console.log('[DEBUG] Received Gemini response');
      process.send({ type: 'elaboration', data: { text: elaboratedResponse } });
    } else if (AI_PROVIDER === 'openai') {
      console.log('[DEBUG] Calling OpenAI API');
      const result = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: elaborationPrompt }
        ],
        temperature: 0.3,
      });
      const elaboratedResponse = result.choices[0].message.content;
      console.log('[DEBUG] Received OpenAI response');
      process.send({ type: 'elaboration', data: { text: elaboratedResponse } });
    }
  } catch (error) {
    process.send({ type: 'error', data: { message: `Error generating elaboration: ${error.message}` } });
  }
}


// Read file content if provided
let fileContext = "";
let fileContentPart = null;
let documentSummary = "";
let extractedContent = "";

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
    // Create chat configuration with system instruction as text only
    const chatConfig = {
      history: chatHistory,
      temprature: 0.2,
      systemInstruction: {
        role: "system",
        parts: [{ 
          text: systemPrompt + (fileContext ? "\nUse the provided resume or personal introduction document to craft responses that match the user's background, experiences, and qualifications. When answering questions, reference specific details from their resume/introduction when appropriate." : "\nUse the previous conversation responses to maintain a consistent personality and background knowledge throughout the conversation.")
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
// Read system prompt from file

// Determine if we're running in a packaged app
let systemPrompt;
try {
  // In development mode, read from the local file
  systemPrompt = fs.readFileSync('system_prompt.txt', 'utf8');
} catch (error) {
  // In production/packaged mode, read from the resources directory
  if (process.resourcesPath) {
    const resourcePath = path.join(process.resourcesPath, 'system_prompt.txt');
    systemPrompt = fs.readFileSync(resourcePath, 'utf8');
  } else {
    console.error('Failed to load system prompt:', error);
    systemPrompt = ''; // Fallback to empty prompt
  }
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

const config = {
  encoding: encoding,
  sampleRateHertz: sampleRateHertz,
  languageCode: languageCode,
  diarizationConfig: {
    enableSpeakerDiarization: true,
    minSpeakerCount: 2,
    maxSpeakerCount: 2
  },
};

const request = {
  config,
  interimResults: true,
};

let recognizeStream = null;
let restartCounter = 0;
let audioInput = [];
let lastAudioInput = [];
let resultEndTime = 0;
let isFinalEndTime = 0;
let finalRequestEndTime = 0;
let newStream = true;
let bridgingOffset = 0;
let lastTranscriptWasFinal = false;
// Initialize global variable to track the last speaker role
global.lastSpeakerRole = 'INTERVIEWER'; // Default first speaker is INTERVIEWER

function startStream() {
  // Clear current audioInput
  audioInput = [];
  // Initiate (Reinitiate) a recognize stream
  recognizeStream = client
    .streamingRecognize(request)
    .on('error', err => {
      if (err.code === 11) {
        // restartStream();
      } else {
        console.error('API request error ' + err);
      }
    })
    .on('data', speechCallback);

  // Restart stream when streamingLimit expires
  setTimeout(restartStream, streamingLimit);
}

const speechCallback = stream => {
  // Convert API result end time from seconds + nanoseconds to milliseconds
  resultEndTime =
    stream.results[0].resultEndTime.seconds * 1000 +
    Math.round(stream.results[0].resultEndTime.nanos / 1000000);

  // Calculate correct time based on offset from audio sent twice
  const correctedTime =
    resultEndTime - bridgingOffset + streamingLimit * restartCounter;

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
    
    // Extract speaker diarization information if available
    if (stream.results[0].alternatives[0].words && 
        stream.results[0].alternatives[0].words.length > 0 && 
        stream.results[0].alternatives[0].words[0].speakerTag) {
      
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
      
      // Detect roles based on speaker tags
      // Assuming first speaker (usually lower tag) is INTERVIEWER, second is INTERVIEWEE
      // This follows the system prompt rule: "If speaker roles are unclear, assume alternating turns (first speaker is INTERVIEWER)"
      const speakerRoles = {};
      if (speakers.length >= 2) {
        // Sort speakers by tag
        const sortedSpeakers = [...speakers].sort((a, b) => a.speakerTag - b.speakerTag);
        // Assign roles - first speaker is INTERVIEWER, second is INTERVIEWEE
        speakerRoles[sortedSpeakers[0].speakerTag] = 'INTERVIEWER';
        speakerRoles[sortedSpeakers[1].speakerTag] = 'INTERVIEWEE';
      } else if (speakers.length === 1) {
        // If only one speaker, use turn-taking heuristic
        // If last transcript was final, alternate the role
        if (lastTranscriptWasFinal) {
          // If previous speaker was INTERVIEWER, this one is INTERVIEWEE and vice versa
          const previousRole = global.lastSpeakerRole || 'INTERVIEWEE';
          speakerRoles[speakers[0].speakerTag] = previousRole === 'INTERVIEWER' ? 'INTERVIEWEE' : 'INTERVIEWER';
          global.lastSpeakerRole = speakerRoles[speakers[0].speakerTag];
        } else {
          // If we're continuing the same utterance, use the same role as before
          speakerRoles[speakers[0].speakerTag] = global.lastSpeakerRole || 'INTERVIEWER';
        }
      }
      
      // Add role information to speaker info
      speakerInfo = {
        hasSpeakerInfo: true,
        speakers: speakers.map(speaker => ({
          ...speaker,
          role: speakerRoles[speaker.speakerTag] || 'UNKNOWN'
        }))
      };
    }
  }

  if (stream.results[0].isFinal) {
    // process.stdout.write(chalk.green(`${stdoutText}\n`));
    
    // Get the finalized transcript
    const userMessage = stream.results[0].alternatives[0].transcript;
    
    // Format speaker information with segments for the frontend
    let formattedSpeakerInfo = {
      hasSpeakerInfo: speakerInfo.hasSpeakerInfo,
      segments: []
    };
    
    // Add segments with speaker roles
    if (speakerInfo.hasSpeakerInfo && speakerInfo.speakers) {
      formattedSpeakerInfo.segments = speakerInfo.speakers.map(speaker => ({
        speakerId: speaker.speakerTag,
        text: speaker.text,
        role: speaker.role || 'UNKNOWN'
      }));
    }
    
    // Send transcript to the Electron frontend via IPC without logging
    process.send({ 
      type: 'transcript', 
      data: { 
        text: userMessage,
        speakerInfo: formattedSpeakerInfo
      } 
    });

    // No longer automatically generating AI suggestions here
    // Suggestions will only be generated when explicitly requested via the 'get-suggestion' IPC call
    
    isFinalEndTime = resultEndTime;
    lastTranscriptWasFinal = true;
  } else {
    // Make sure transcript does not exceed console character length
    if (stdoutText.length > process.stdout.columns) {
      stdoutText =
        stdoutText.substring(0, process.stdout.columns - 4) + '...';
    }
    
    // This section has been moved and updated with speaker info

    lastTranscriptWasFinal = false;
    
    // Send interim transcript to the Electron frontend via IPC with speaker info and roles
    if (stdoutText) {
      // Format speaker information with segments for the frontend
      let formattedSpeakerInfo = {
        hasSpeakerInfo: speakerInfo.hasSpeakerInfo,
        segments: []
      };
      
      // Add segments with speaker roles
      if (speakerInfo.hasSpeakerInfo && speakerInfo.speakers) {
        formattedSpeakerInfo.segments = speakerInfo.speakers.map(speaker => ({
          speakerId: speaker.speakerTag,
          text: speaker.text,
          role: speaker.role || 'UNKNOWN'
        }));
      }
      
      process.send({ 
        type: 'transcript', 
        data: { 
          text: stream.results[0].alternatives[0].transcript,
          speakerInfo: formattedSpeakerInfo,
          isFinal: false
        } 
      });
    }
  }
};

const audioInputStreamTransform = new Writable({
  write(chunk, encoding, next) {
    if (newStream && lastAudioInput.length !== 0) {
      // Approximate math to calculate time of chunks
      const chunkTime = streamingLimit / lastAudioInput.length;
      if (chunkTime !== 0) {
        if (bridgingOffset < 0) {
          bridgingOffset = 0;
        }
        if (bridgingOffset > finalRequestEndTime) {
          bridgingOffset = finalRequestEndTime;
        }
        const chunksFromMS = Math.floor(
          (finalRequestEndTime - bridgingOffset) / chunkTime
        );
        bridgingOffset = Math.floor(
          (lastAudioInput.length - chunksFromMS) * chunkTime
        );
0
        // Check if recognizeStream is valid before writing to it
        if (recognizeStream && !recognizeStream.destroyed) {
          for (let i = chunksFromMS; i < lastAudioInput.length; i++) {
            try {
              recognizeStream.write(lastAudioInput[i]);
            } catch (err) {
              console.error('Error writing to recognizeStream:', err.message);
              break;
            }
          }
        }
      }
      newStream = false;
    }

    audioInput.push(chunk);

    // Check if recognizeStream is valid before writing to it
    if (recognizeStream && !recognizeStream.destroyed) {
      try {
        recognizeStream.write(chunk);
      } catch (err) {
        console.error('Error writing to recognizeStream:', err.message);
      }
    }

    next();
  },

  final() {
    // Check if recognizeStream is valid before ending it
    if (recognizeStream && !recognizeStream.destroyed) {
      try {
        recognizeStream.end();
      } catch (err) {
        console.error('Error ending recognizeStream:', err.message);
      }
    }
  },
});

function restartStream() {
  if (recognizeStream) {
    try {
      // First remove the listener to prevent callbacks during cleanup
      recognizeStream.removeListener('data', speechCallback);
      // Then safely end the stream if it's not already destroyed
      if (!recognizeStream.destroyed) {
        recognizeStream.end();
      }
    } catch (err) {
      console.error('Error during stream restart:', err.message);
    } finally {
      recognizeStream = null;
    }
  }
  if (resultEndTime > 0) {
    finalRequestEndTime = isFinalEndTime;
  }
  resultEndTime = 0;

  lastAudioInput = [];
  lastAudioInput = audioInput;

  restartCounter++;

  if (!lastTranscriptWasFinal) {
    process.stdout.write('\n');
  }

  newStream = true;

  startStream();
}
// Process text context provided by the user
async function setTextContext(text) {
  try {
    // Extract structured content from the text
    const extractResult = await model.generateContent([
      `Read the following document and extract the key information in a structured format that can be used as context for a conversation:\n\n${text}`
    ]);
    extractedContent = extractResult.response.text();
    
    // Generate summary for text content
    const result = await model.generateContent([
      `Summarize this document in 3-5 sentences:\n\n${text}`
    ]);
    documentSummary = result.response.text();
    
    // Use the extracted content
    fileContext = extractedContent;
    fileContentPart = null;
    
    // Skip displaying summary and extracted content in console to reduce overhead
    
    // Initialize chat with the new context
    await initializeChat();
    
    // Send the summary to the frontend
    process.send({ 
      type: 'context-update', 
      data: { 
        summary: documentSummary,
        isFile: false
      } 
    });
    
  } catch (error) {
    // console.error(chalk.red(`Error processing text: ${error.message}`));
    process.send({ type: 'error', data: { message: `Error processing text: ${error.message}` } });
  }
}

// Process a context file uploaded by the user
async function processContextFile(filePath) {
  try {
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
      // console.log(chalk.green(`Loaded text context file: ${filePath}`));
      
      // Extract structured content from the document
      const extractResult = await model.generateContent([
        `Read the following document and extract the key information in a structured format that can be used as context for a conversation:\n\n${rawFileContent}`
      ]);
      extractedContent = extractResult.response.text();
      
      // Generate summary for text content
      const result = await model.generateContent([
        `Summarize this document in 3-5 sentences:\n\n${rawFileContent}`
      ]);
      documentSummary = result.response.text();
      
      // Use the extracted content instead of raw file content
      fileContext = extractedContent;
      fileContentPart = null;
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
      // console.log(chalk.green(`Loaded binary context file: ${filePath} as ${mimeType}`));
      
      // Extract structured content from the document
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
    }
    
    // Skip displaying summary and extracted content in console to reduce overhead
    
    // Initialize chat with the new context
    await initializeChat();
    
    // Send the summary to the frontend
    process.send({ 
      type: 'context-update', 
      data: { 
        summary: documentSummary,
        isFile: true,
        fileName: filePath.split('/').pop()
      } 
    });
    
  } catch (error) {
    // console.error(chalk.red(`Error processing file: ${error.message}`));
    process.send({ type: 'error', data: { message: `Error processing file: ${error.message}` } });
  }
}

// Start the recording and send the microphone input to the Speech API
async function main() {
  // Generate document summary if file is provided
  await generateDocumentSummary();
  
  // Initialize chat with the document context
  await initializeChat();
  
  // Don't automatically start recording
  console.log('Click Start to begin recording.');
  
  // Notify the frontend that we're ready
  process.send({ type: 'ready', data: { isReady: true } });
}

// Run the main function
main().catch(error => {
  // console.error(chalk.red(`Error: ${error.message}`));
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
  // Stop recording if it's running
  if (isRecording) {
    stopRecording();
  }
  console.log('Closing connections and exiting...');
  process.exit(0);
});

// Process a screenshot to extract text using Gemini
async function processScreenshot(screenshotPath) {
  try {
    // console.log(chalk.cyan('\n===== PROCESSING SCREENSHOT ====='));
    console.log(`Screenshot path: ${screenshotPath}`);
    
    // Read the screenshot file as base64
    const fileBuffer = fs.readFileSync(screenshotPath);
    const base64Data = fileBuffer.toString('base64');
    
    // Create the image part for Gemini
    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: 'image/png'
      }
    };
    
    // Extract text from the image using Gemini
    // Reduced logging to improve performance
    const extractResult = await model.generateContent([
      imagePart,
      'Extract all the text visible in this image. Return only the extracted text without any additional commentary.'
    ], {
      timeout: 30000 // Add timeout to prevent hanging requests
    });
    
    const extractedText = extractResult.response.text();
    
    // Skip printing extracted text to terminal to reduce overhead

    // Generate solution using Gemini
    // Reduced logging to improve performance
    const systemPrompt = `You are a technical problem solver. Analyze the following text and:
1. If it contains code:
   - Identify any bugs or issues
   - Provide corrected code with EXTREMELY CONCISE explanations
   - Format the code properly with syntax highlighting
2. If it contains system architecture or design:
   - Analyze the design patterns and architecture
   - Suggest improvements or best practices
   - Format the documentation in a clear structure
3. If it contains error messages:
   - Diagnose the root cause
   - Provide step-by-step solutions
   - Include code examples if applicable

Format your response in markdown for better readability.`;

    const solutionResult = await model.generateContent([
      systemPrompt,
      `Here's the text to analyze:\n${extractedText}`
    ], {
      timeout: 30000 // Add timeout to prevent hanging requests
    });

    const solution = solutionResult.response.text();
    
    // Skip printing solution to terminal to reduce overhead
    
    // Simplified formatting to reduce processing overhead
    let formattedSolution = solution;
    
    // Only apply minimal formatting when needed
    if (!solution.includes('```') && solution.match(/^[\s\S]*?[{};].*$/m)) {
      // Looks like code, wrap it in a code block
      formattedSolution = '```\n' + solution + '\n```';
    }

    // Send smaller payload to reduce IPC overhead
    process.send({
      type: 'suggestion',
      data: {
        text: formattedSolution
      }
    });
    
    // Send minimal data in screenshot processed event
    process.send({
      type: 'screenshot-processed',
      data: {
        success: true
      }
    });
    
    return extractedText;
  } catch (error) {
    
    // Combine error messages to reduce number of IPC calls
    process.send({
      type: 'error',
      data: {
        message: `Error processing screenshot: ${error.message}`
      }
    });
    
    // Send screenshot processed event with error (combined with suggestion clear)
    process.send({
      type: 'screenshot-processed',
      data: {
        success: false,
        error: error.message,
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
  
  console.log('[SERVER] Generating AI suggestion for:', transcript);
  // No need to track lastGeminiGenerationTime since we're using manual control
  
  try {
    if (AI_PROVIDER === 'gemini') {
      console.log('[SERVER] Using Gemini for suggestion');
      chat.sendMessageStream(transcript)
      .then(async (result) => {
        let fullResponse = '';
        for await (const chunk of result.stream) {
          fullResponse += chunk.text();
          // process.stdout.write(chalk.blue(`\n[AI Suggestion] ${chunk.text()}`));
        }
        
        // Send AI suggestion to the Electron frontend via IPC
        console.log('[SERVER] Sending suggestion via IPC:', fullResponse);
        process.send({ type: 'suggestion', data: { text: fullResponse } });
        
        // Update chat history
        chat = model.startChat({
          history: [
            ...chatHistory
          ]
        });
        chatHistory.push(
          { role: 'user', parts: [{ text: transcript }] },
          { role: 'model', parts: [{ text: fullResponse }] }
        );
      })
      .catch(error => {
        console.error('[SERVER] Error generating Gemini suggestion:', error.message);
        process.send({ type: 'error', data: { message: `Error generating AI suggestion: ${error.message}` } });
      });
    } else if (AI_PROVIDER === 'openai') {
      console.log('[SERVER] Using OpenAI for suggestion');
      (async () => {
        try {
          // Prepare messages for OpenAI
          const messages = [
            { role: 'system', content: systemPrompt },
            ...chatHistory,
            { role: 'user', content: transcript }
          ];
          
          console.log('[SERVER] Sending request to OpenAI API');
          // Create a streaming completion
          const stream = await openai.chat.completions.create({
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
              // process.stdout.write(chalk.blue(`\n[AI Suggestion] ${content}`));
              
              // Send each chunk to the frontend as it arrives
              process.send({ 
                type: 'suggestion-chunk', 
                data: { 
                  text: content,
                  fullText: fullResponse,
                  isFinal: false
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
              isFinal: true 
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


  

