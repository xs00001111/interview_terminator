# Google Transcribe Application

A real-time speech transcription application that uses Google Speech-to-Text API for transcription and Google Gemini AI for generating contextual suggestions based on the transcribed speech.

## Features

- Real-time speech transcription using Google Speech-to-Text API
- AI-powered suggestions using Google Gemini AI
- Ability to use document context for more relevant suggestions
- Minimalist, always-on-top UI
- Draggable interface

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Google Speech-to-Text API key
- Google Gemini API key
- Audio recording capabilities on your device

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/test_google_transcribe.git
   cd test_google_transcribe
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with your API keys:
   ```
   # Google Speech API Key
   GOOGLE_SPEECH_API_KEY=your_speech_api_key_here
   
   # Google Gemini API Key
   GOOGLE_GEMINI_API_KEY=your_gemini_api_key_here
   ```

## Usage

1. Start the application:
   ```
   npm start
   ```

2. The application will appear as a small window at the bottom of your screen.

3. Start speaking, and your speech will be transcribed in real-time.

4. AI-powered suggestions will appear based on your speech content.

### Using Document Context

You can provide a document as context for the AI suggestions:

```
npm start -- --file=/path/to/your/document.pdf
```

Supported file types include text files, PDFs, and common image formats.

## Development

To run the application in development mode with hot reloading:

```
npm run dev
```

To open the developer tools, uncomment the following line in `main.js`:

```javascript
// mainWindow.webContents.openDevTools();
```

## License

ISC

## Acknowledgements

- Google Speech-to-Text API
- Google Gemini AI
- Electron.js