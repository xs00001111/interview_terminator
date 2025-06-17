import Foundation
import ScreenCaptureKit
import AVFoundation
import Darwin

// Audio buffer pool for efficient memory management
class AudioBufferPool {
    private var pcmBufferPool: [AVAudioPCMBuffer] = []
    private var dataPool: [Data] = []
    private let poolLock = NSLock()
    private let maxPoolSize = 10
    
    func borrowPCMBuffer(format: AVAudioFormat, frameCapacity: AVAudioFrameCount) -> AVAudioPCMBuffer? {
        poolLock.lock()
        defer { poolLock.unlock() }
        
        // Try to find a compatible buffer in the pool
        for (index, buffer) in pcmBufferPool.enumerated() {
            if buffer.format.isEqual(format) && buffer.frameCapacity >= frameCapacity {
                let reusedBuffer = pcmBufferPool.remove(at: index)
                reusedBuffer.frameLength = 0 // Reset frame length
                return reusedBuffer
            }
        }
        
        // Create new buffer if none available
        return AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCapacity)
    }
    
    func returnPCMBuffer(_ buffer: AVAudioPCMBuffer) {
        poolLock.lock()
        defer { poolLock.unlock() }
        
        if pcmBufferPool.count < maxPoolSize {
            buffer.frameLength = 0 // Reset for reuse
            pcmBufferPool.append(buffer)
        }
    }
    
    func borrowData(capacity: Int) -> Data {
        poolLock.lock()
        defer { poolLock.unlock() }
        
        // Try to find a suitable Data object in the pool
        for (index, data) in dataPool.enumerated() {
            if data.count >= capacity {
                let reusedData = dataPool.remove(at: index)
                return Data(reusedData.prefix(capacity))
            }
        }
        
        // Create new Data if none available
        return Data(capacity: capacity)
    }
    
    func returnData(_ data: Data) {
        poolLock.lock()
        defer { poolLock.unlock() }
        
        if dataPool.count < maxPoolSize {
            dataPool.append(data)
        }
    }
}

@available(macOS 13.0, *)
class AudioCaptureManager: NSObject, SCStreamOutput {
    private var screenCaptureStream: SCStream?
    private var systemAudioCapture: SystemAudioCapture?
    
    // Permission status tracking
    private var screenRecordingPermissionGranted = false
    
    // Pre-fetched content for faster setup
    private var cachedShareableContent: SCShareableContent?
    
    // Audio buffer pool for efficient memory management
    private let bufferPool = AudioBufferPool()
    
    // Output file handles - stdout for system audio, stderr for microphone
    private let stdoutHandle = FileHandle.standardOutput
    private let stderrHandle = FileHandle.standardError

    override init() {
        super.init()
    }
    
    // MARK: - Permission Management
    
    func checkScreenRecordingPermission() -> Bool {
        // For ScreenCaptureKit, we need to check if we can access screen content
        // This is a basic check - the actual permission dialog will be triggered when we try to capture
        let canRecord = CGPreflightScreenCaptureAccess()
        
        if canRecord {
            print("✅ Screen recording permission available")
            screenRecordingPermissionGranted = true
            return true
        } else {
            print("⚠️ Screen recording permission may be required")
            print("💡 If prompted, please enable screen recording access in System Preferences > Security & Privacy > Privacy > Screen Recording")
            // We'll still attempt to set up capture as the permission dialog might appear
            return true
        }
    }
    
    func checkMicrophonePermission() async -> Bool {
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        if granted {
            print("✅ Microphone permission granted")
        } else {
            print("❌ Microphone permission denied")
            print("💡 Please enable microphone access in System Preferences > Security & Privacy > Privacy > Microphone")
        }
        return granted
    }
    
    private func requestScreenRecordingPermission() -> Bool {
        // Request screen recording permission by attempting to access screen content
        let success = CGRequestScreenCaptureAccess()
        
        if success {
            print("✅ Screen recording permission granted")
            screenRecordingPermissionGranted = true
        } else {
            print("❌ Screen recording permission denied or dialog dismissed")
            print("💡 Please enable screen recording access in System Preferences > Security & Privacy > Privacy > Screen Recording")
            print("💡 You may need to restart the application after granting permission")
        }
        
        return success
    }
    

    

    

    
    // Pre-fetch shareable content for faster system audio setup
    func preloadShareableContent() async -> Void {
        do {
            print("🔄 Pre-loading shareable content...")
            cachedShareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            print("✅ Shareable content pre-loaded")
        } catch {
            print("⚠️ Failed to pre-load shareable content: \(error)")
        }
    }
    
    // Optimize system audio setup with faster configuration using cached content
    private func setupSystemAudioCapture() async {
        do {
            // Get available content
            let content: SCShareableContent
            if let cached = cachedShareableContent {
                content = cached
            } else {
                content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            }
            
            // Create filter for system audio only
            let displays = content.displays
            let filter: SCContentFilter
            if let primaryDisplay = displays.first {
                filter = SCContentFilter(display: primaryDisplay, excludingApplications: [], exceptingWindows: [])
            } else {
                throw NSError(domain: "AudioCaptureManager", code: 5, userInfo: [NSLocalizedDescriptionKey: "No display available for capture"])
            }
            
            // Optimized configuration with Google Speech-to-Text compatible sample rate
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            if #available(macOS 15.0, *) {
                config.captureMicrophone = true  // Enable microphone capture
            }
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 16000  // Google Speech-to-Text optimal sample rate
            config.channelCount = 1    // Mono for speech recognition
            
            // Create optimized stream
            screenCaptureStream = SCStream(filter: filter, configuration: config, delegate: self)
            
            // Add stream outputs based on macOS version
            if #available(macOS 15.0, *) {
                // Use separate outputs for system audio and microphone on macOS 15+
                try screenCaptureStream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global(qos: .userInitiated))
                try screenCaptureStream?.addStreamOutput(self, type: SCStreamOutputType(rawValue: 2)!, sampleHandlerQueue: .global(qos: .userInitiated)) // .microphone
                print("✅ System audio and microphone capture configured (separate streams)")
            } else {
                // Use merged audio output on older macOS versions
                try screenCaptureStream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global())
                print("✅ Audio capture configured (merged stream - requires macOS 15.0+ for separate tracks)")
            }
            
            // Start capture
            try await screenCaptureStream?.startCapture()
        } catch {
            print("❌ Failed to setup system audio capture: \(error)")
        }
    }
    

    
    // Highly optimized startCapture function with maximum parallelization
    func startCapture() async {
        // Check permissions first
        guard checkScreenRecordingPermission() else {
            print("❌ Screen recording permission required")
            return
        }
        
        // Check microphone permission
        guard await checkMicrophonePermission() else {
            print("❌ Microphone permission required")
            return
        }
        
        // Setup both system audio and microphone capture using ScreenCaptureKit
        await setupSystemAudioCapture()
    }
    
    func stopCapture() {
        screenCaptureStream?.stopCapture { error in
            if let error = error {
                print("❌ Error stopping capture: \(error)")
            } else {
                print("✅ Capture stopped")
            }
        }
        
        screenCaptureStream = nil
    }
}

@available(macOS 12.3, *)
extension AudioCaptureManager: SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if #available(macOS 15.0, *) {
            switch type.rawValue {
            case 1: // .audio (system audio)
                handleSystemAudioSample(sampleBuffer)
            case 2: // .microphone
                handleMicrophoneAudioSample(sampleBuffer)
            default:
                return
            }
        } else {
            // On older macOS versions, .audio contains both system and microphone audio merged
            switch type {
            case .audio:
                handleSystemAudioSample(sampleBuffer)
            default:
                return
            }
        }
    }
    
    private func handleSystemAudioSample(_ sampleBuffer: CMSampleBuffer) {
        
        // Extract audio data from sample buffer
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        
        let length = CMBlockBufferGetDataLength(blockBuffer)
        let audioData = UnsafeMutablePointer<UInt8>.allocate(capacity: length)
        defer { audioData.deallocate() }
        
        CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: audioData)
        
        // Use pooled Data object for better memory management
        var data = bufferPool.borrowData(capacity: length)
        data.removeAll(keepingCapacity: true)
        data.append(audioData, count: length)
        
        // Convert raw PCM data to Base64 and write to stdout (system audio channel)
        let base64String = data.base64EncodedString()
        let outputString = "\(base64String)\n"
        if let outputData = outputString.data(using: .utf8) {
            stdoutHandle.write(outputData)
        }
        
        // Return data to pool for reuse
        bufferPool.returnData(data)
        
        // print("🔊 Wrote \(base64String.count) chars of system audio to stdout") // Optional: for debugging
    }
    
    private func handleMicrophoneAudioSample(_ sampleBuffer: CMSampleBuffer) {
        
        // Extract audio data from sample buffer
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        
        let length = CMBlockBufferGetDataLength(blockBuffer)
        let audioData = UnsafeMutablePointer<UInt8>.allocate(capacity: length)
        defer { audioData.deallocate() }
        
        CMBlockBufferCopyDataBytes(blockBuffer, atOffset: 0, dataLength: length, destination: audioData)
        
        // Use pooled Data object for better memory management
        var data = bufferPool.borrowData(capacity: length)
        data.removeAll(keepingCapacity: true)
        data.append(audioData, count: length)
        
        // Convert raw PCM data to Base64 and write to stderr (microphone channel)
        let base64String = data.base64EncodedString()
        let outputString = "\(base64String)\n"
        if let outputData = outputString.data(using: .utf8) {
            stderrHandle.write(outputData)
        }
        
        // Return data to pool for reuse
        bufferPool.returnData(data)
        
        // print("🎤 Wrote \(base64String.count) chars of microphone audio to stderr") // Optional: for debugging
    }
    

    
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("❌ Stream stopped with error: \(error)")
    }
}

// Helper class for system audio capture coordination
class SystemAudioCapture {
    // Additional system audio handling if needed
}

// Global capture manager for signal handling
var globalCaptureManager: AudioCaptureManager?

// Signal handler function
func signalHandler(_ signal: Int32) {
    print("\n🛑 Shutting down...")
    globalCaptureManager?.stopCapture()
    exit(0)
}

// Permission check mode function
@available(macOS 12.3, *)
func checkPermissions() async {
    print("🔐 Checking audio capture permissions...")
    
    let captureManager = AudioCaptureManager()
    
    // Request permissions in parallel
    async let screenPermission = captureManager.checkScreenRecordingPermission()
    async let contentPreload: Void = captureManager.preloadShareableContent()
    
    // Wait for all permissions
    let screenAvailable = await screenPermission
    await contentPreload
    
    print("\n📋 Permission Check Results:")
    print("🖥️  Screen Recording: \(screenAvailable ? "✅ Available" : "❌ Not Available")")
    
    // Exit after checking permissions
    exit(0)
}

// Main execution
@available(macOS 12.3, *)
func main() {
    // Check for permission-check flag
    let args = CommandLine.arguments
    if args.contains("--permission-check") {
        Task {
            await checkPermissions()
        }
        RunLoop.main.run()
        return
    }
    
    print("🎤 Starting Audio Capture Tool")
    print("📡 This tool captures both microphone and system audio separately")
    print("Press Ctrl+C to stop...\n")
    
    let captureManager = AudioCaptureManager()
    globalCaptureManager = captureManager
    
    // Setup signal handling for graceful shutdown
    signal(SIGINT, signalHandler)
    signal(SIGTERM, signalHandler)
    
    // Start capture asynchronously
    Task {
        await captureManager.startCapture()
        print("✅ Audio capture initialization complete")
    }
    
    // Keep the program running
    RunLoop.main.run()
}

// Check if the system supports ScreenCaptureKit audio features
if #available(macOS 13.0, *) {
    main()
} else {
    print("❌ This tool requires macOS 13.0 or later for ScreenCaptureKit audio support")
    print("💡 System audio capture requires macOS 13.0+, microphone capture requires macOS 12.3+")
    print("💡 For best experience with separate audio tracks, use macOS 15.0+")
    exit(1)
}
