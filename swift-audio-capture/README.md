# Audio Capture Tool for Interview Terminator

This Swift command-line tool captures audio streams from both microphone input and system audio output (including earphones/external speakers) using ScreenCaptureKit and AudioKit frameworks.

## Features

- **Microphone Capture**: Direct audio input from microphone using AudioKit
- **System Audio Capture**: System audio output (including earphones/speakers) using ScreenCaptureKit
- **Stream Separation**: Distinguishes between microphone and speaker audio streams
- **Real-time Processing**: Captures audio in real-time with low latency
- **Integration Ready**: Designed to work with the Interview Terminator Electron app

## Requirements

- macOS 12.3 or later (required for ScreenCaptureKit)
- Xcode 14.0 or later
- Swift 5.9 or later

## Installation

1. Navigate to the swift-audio-capture directory:
   ```bash
   cd swift-audio-capture
   ```

2. Build the project:
   ```bash
   swift build
   ```

3. Run the audio capture tool:
   ```bash
   swift run AudioCapture
   ```

## Permissions

The tool requires the following permissions:

1. **Microphone Access**: Grant microphone permission when prompted
2. **Screen Recording Permission**: Required for ScreenCaptureKit to capture system audio
   - Go to System Preferences > Security & Privacy > Privacy > Screen Recording
   - Add Terminal or your IDE to the list of allowed applications

## Usage

### Basic Usage

```bash
swift run AudioCapture
```

The tool will:
1. Initialize both microphone and system audio capture
2. Start capturing audio streams separately
3. Log audio samples as they are received
4. Run until interrupted with Ctrl+C

### Integration with Electron App

To integrate with the Interview Terminator Electron app:

1. **IPC Communication**: Modify the `handleSystemAudioSample` method to send audio data via named pipes, sockets, or files
2. **Audio Format**: The tool captures audio at 48kHz, 2-channel format
3. **Stream Identification**: 
   - Microphone audio: Handled by AudioKit engine
   - System audio: Handled by ScreenCaptureKit delegate

## Architecture

### AudioCaptureManager
Main class that coordinates both audio capture methods:
- Manages AudioKit engine for microphone input
- Manages ScreenCaptureKit stream for system audio
- Implements SCStreamDelegate for system audio callbacks

### Audio Streams

1. **Microphone Stream**:
   - Uses AudioKit's AudioEngine.InputNode
   - Direct access to microphone input
   - Real-time processing with Fader node

2. **System Audio Stream**:
   - Uses ScreenCaptureKit's SCStream
   - Captures all system audio output
   - Excludes current process audio to prevent feedback

## Configuration

### Audio Settings
- Sample Rate: 16,000 Hz (Optimized for speech recognition)
- Channels: 1 (Mono for better speech recognition)
- Bit Depth: 16-bit (Standard for speech recognition)
- Format: PCM (LINEAR16)

### Audio Format Optimization

The audio capture tool has been optimized to use the ideal sample rate for speech recognition:

- **16,000 Hz**: Optimal sample rate for speech recognition per Google's documentation
- **Mono Audio**: Single channel processing for efficiency
- **16-bit PCM**: Lossless encoding for best accuracy
- **Smaller Buffer Size**: 256 bytes for lower latency

These settings provide the best balance between audio quality and recognition accuracy for speech-to-text processing.

### ScreenCaptureKit Configuration
```swift
let configuration = SCStreamConfiguration()
configuration.capturesAudio = true
configuration.excludesCurrentProcessAudio = true
configuration.sampleRate = 48000
configuration.channelCount = 2
```

## Troubleshooting

### Common Issues

1. **Permission Denied**:
   - Ensure microphone and screen recording permissions are granted
   - Check System Preferences > Security & Privacy

2. **No System Audio**:
   - Verify that audio is playing from other applications
   - Check that ScreenCaptureKit has proper permissions

3. **Build Errors**:
   - Ensure macOS 12.3+ and Xcode 14.0+
   - Run `swift package clean` and rebuild

### Debug Output

The tool provides detailed logging:
- ✅ Success messages for setup completion
- 🎤 Microphone capture status
- 🔊 System audio sample reception
- ❌ Error messages with details

## Development

### Adding Features

1. **Audio Processing**: Add real-time audio effects or analysis
2. **File Output**: Save captured audio to files
3. **Network Streaming**: Send audio over network to Electron app
4. **Audio Format Conversion**: Convert between different audio formats

### Testing

1. Test microphone capture with voice input
2. Test system audio capture by playing music/videos
3. Verify stream separation by monitoring logs
4. Test with different audio devices (headphones, speakers, etc.)

## License

This tool is part of the Interview Terminator project.