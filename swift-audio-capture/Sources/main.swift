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
    
    func checkScreenRecordingPermission() async -> Bool {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            // A more reliable check for screen recording permission is to see if any displays are available.
            // If `content.displays` is empty, it's a strong indicator that permission is denied.
            screenRecordingPermissionGranted = !content.displays.isEmpty
            return screenRecordingPermissionGranted
        } catch {
            screenRecordingPermissionGranted = false
            return false
        }
    }
    
    func ensureScreenRecording(_ onGranted: @escaping () -> Void) {
        if CGPreflightScreenCaptureAccess() {
            onGranted()  // already authorized - go ahead
            return
        }
        
        // Show primer message
        print("🔔 Interm AI needs to capture system audio")
        print("This lets the assistant hear the interviewer and give you real-time answers. You'll be asked to allow Screen Recording next.")
        
        // Request permission on main thread
        DispatchQueue.main.async {
            let ok = CGRequestScreenCaptureAccess()
            if ok {
                // user ticked the box and relaunched
                onGranted()
            } else {
                // Show actionable error + Settings link
                print("❌ Screen-recording access is still off.")
                print("💡 Turn it on in System Settings ▶ Privacy & Security ▶ Screen Recording, tick Interm AI, then quit and reopen the app.")
                exit(2) // Exit with code 2 to indicate screen recording permission denied
            }
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
    
    func requestScreenRecordingPermission() -> Bool {
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
    func preloadShareableContent() async -> Bool {
        // Only attempt to preload if permission is granted.
        guard screenRecordingPermissionGranted else { return false }
        do {
            print("🔄 Pre-loading shareable content...")
            cachedShareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            // Avoid printing success message if content is empty (permission denied)
            if !(cachedShareableContent?.applications.isEmpty ?? true) {
                print("✅ Shareable content pre-loaded")
            }
            return true
        } catch {
            // Suppress error messages when pre-loading fails due to permissions.
            if let scError = error as? SCStreamError, scError.code == .userDeclined {
                // This is an expected failure when permissions are not granted.
            } else {
                print("⚠️ Failed to pre-load shareable content: \(error)")
            }
            return false
        }
    }
    
    // Optimize system audio setup with faster configuration using cached content
    private func setupSystemAudioCapture() async {
        do {
            // Use cached content immediately
            let content: SCShareableContent
            if let cachedContent = cachedShareableContent {
                content = cachedContent
            } else {
                // Fallback to fresh content if cache miss
                let freshContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                cachedShareableContent = freshContent
                content = freshContent
            }
            
            // Create filter with minimal configuration
            let filter = SCContentFilter(display: content.displays.first!, 
                                       excludingApplications: [], 
                                       exceptingWindows: [])
            
            // Pre-configured optimized settings
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = true
            config.sampleRate = 16000
            config.channelCount = 1
            
            if #available(macOS 15.0, *) {
                config.captureMicrophone = true
            }
            
            // Create and start stream in one operation
            screenCaptureStream = SCStream(filter: filter, configuration: config, delegate: self)
            
            // Add outputs with high priority queue
            let queue = DispatchQueue.global(qos: .userInitiated)
            try screenCaptureStream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            
            if #available(macOS 15.0, *) {
                try screenCaptureStream?.addStreamOutput(self, type: SCStreamOutputType(rawValue: 2)!, sampleHandlerQueue: queue)
            }
            
            try await screenCaptureStream?.startCapture()
        } catch {
            print("❌ Failed to setup system audio capture: \(error)")
        }
    }
    

    
    // Highly optimized startCapture function with maximum parallelization
    func startCapture() async {
        // Check microphone permission first
        guard await checkMicrophonePermission() else {
            print("❌ Microphone permission required")
            return
        }
        
        // Ensure screen recording permission and setup capture
        ensureScreenRecording { [weak self] in
            Task {
                await self?.setupSystemAudioCapture()
            }
        }
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
    
    // Add a background content refresh
    private func refreshShareableContentInBackground() {
        Task {
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                await MainActor.run {
                    self.cachedShareableContent = content
                }
            } catch {
                print("Failed to refresh shareable content: \(error)")
            }
        }
    }
    
    // Call this periodically or on app launch
    func preWarmContent() {
        refreshShareableContentInBackground()
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
    // Perform checks concurrently
    async let micPermission = captureManager.checkMicrophonePermission()
    async let screenPermission = captureManager.checkScreenRecordingPermission()

    let (micOK, screenOK) = await (micPermission, screenPermission)

    // Attempt to preload content only if screen permission seems to be granted
    if screenOK {
        _ = await captureManager.preloadShareableContent()
    }

    print("\n📋 Permission Check Results:")
    print("🎤 Microphone: \(micOK ? "✅ Available" : "❌ Not Available")")
    print("🖥️  Screen Recording: \(screenOK ? "✅ Available" : "❌ Not Available")")

    if micOK && screenOK {
        print("\n✅ All required permissions are available.")
        exit(0)
    } else {
        // The server will interpret this and show the correct modal
        exit(1)
    }
}

// Permission request mode function
@available(macOS 12.3, *)
func requestPermissions() async {
    print("🔐 Requesting audio capture permissions...")
    
    let captureManager = AudioCaptureManager()
    
    // Request microphone permission
    let microphoneGranted = await captureManager.checkMicrophonePermission()
    
    // Request screen recording permission
    print("🔄 Requesting screen recording permission...")
    let screenGranted = captureManager.requestScreenRecordingPermission()
    
    print("\n📋 Permission Request Results:")
    print("🎤 Microphone: \(microphoneGranted ? "✅ Granted" : "❌ Denied")")
    print("🖥️  Screen Recording: \(screenGranted ? "✅ Granted" : "❌ Denied")")
    
    if microphoneGranted && screenGranted {
        print("\n✅ All permissions granted successfully!")
        exit(0)
    } else {
        print("\n❌ Some permissions were denied. Please grant them in System Preferences.")
        exit(1)
    }
}

// Main execution
@available(macOS 12.3, *)
func main() {
    let args = CommandLine.arguments
    
    // Check for permission-check flag
    if args.contains("--permission-check") {
        Task {
            await checkPermissions()
        }
        RunLoop.main.run()
        return
    }
    
    // Check for permission-request flag
    if args.contains("--request-permissions") {
        Task {
            await requestPermissions()
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
    }
    print("✅ Audio capture initialization complete")
    
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
