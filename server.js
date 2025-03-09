
const encoding = 'LINEAR16';
const sampleRateHertz = 16000;
const languageCode = 'en-US';
const streamingLimit = 10000; // ms - set to low number for demo purposes

const chalk = require('chalk');
const {Writable} = require('stream');
const recorder = require('node-record-lpcm16');
const {GoogleAuth, grpc} = require('google-gax');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
let chatHistory = [];

// Using IPC for communication with the main process
console.log('Using IPC for communication with the main process...');

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
    
    // Display the summary and extracted content
    console.log(chalk.cyan('\n===== DOCUMENT SUMMARY ====='));
    console.log(chalk.cyan(documentSummary));
    console.log(chalk.cyan('============================\n'));
    
    console.log(chalk.yellow('\n===== EXTRACTED CONTENT ====='));
    console.log(chalk.yellow(extractedContent.substring(0, 300) + (extractedContent.length > 300 ? '...' : '')));
    console.log(chalk.yellow('==============================\n'));
    
  } catch (error) {
    console.error(chalk.red(`Error processing file: ${error.message}`));
    process.exit(1);
  }
}

// Initialize chat after summary generation
async function initializeChat() {
  chat = model.startChat({
    history: chatHistory,
    systemInstruction: {
      role: "system",
      parts: fileContentPart ? 
        [fileContentPart, { text: `Provide ultra-concise real-time speaking suggestions (1-2 sentences). Focus on active listening cues and situational context. Prioritize brevity, relevance, and natural flow from previous exchanges. Use the provided document as context for your suggestions.` }] :
        [{ text: `Provide ultra-concise real-time speaking suggestions (1-2 sentences). Focus on active listening cues and situational context. Prioritize brevity, relevance, and natural flow from previous exchanges. ${fileContext ? "Use the following extracted document content as context for your suggestions:\n\n" + fileContext : ""}` }]
    }
  });
}

let chat = model.startChat({
  history: chatHistory,
  systemInstruction: {
    role: "system",
    parts: fileContentPart ? 
      [fileContentPart, { text: `Provide ultra-concise real-time speaking suggestions (1-2 sentences). Focus on active listening cues and situational context. Prioritize brevity, relevance, and natural flow from previous exchanges. Use the provided document as context for your suggestions.` }] :
      [{ text: `Provide ultra-concise real-time speaking suggestions (1-2 sentences). Focus on active listening cues and situational context. Prioritize brevity, relevance, and natural flow from previous exchanges. ${fileContext ? "Use the following extracted document content as context for your suggestions:\n\n" + fileContext : ""}` }]
  }
});

const config = {
  encoding: encoding,
  sampleRateHertz: sampleRateHertz,
  languageCode: languageCode,
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
  if (stream.results[0] && stream.results[0].alternatives[0]) {
    stdoutText =
      correctedTime + ': ' + stream.results[0].alternatives[0].transcript;
  }

  if (stream.results[0].isFinal) {
    process.stdout.write(chalk.green(`${stdoutText}\n`));
    
    // Send finalized transcript to Gemini
    const userMessage = stream.results[0].alternatives[0].transcript;
    
    // Send transcript to the Electron frontend via IPC
    console.log('[SERVER] Sending transcript via IPC:', userMessage);
    process.send({ type: 'transcript', data: { text: userMessage } });
    
    chat.sendMessageStream(userMessage)
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
          { role: 'user', parts: [{ text: userMessage }] },
          { role: 'model', parts: [{ text: fullResponse }] }
        );
        });
      
    isFinalEndTime = resultEndTime;
    lastTranscriptWasFinal = true;
  } else {
    // Make sure transcript does not exceed console character length
    if (stdoutText.length > process.stdout.columns) {
      stdoutText =
        stdoutText.substring(0, process.stdout.columns - 4) + '...';
    }
    process.stdout.write(chalk.red(`${stdoutText}`));
    
    // Send interim transcript to the Electron frontend via IPC
    if (stdoutText) {
      process.send({ type: 'transcript', data: { text: stream.results[0].alternatives[0].transcript } });
    }

    lastTranscriptWasFinal = false;
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
// Start recording and send the microphone input to the Speech API
async function main() {
  // Generate document summary if file is provided
  await generateDocumentSummary();
  
  // Initialize chat with the document context
  await initializeChat();
  
  recorder
    .record({
      sampleRateHertz: sampleRateHertz,
      threshold: 0, // Silence threshold
      silence: 1000,
      keepSilence: true,
      recordProgram: 'rec', // Try also "arecord" or "sox"
    })
    .stream()
    .on('error', err => {
      console.error('Audio recording error ' + err);
    })
    .pipe(audioInputStreamTransform);

  console.log(chalk.cyan('\n===== DOCUMENT SUMMARY ====='));
  console.log('Listening, press Ctrl+C to stop.');
  console.log('');
  console.log('End (ms)       Transcript Results/Status');
  console.log('=========================================================');

  startStream();
}

// Run the main function
main().catch(error => {
  console.error(chalk.red(`Error: ${error.message}`));
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Closing connections and exiting...');
  process.exit(0);
});