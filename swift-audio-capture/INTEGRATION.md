# Integration Guide: Swift Audio Capture ↔ Electron App

This guide explains how to integrate the Swift audio capture tool with the Interview Terminator Electron application to enable separate microphone and speaker audio stream processing.

## Overview

The Swift tool captures two distinct audio streams:
1. **Microphone Input**: Direct capture from microphone using AudioKit
2. **System Audio Output**: Capture from speakers/earphones using ScreenCaptureKit

The Electron app can then process these streams separately for speaker diarization and audio analysis.

## Integration Methods

### Method 1: Named Pipes (Recommended)

Use named pipes for real-time audio streaming between Swift and Electron.

#### Swift Side Implementation

```swift
// Add to AudioCaptureManager class
private let microphonePipe = "/tmp/interview_terminator_mic"
private let systemAudioPipe = "/tmp/interview_terminator_system"

private func setupNamedPipes() {
    // Create named pipes
    mkfifo(microphonePipe, 0o666)
    mkfifo(systemAudioPipe, 0o666)
}

private func sendMicrophoneData(_ audioData: Data) {
    // Write microphone data to pipe
    if let pipe = FileHandle(forWritingAtPath: microphonePipe) {
        pipe.write(audioData)
        pipe.closeFile()
    }
}

private func sendSystemAudioData(_ audioData: Data) {
    // Write system audio data to pipe
    if let pipe = FileHandle(forWritingAtPath: systemAudioPipe) {
        pipe.write(audioData)
        pipe.closeFile()
    }
}
```

#### Electron Side Implementation

```javascript
// In main.js or a dedicated audio service
const fs = require('fs');
const { spawn } = require('child_process');

class AudioStreamManager {
    constructor() {
        this.microphonePipe = '/tmp/interview_terminator_mic';
        this.systemAudioPipe = '/tmp/interview_terminator_system';
        this.swiftProcess = null;
    }

    startAudioCapture() {
        // Start the Swift audio capture tool
        this.swiftProcess = spawn('./swift-audio-capture/run.sh', [], {
            cwd: __dirname
        });

        // Monitor microphone stream
        this.monitorMicrophoneStream();
        
        // Monitor system audio stream
        this.monitorSystemAudioStream();
    }

    monitorMicrophoneStream() {
        const micStream = fs.createReadStream(this.microphonePipe);
        micStream.on('data', (audioData) => {
            // Process microphone audio data
            this.processMicrophoneAudio(audioData);
        });
    }

    monitorSystemAudioStream() {
        const systemStream = fs.createReadStream(this.systemAudioPipe);
        systemStream.on('data', (audioData) => {
            // Process system audio data
            this.processSystemAudio(audioData);
        });
    }

    processMicrophoneAudio(audioData) {
        // Send to your existing audio processing pipeline
        // This is the user's voice input
        console.log('Microphone audio received:', audioData.length, 'bytes');
    }

    processSystemAudio(audioData) {
        // Send to your existing audio processing pipeline
        // This is the system/speaker output (interviewer's voice)
        console.log('System audio received:', audioData.length, 'bytes');
    }
}
```

### Method 2: File-based Communication

Write audio data to temporary files that the Electron app monitors.

#### Swift Side

```swift
private func writeAudioToFile(_ audioData: Data, stream: String) {
    let timestamp = Date().timeIntervalSince1970
    let filename = "/tmp/interview_terminator_\(stream)_\(timestamp).wav"
    
    do {
        try audioData.write(to: URL(fileURLWithPath: filename))
        // Notify Electron app of new file
        notifyElectronApp(filename: filename, stream: stream)
    } catch {
        print("Error writing audio file: \(error)")
    }
}
```

#### Electron Side

```javascript
const chokidar = require('chokidar');

class FileBasedAudioManager {
    constructor() {
        this.watchDirectory = '/tmp/';
        this.setupFileWatcher();
    }

    setupFileWatcher() {
        const watcher = chokidar.watch(this.watchDirectory + 'interview_terminator_*.wav');
        
        watcher.on('add', (filePath) => {
            if (filePath.includes('_mic_')) {
                this.processMicrophoneFile(filePath);
            } else if (filePath.includes('_system_')) {
                this.processSystemAudioFile(filePath);
            }
        });
    }
}
```

### Method 3: HTTP/WebSocket Communication

Use HTTP server or WebSocket for network-based communication.

#### Swift Side

```swift
import Network

class NetworkAudioStreamer {
    private let connection: NWConnection
    
    init() {
        let endpoint = NWEndpoint.hostPort(host: "localhost", port: 8080)
        connection = NWConnection(to: endpoint, using: .tcp)
    }
    
    func sendAudioData(_ data: Data, streamType: String) {
        let message = "\(streamType):\(data.base64EncodedString())\n"
        connection.send(content: message.data(using: .utf8), completion: .idempotent)
    }
}
```

## Audio Format Considerations

### Sample Rate and Channels
- **Sample Rate**: 16,000 Hz (Optimized for speech recognition)
- **Channels**: 1 (Mono for better speech recognition efficiency)
- **Format**: PCM LINEAR16 (Lossless encoding for best accuracy)
- **Bit Depth**: 16-bit (Standard for speech recognition)

### Audio Format Optimization

The audio format has been optimized based on Google Cloud Speech-to-Text recommendations:

- **16kHz Sample Rate**: Google's documentation states this is optimal for speech recognition
- **Mono Audio**: Single channel processing reduces bandwidth and improves efficiency
- **LINEAR16 Encoding**: Lossless format ensures maximum recognition accuracy
- **Smaller Buffer Size**: 256 bytes for reduced latency

### Data Processing

```javascript
// Example audio processing in Electron
function processAudioBuffer(audioData, streamType) {
    // Convert raw audio data to format expected by your transcription service
    const audioBuffer = new Float32Array(audioData.buffer);
    
    // Apply any necessary audio processing
    const processedAudio = applyAudioFilters(audioBuffer);
    
    // Send to transcription service with stream identification
    sendToTranscriptionService(processedAudio, {
        streamType: streamType, // 'microphone' or 'system'
        timestamp: Date.now(),
        sampleRate: 48000,
        channels: 2
    });
}
```

## Speaker Diarization Integration

### Stream Identification

```javascript
class SpeakerDiarization {
    constructor() {
        this.microphoneBuffer = [];
        this.systemAudioBuffer = [];
    }

    processMicrophoneAudio(audioData) {
        // This is definitely the user speaking
        this.addToTranscription(audioData, 'User', 'microphone');
    }

    processSystemAudio(audioData) {
        // This could be interviewer or system sounds
        // Apply additional processing to identify if it's speech
        if (this.isSpeech(audioData)) {
            this.addToTranscription(audioData, 'Interviewer', 'system');
        }
    }

    addToTranscription(audioData, speaker, source) {
        const transcriptionEntry = {
            speaker: speaker,
            source: source,
            timestamp: Date.now(),
            audioData: audioData
        };
        
        // Send to your existing transcription pipeline
        this.sendToTranscriptionService(transcriptionEntry);
    }
}
```

## Error Handling and Monitoring

### Swift Tool Monitoring

```javascript
class SwiftToolManager {
    startWithMonitoring() {
        this.swiftProcess = spawn('./swift-audio-capture/run.sh');
        
        this.swiftProcess.stdout.on('data', (data) => {
            console.log('Swift tool output:', data.toString());
        });
        
        this.swiftProcess.stderr.on('data', (data) => {
            console.error('Swift tool error:', data.toString());
        });
        
        this.swiftProcess.on('close', (code) => {
            console.log('Swift tool exited with code:', code);
            if (code !== 0) {
                // Restart the tool if it crashes
                setTimeout(() => this.startWithMonitoring(), 1000);
            }
        });
    }
}
```

## Testing the Integration

### Test Script

```bash
#!/bin/bash
# test_integration.sh

echo "Testing Swift Audio Capture Integration"

# Start the Swift tool in background
./swift-audio-capture/run.sh &
SWIFT_PID=$!

# Start the Electron app
npm start &
ELECTRON_PID=$!

# Wait for user input
echo "Press Enter to stop testing..."
read

# Clean up
kill $SWIFT_PID
kill $ELECTRON_PID

echo "Integration test completed"
```

### Verification Steps

1. **Audio Capture**: Verify both microphone and system audio are being captured
2. **Stream Separation**: Confirm that microphone and system audio are processed separately
3. **Data Flow**: Check that audio data flows from Swift tool to Electron app
4. **Speaker Identification**: Verify that the system can distinguish between user and interviewer
5. **Error Recovery**: Test that the system recovers from audio capture failures

## Performance Considerations

- **Latency**: Named pipes provide the lowest latency
- **CPU Usage**: Monitor CPU usage of both Swift tool and Electron app
- **Memory**: Implement proper buffer management to prevent memory leaks
- **Audio Quality**: Ensure audio quality is maintained through the pipeline

## Security and Permissions

- **Microphone Permission**: Required for AudioKit microphone access
- **Screen Recording Permission**: Required for ScreenCaptureKit system audio capture
- **File System Access**: Required for file-based communication methods
- **Network Access**: Required for HTTP/WebSocket communication methods