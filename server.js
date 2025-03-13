
const encoding = 'LINEAR16';
const sampleRateHertz = 16000;
const languageCode = 'en-US';
const streamingLimit = 15000; 

const chalk = require('chalk');
const {Writable} = require('stream');
const recorder = require('node-record-lpcm16');
const {GoogleAuth, grpc} = require('google-gax');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { OpenAI } = require('openai');
const fs = require('fs');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const events = require('events');
const dotenv = require('dotenv');

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

function getApiKeyCredentials() {
  const sslCreds = grpc.credentials.createSsl();
  const googleAuth = new GoogleAuth();
  const authClient = googleAuth.fromAPIKey(process.env.GOOGLE_SPEECH_API_KEY);
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
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", temperature: 0.3 });

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY

let chatHistory = [];
let lastGeminiGenerationTime = 0;
const GEMINI_DEBOUNCE_DELAY = 1000; // 1 second in milliseconds (reduced from 2s to improve responsiveness)

// Using IPC for communication with the main process
// Using IPC for communication with the main process

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
      recordProgram: 'rec', // Try also "arecord" or "sox"
    })
    .stream()
    .on('error', err => {
      console.error('Audio recording error:', err);
      // Ensure we always have a valid error message to send to the frontend
      const errorMessage = err && err.message ? err.message : 'Unknown recording error';
      process.send({ type: 'error', data: { message: `Audio recording error: ${errorMessage}` } });
      isRecording = false;
    });
  
  // Pipe the recording stream to the audio input stream transform
  recordingStream.pipe(audioInputStreamTransform);
  
  // Minimal logging for recording start
  console.log(chalk.cyan('\n===== RECORDING STARTED ====='));
  
  // Start the speech recognition stream
  startStream();
}

// Stop the recording and speech recognition
function stopRecording() {
  if (!isRecording) return;
  
  isRecording = false;
  
  try {
    // Stop the recording stream
    if (recordingStream) {
      recordingStream.unpipe(audioInputStreamTransform);
      recordingStream.destroy();
      recordingStream = null;
    }
    
    // Stop the speech recognition stream
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream.removeListener('data', speechCallback);
      recognizeStream = null;
    }
    
    console.log(chalk.yellow('\n===== RECORDING STOPPED ====='));
  } catch (error) {
    // Handle any errors that occur during stopping
    const errorMessage = error && error.message ? error.message : 'Unknown error stopping recording';
    console.error(chalk.red(`Error stopping recording: ${errorMessage}`));
    process.send({ type: 'error', data: { message: `Error stopping recording: ${errorMessage}` } });
  }
}

// Variable to track if a message is currently pinned
let isPinned = false;

// Add function to handle pin status changes
function handlePinStatusChange(pinned) {
  isPinned = pinned;
  console.log(chalk.cyan(`Message pin status changed: ${pinned ? 'pinned' : 'unpinned'}`));
}

// Listen for messages from the main process
process.on('message', (message) => {
  if (message.type === 'start-recording') {
    if (!isRecording) {
      console.log(chalk.green('Starting recording...'));
      startRecording();
      process.send({ type: 'recording-status', data: { isRecording: true } });
    }
  } else if (message.type === 'stop-recording') {
    if (isRecording) {
      console.log(chalk.yellow('Stopping recording...'));
      stopRecording();
      process.send({ type: 'recording-status', data: { isRecording: false } });
    }
  } else if (message.type === 'set-context') {
    if (!isRecording && message.data) {
      console.log(chalk.green('Setting new context...'));
      if (message.data.text) {
        setTextContext(message.data.text);
      } else if (message.data.file) {
        processContextFile(message.data.file);
      }
    }
  } else if (message.type === 'process-screenshot') {
    if (message.data && message.data.path) {
      console.log(chalk.green('Processing screenshot...'));
      processScreenshot(message.data.path);
    }
  } else if (message.type === 'pin-status-change') {
    handlePinStatusChange(message.data.pinned);
  }
});

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
      console.log(chalk.green(`Loaded text context file: ${filePath}`));
      
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
      console.log(chalk.green(`Loaded binary context file: ${filePath} as ${mimeType}`));
      
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
        // This is a simplified approach - in a real app, you might want to use a document processing service
        console.log(chalk.yellow('Binary file processing with OpenAI is limited. Using basic text extraction.'));
        
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
    console.error(chalk.red(`Error processing file: ${error.message}`));
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
const systemPrompt = fs.readFileSync('system_prompt.txt', 'utf8');

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
      
      // Create speaker information object
      speakerInfo = {
        hasSpeakerInfo: true,
        speakers: Object.keys(wordsBySpeaker).map(tag => ({
          speakerTag: parseInt(tag),
          text: wordsBySpeaker[tag].join(' ')
        }))
      };
    }
  }

  if (stream.results[0].isFinal) {
    process.stdout.write(chalk.green(`${stdoutText}\n`));
    
    // Send finalized transcript to Gemini
    const userMessage = stream.results[0].alternatives[0].transcript;
    
    // Send transcript to the Electron frontend via IPC without logging
    process.send({ 
      type: 'transcript', 
      data: { 
        text: userMessage,
        speakerInfo: speakerInfo
      } 
    });

    // Check if enough time has passed since the last generation
    const currentTime = Date.now();
    
    // Check if message is pinned - don't generate new suggestions if pinned
    if (isPinned) {
      console.log(chalk.yellow('Skipping AI suggestion generation - message is pinned'));
    }
    // If not pinned and enough time has passed, generate new suggestion
    else if (currentTime - lastGeminiGenerationTime >= GEMINI_DEBOUNCE_DELAY) {
      lastGeminiGenerationTime = currentTime;
      
      if (AI_PROVIDER === 'gemini') {
        // Use Gemini for response generation
        chat.sendMessageStream(userMessage, {
          timeout: 30000 // Add timeout to prevent hanging requests
        })
        .then(async (result) => {
          let fullResponse = '';
          for await (const chunk of result.stream) {
            fullResponse += chunk.text();
            // Remove console logging to improve performance
          }
          
          // Send AI suggestion to the Electron frontend via IPC without logging
          process.send({ type: 'suggestion', data: { text: fullResponse } });
          
          // Update chat history
          chat = model.startChat({
            history: [
              ...chatHistory
            ]
          });
          chatHistory.push(
            { role: 'user', parts: [{ text: userMessage }] },
            { role: 'model', parts: [{ text: fullResponse }] }
          );
        });
      } else if (AI_PROVIDER === 'openai') {
        // Use OpenAI for response generation
        (async () => {
          try {
            // Prepare messages for OpenAI
            const messages = [
              { role: 'system', content: systemPrompt },
              ...chatHistory,
              { role: 'user', content: userMessage }
            ];
            
            // Create a streaming completion
            const stream = await openai.chat.completions.create({
              model: 'gpt-4o',
              messages: messages,
              stream: true,
              temperature: 0.3,
            });
            
            let fullResponse = '';
            
            // Process the stream
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || '';
              fullResponse += content;
            }
            
            // Send AI suggestion to the Electron frontend
            process.send({ type: 'suggestion', data: { text: fullResponse } });
            
            // Update chat history
            chatHistory.push(
              { role: 'user', content: userMessage },
              { role: 'assistant', content: fullResponse }
            );
          } catch (error) {
            console.error(chalk.red(`OpenAI API error: ${error.message}`));
            process.send({ type: 'error', data: { message: `OpenAI API error: ${error.message}` } });
          }
        })();
      }
      
      isFinalEndTime = resultEndTime;
      lastTranscriptWasFinal = true;
    }
  } else {
    // Make sure transcript does not exceed console character length
    if (stdoutText.length > process.stdout.columns) {
      stdoutText =
        stdoutText.substring(0, process.stdout.columns - 4) + '...';
    }
    process.stdout.write(chalk.red(`${stdoutText}`));
    
    // This section has been moved and updated with speaker info

    lastTranscriptWasFinal = false;
    
    // Send interim transcript to the Electron frontend via IPC with speaker info
    if (stdoutText) {
      process.send({ 
        type: 'transcript', 
        data: { 
          text: stream.results[0].alternatives[0].transcript,
          speakerInfo: speakerInfo,
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

        for (let i = chunksFromMS; i < lastAudioInput.length; i++) {
          recognizeStream.write(lastAudioInput[i]);
        }
      }
      newStream = false;
    }

    audioInput.push(chunk);

    if (recognizeStream) {
      recognizeStream.write(chunk);
    }

    next();
  },

  final() {
    if (recognizeStream) {
      recognizeStream.end();
    }
  },
});

function restartStream() {
  if (recognizeStream) {
    recognizeStream.end();
    recognizeStream.removeListener('data', speechCallback);
    recognizeStream = null;
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
  process.stdout.write(
    chalk.yellow(`${streamingLimit * restartCounter}: RESTARTING REQUEST\n`)
  );

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
    console.error(chalk.red(`Error processing text: ${error.message}`));
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
      console.log(chalk.green(`Loaded text context file: ${filePath}`));
      
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
      console.log(chalk.green(`Loaded binary context file: ${filePath} as ${mimeType}`));
      
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
    console.error(chalk.red(`Error processing file: ${error.message}`));
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
  console.log(chalk.cyan('\n===== READY ====='));
  console.log('Click Start to begin recording.');
  
  // Notify the frontend that we're ready
  process.send({ type: 'ready', data: { isReady: true } });
}

// Run the main function
main().catch(error => {
  console.error(chalk.red(`Error: ${error.message}`));
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
    console.log(chalk.cyan('\n===== PROCESSING SCREENSHOT ====='));
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
    console.error(chalk.red(`Error processing screenshot: ${error.message}`));
    
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

// Modify the generateGeminiResponse function to respect pin status
async function generateGeminiResponse(transcript) {
  if (isPinned) {
    console.log(chalk.yellow('Skipping AI suggestion - message is pinned'));
    return;
  }

  const now = Date.now();
  if (now - lastGeminiGenerationTime < GEMINI_DEBOUNCE_DELAY) {
    return;
  }
  lastGeminiGenerationTime = now;
  
  if (AI_PROVIDER === 'gemini') {
    chat.sendMessageStream(transcript)
    .then(async (result) => {
      let fullResponse = '';
      for await (const chunk of result.stream) {
        fullResponse += chunk.text();
        process.stdout.write(chalk.blue(`\n[AI Suggestion] ${chunk.text()}`));
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
    });
  } else if (AI_PROVIDER === 'openai') {
    (async () => {
      try {
        // Prepare messages for OpenAI
        const messages = [
          { role: 'system', content: systemPrompt },
          ...chatHistory,
          { role: 'user', content: transcript }
        ];
        
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
            process.stdout.write(chalk.blue(`\n[AI Suggestion] ${content}`));
            
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
        console.error(chalk.red(`OpenAI API error: ${error.message}`));
        process.send({ type: 'error', data: { message: `OpenAI API error: ${error.message}` } });
      }
    })();}
    isFinalEndTime = resultEndTime;
    lastTranscriptWasFinal = true;
  }

  

