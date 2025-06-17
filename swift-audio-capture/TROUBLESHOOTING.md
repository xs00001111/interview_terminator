# Troubleshooting Guide

## Build Issues

### Error: xcrun unable to lookup item 'PlatformPath'

**Problem**: Swift build fails with xcrun errors related to command line tools.

**Solutions**:

1. **Install/Reinstall Xcode Command Line Tools**:
   ```bash
   # Remove existing command line tools
   sudo rm -rf /Library/Developer/CommandLineTools
   
   # Install fresh command line tools
   xcode-select --install
   ```

2. **If you have Xcode installed, switch to Xcode toolchain**:
   ```bash
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   ```

3. **Reset xcode-select to command line tools** (if you prefer command line tools):
   ```bash
   sudo xcode-select --switch /Library/Developer/CommandLineTools
   ```

4. **Verify installation**:
   ```bash
   xcode-select --print-path
   xcrun --show-sdk-path
   swift --version
   ```

### Alternative Build Methods

If the standard Swift Package Manager build fails, try these alternatives:

#### Method 1: Use Xcode Project

1. Generate Xcode project:
   ```bash
   swift package generate-xcodeproj
   ```

2. Open in Xcode:
   ```bash
   open AudioCapture.xcodeproj
   ```

3. Build and run from Xcode

#### Method 2: Simplified Version Without AudioKit

If AudioKit dependency causes issues, create a simplified version using only ScreenCaptureKit:

```swift
// Simplified main.swift without AudioKit
import Foundation
import ScreenCaptureKit
import AVFoundation

@available(macOS 12.3, *)
class SimpleAudioCapture: NSObject {
    private var screenCaptureStream: SCStream?
    private var audioEngine: AVAudioEngine?
    
    func startCapture() {
        setupMicrophoneCapture()
        setupSystemAudioCapture()
    }
    
    private func setupMicrophoneCapture() {
        audioEngine = AVAudioEngine()
        let inputNode = audioEngine!.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, time in
            print("🎤 Microphone audio captured")
        }
        
        do {
            try audioEngine!.start()
            print("✅ Microphone capture started")
        } catch {
            print("❌ Microphone setup failed: \(error)")
        }
    }
    
    private func setupSystemAudioCapture() {
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                let filter = SCContentFilter(desktopIndependentWindow: nil)
                
                let config = SCStreamConfiguration()
                config.capturesAudio = true
                config.excludesCurrentProcessAudio = true
                
                screenCaptureStream = SCStream(filter: filter, configuration: config, delegate: self)
                try await screenCaptureStream?.startCapture()
                print("✅ System audio capture started")
            } catch {
                print("❌ System audio setup failed: \(error)")
            }
        }
    }
}

@available(macOS 12.3, *)
extension SimpleAudioCapture: SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .audio {
            print("🔊 System audio captured")
        }
    }
    
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("❌ Stream error: \(error)")
    }
}

if #available(macOS 12.3, *) {
    let capture = SimpleAudioCapture()
    capture.startCapture()
    RunLoop.main.run()
} else {
    print("❌ Requires macOS 12.3+")
}
```

#### Method 3: Remove AudioKit Dependency

Update Package.swift to remove AudioKit:

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AudioCapture",
    platforms: [
        .macOS(.v12)
    ],
    targets: [
        .executableTarget(
            name: "AudioCapture"
        ),
    ]
)
```

## Permission Issues

### Microphone Permission Denied

1. Go to System Preferences > Security & Privacy > Privacy > Microphone
2. Add Terminal (or your development environment) to the allowed list
3. Restart the application

### Screen Recording Permission Denied

1. Go to System Preferences > Security & Privacy > Privacy > Screen Recording
2. Add Terminal (or your development environment) to the allowed list
3. Restart the application

### Full Disk Access (if needed)

Some audio capture scenarios might require full disk access:
1. Go to System Preferences > Security & Privacy > Privacy > Full Disk Access
2. Add Terminal to the allowed list

## Runtime Issues

### No Audio Detected

1. **Check audio devices**:
   ```bash
   system_profiler SPAudioDataType
   ```

2. **Test system audio**:
   - Play music or video to ensure system audio is working
   - Check volume levels

3. **Test microphone**:
   - Use Voice Memos app to test microphone
   - Check input levels in System Preferences > Sound > Input

### High CPU Usage

1. **Reduce audio processing frequency**
2. **Optimize buffer sizes**
3. **Use background queues for processing**

### Memory Leaks

1. **Properly release audio buffers**
2. **Use weak references in closures**
3. **Monitor memory usage with Instruments**

## Development Environment

### Recommended Setup

1. **macOS**: 12.3 or later
2. **Xcode**: 14.0 or later (full Xcode, not just command line tools)
3. **Swift**: 5.9 or later

### Environment Variables

Set these environment variables if needed:

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export SDKROOT=$(xcrun --show-sdk-path)
```

## Testing

### Quick Test Script

```bash
#!/bin/bash
# test_setup.sh

echo "Testing Swift Audio Capture Setup"
echo "================================="

# Check macOS version
echo "macOS Version: $(sw_vers -productVersion)"

# Check Xcode setup
echo "Xcode Path: $(xcode-select --print-path)"
echo "SDK Path: $(xcrun --show-sdk-path 2>/dev/null || echo 'SDK not found')"

# Check Swift version
echo "Swift Version: $(swift --version | head -1)"

# Test build
echo "\nTesting build..."
if swift build --dry-run; then
    echo "✅ Build configuration OK"
else
    echo "❌ Build configuration failed"
fi

# Check permissions
echo "\nPermission Requirements:"
echo "- Microphone: Check System Preferences > Security & Privacy > Privacy > Microphone"
echo "- Screen Recording: Check System Preferences > Security & Privacy > Privacy > Screen Recording"
```

## Getting Help

### Log Collection

When reporting issues, include:

1. **System Information**:
   ```bash
   sw_vers
   xcode-select --print-path
   swift --version
   ```

2. **Build Logs**:
   ```bash
   swift build --verbose
   ```

3. **Runtime Logs**:
   - Full console output from the application
   - Any error messages
   - System log entries related to audio/permissions

### Common Solutions Summary

| Issue | Solution |
|-------|----------|
| xcrun errors | Reinstall command line tools or switch to Xcode |
| AudioKit build fails | Remove AudioKit dependency, use AVAudioEngine |
| No microphone access | Grant microphone permission in System Preferences |
| No system audio | Grant screen recording permission |
| Build fails | Use Xcode instead of command line build |
| High CPU usage | Optimize audio processing and buffer management |