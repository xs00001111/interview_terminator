// Windows audio capture using Web APIs
class WindowsAudioCapture {
  constructor() {
    this.microphoneStream = null;
    this.systemAudioStream = null;
    this.audioContext = null;
    this.microphoneProcessor = null;
    this.systemAudioProcessor = null;
    this.isCapturing = false;
    this.sampleRate = 16000; // Match server expectation
    this.permissionsGranted = {
      microphone: false,
      systemAudio: false
    };
  }

  // Check if browser supports required Web APIs
  checkBrowserSupport() {
    const support = {
      getUserMedia: false,
      getDisplayMedia: false,
      audioContext: false,
      errors: []
    };

    // Check getUserMedia support
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      support.getUserMedia = true;
    } else {
      support.errors.push('getUserMedia API is not supported in this browser.');
    }

    // Check getDisplayMedia support
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      support.getDisplayMedia = true;
    } else {
      support.errors.push('getDisplayMedia API is not supported in this browser.');
    }

    // Check AudioContext support
    if (window.AudioContext || window.webkitAudioContext) {
      support.audioContext = true;
    } else {
      support.errors.push('AudioContext API is not supported in this browser.');
    }

    return support;
  }

  // Check if required permissions are available
  async checkPermissions() {
    const permissions = {
      microphone: false,
      systemAudio: false,
      errors: []
    };

    // First check browser support
    const browserSupport = this.checkBrowserSupport();
    if (browserSupport.errors.length > 0) {
      permissions.errors.push(...browserSupport.errors);
      return permissions;
    }

    try {
      // Check microphone permission
      if (navigator.permissions && navigator.permissions.query) {
        const micPermission = await navigator.permissions.query({ name: 'microphone' });
        permissions.microphone = micPermission.state === 'granted';
        
        if (micPermission.state === 'denied') {
          permissions.errors.push('Microphone access denied. Please enable microphone permissions in your browser settings.');
        }
      } else {
        // Fallback: try to access microphone to check permission
        try {
          const testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          testStream.getTracks().forEach(track => track.stop());
          permissions.microphone = true;
        } catch (error) {
          permissions.errors.push('Microphone access denied or unavailable.');
        }
      }
    } catch (error) {
      permissions.errors.push('Unable to check microphone permissions.');
    }

    // Note: getDisplayMedia permissions cannot be checked beforehand
    // They must be requested through user interaction
    permissions.systemAudio = true; // Will be checked during actual request

    return permissions;
  }

  // Request permissions with user-friendly messages
  async requestPermissions() {
    console.log('🔐 Checking audio permissions...');
    
    const permissionStatus = await this.checkPermissions();
    
    if (permissionStatus.errors.length > 0) {
      const errorMessage = permissionStatus.errors.join('\n');
      console.error('❌ Permission errors:', errorMessage);
      
      // Show user-friendly permission dialog
      this.showPermissionDialog(errorMessage);
      throw new Error(`Permission denied: ${errorMessage}`);
    }
    
    console.log('✅ Audio permissions check completed');
    return permissionStatus;
  }

  // Show permission dialog to user
  showPermissionDialog(message) {
    // Create a simple modal dialog for permission instructions
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      font-family: Arial, sans-serif;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      padding: 30px;
      border-radius: 10px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;
    
    content.innerHTML = `
      <h3 style="color: #d32f2f; margin-bottom: 20px;">🎤 Audio Permissions Required</h3>
      <p style="margin-bottom: 20px; line-height: 1.5;">${message}</p>
      <div style="margin-bottom: 20px; font-size: 14px; color: #666; text-align: left;">
        <strong>To enable audio capture:</strong>
        <br><br><strong>For Microphone:</strong>
        <br>• Click the microphone icon 🎤 in your browser's address bar
        <br>• Select "Allow" for microphone access
        <br>• If blocked, go to browser Settings → Privacy → Microphone
        <br><br><strong>For System Audio:</strong>
        <br>• You'll be prompted to share your screen
        <br>• Make sure to check "Share audio" option
        <br>• Select the appropriate screen/application to share
        <br>• <strong style="color: #d32f2f;">IMPORTANT: Check the "Share audio" or "Share system audio" checkbox.</strong>
        <br><br><strong>Supported Browsers:</strong>
        <br>• Chrome 72+, Firefox 66+, Edge 79+, Safari 13+
      </div>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button id="permission-retry" style="
          background: #4caf50;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        ">Try Again</button>
        <button id="permission-ok" style="
          background: #1976d2;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        ">OK</button>
      </div>
    `;
    
    dialog.appendChild(content);
    document.body.appendChild(dialog);
    
    // Remove dialog when OK is clicked
    document.getElementById('permission-ok').onclick = () => {
      document.body.removeChild(dialog);
    };
    
    // Retry permission request when Try Again is clicked
    document.getElementById('permission-retry').onclick = async () => {
      document.body.removeChild(dialog);
      try {
        await this.startCapture();
      } catch (error) {
        console.error('Retry failed:', error);
        // Don't show dialog again to avoid infinite loop
      }
    };
    
    // Auto-remove after 15 seconds (increased for better UX)
    setTimeout(() => {
      if (document.body.contains(dialog)) {
        document.body.removeChild(dialog);
      }
    }, 15000);
  }

  // Get current permission status
  getPermissionStatus() {
    return {
      microphone: this.permissionsGranted.microphone,
      systemAudio: this.permissionsGranted.systemAudio,
      isCapturing: this.isCapturing
    };
  }

  async startCapture() {
    if (this.isCapturing) {
      console.log('Windows audio capture already active');
      return;
    }

    try {
      console.log('🎤 Requesting microphone and system audio access...');
      console.log('🔍 Current permission status:', this.getPermissionStatus());
      
      // Check and request permissions first
      await this.requestPermissions();
      console.log('✅ Permissions requested');
      
      // Start microphone capture
      console.log('🎤 Starting microphone capture...');
      await this.startMicrophoneCapture();
      console.log('✅ Microphone capture started');
      
      // Start system audio capture
      console.log('🖥️ Starting system audio capture...');
      await this.startSystemAudioCapture();
      console.log('✅ System audio capture started');
      
      this.isCapturing = true;
      console.log('✅ Windows audio capture started successfully');
      console.log('🔍 Final permission status:', this.getPermissionStatus());
      
    } catch (error) {
      console.error('❌ Failed to start Windows audio capture:', error);
      this.stopCapture();
      
      // Show user-friendly error message
      if (error.name === 'NotAllowedError' || error.message.includes('Permission denied')) {
        this.showPermissionDialog('Audio permissions were denied. Please allow microphone and screen sharing access to continue.');
      } else if (error.name === 'NotFoundError') {
        this.showPermissionDialog('No audio devices found. Please check that your microphone is connected and working.');
      } else if (error.name === 'NotSupportedError') {
        this.showPermissionDialog('Audio capture is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Edge.');
      }
      
      throw error;
    }
  }

  async startMicrophoneCapture() {
    try {
      console.log('🎤 Requesting microphone access...');
      
      // Check current microphone permission state
      try {
        const micPermission = await navigator.permissions.query({name: 'microphone'});
        console.log('🔒 Microphone permission state:', micPermission.state);
      } catch (e) {
        console.log('🔒 Permission query not supported, proceeding with getUserMedia');
      }
      
      // Request microphone access
      console.log('[AUDIO] mic promise start');
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log('[AUDIO] mic stream obtained', this.microphoneStream);

      // Log stream track details
      console.log('🎤 Microphone stream obtained:');
      this.microphoneStream.getTracks().forEach((track, index) => {
        console.log(`  Track ${index}:`, {
          kind: track.kind,
          enabled: track.enabled,
          readyState: track.readyState,
          settings: track.getSettings()
        });
      });

      // Mark microphone permission as granted
      this.permissionsGranted.microphone = true;
      
      // Create audio context if not exists
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: this.sampleRate
        });
        
        // Get the actual sample rate (browsers may override our request)
        const realRate = this.audioContext.sampleRate;
        console.log(`🎵 Microphone audio context created:`);
        console.log(`  - Sample rate: ${realRate}Hz (requested: ${this.sampleRate}Hz)`);
        console.log(`  - State: ${this.audioContext.state}`);
        console.log(`  - Base latency: ${this.audioContext.baseLatency || 'N/A'}`);
        
        // Send the actual sample rate to the server
        if (window.electron && window.electron.send) {
          window.electron.send('microphone-audio-meta', { rate: realRate });
        }
      }

      const microphoneSource = this.audioContext.createMediaStreamSource(this.microphoneStream);
      
      // Create script processor for microphone audio data
      this.microphoneProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      let micDataCount = 0;
      this.microphoneProcessor.onaudioprocess = (event) => {
        if (!this.isCapturing) return;
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Log first few data packets for debugging
        if (micDataCount < 3) {
          console.log(`🎤 Microphone data packet ${micDataCount + 1}:`, {
            bufferSize: inputData.length,
            sampleRate: this.audioContext.sampleRate,
            contextState: this.audioContext.state,
            avgAmplitude: inputData.reduce((sum, val) => sum + Math.abs(val), 0) / inputData.length
          });
          micDataCount++;
        }
        
        // Convert Float32Array to Int16Array (Linear16 format)
        const outputBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp and convert to 16-bit signed integer
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          outputBuffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        
        // Send microphone audio data to main process
        if (window.electron && window.electron.sendMicrophoneData) {
          window.electron.sendMicrophoneData(outputBuffer.buffer);
        }
      };

      // Connect the microphone audio processing chain
      microphoneSource.connect(this.microphoneProcessor);
      this.microphoneProcessor.connect(this.audioContext.destination);
      
      console.log('✅ Microphone capture initialized');
      
    } catch (error) {
      console.error('❌ Failed to start microphone capture:', error);
      
      // Provide specific error messages for different scenarios
      if (error.name === 'NotAllowedError') {
        const enhancedError = new Error('Microphone access denied. Please click "Allow" when prompted for microphone permissions.');
        enhancedError.name = 'NotAllowedError';
        throw enhancedError;
      } else if (error.name === 'NotFoundError') {
        const enhancedError = new Error('No microphone found. Please connect a microphone and try again.');
        enhancedError.name = 'NotFoundError';
        throw enhancedError;
      } else if (error.name === 'NotSupportedError') {
        const enhancedError = new Error('Microphone access is not supported in this browser.');
        enhancedError.name = 'NotSupportedError';
        throw enhancedError;
      }
      
      throw error;
    }
  }

  async getWindowsSystemAudioDevice() {
    console.log('🔍 Searching for Windows system audio devices...');
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const systemAudioKeywords = [
        'system audio',
        'stereo mix',
        'what u hear',
        'wave out',
        'cable output',
        'voicemeeter',
        'blackhole',
        'soundflower',
        'wasapi loopback',
        'vb-audio',
        'vb-cable',
        'virtual audio cable',
        'loopback',
        'mixcraft',
        'rec. playback'
      ];

      const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
      console.log(`📊 Found ${audioInputDevices.length} audio input devices:`);
      
      // Log all audio input devices for debugging
      audioInputDevices.forEach((device, index) => {
        console.log(`   ${index + 1}. "${device.label}" (ID: ${device.deviceId.substring(0, 20)}...)`);
      });

      // Look for system audio devices
      for (const device of audioInputDevices) {
        const label = device.label.toLowerCase();
        for (const keyword of systemAudioKeywords) {
          if (label.includes(keyword)) {
            console.log(`✅ Found system audio device: "${device.label}" (matched keyword: "${keyword}")`);
            return device;
          }
        }
      }

      console.log('⚠️ No system audio device found by name matching.');
      console.log('💡 Available options to enable system audio:');
      console.log('   1. Enable "Stereo Mix" in Windows Sound settings');
      console.log('   2. Install VoiceMeeter Banana (free virtual audio mixer)');
      console.log('   3. Install VB-Audio Virtual Cable (virtual audio cable)');
      return null;
    } catch (error) {
      console.error('❌ Error enumerating devices:', error);
      return null;
    }
  }

  async startSystemAudioCapture() {
    try {
      console.log('🖥️ Requesting system audio access...');
      
      let systemAudioDevice = null;
      if (navigator.platform.includes('Win')) {
        systemAudioDevice = await this.getWindowsSystemAudioDevice();
      }

      if (systemAudioDevice) {
        console.log(`🎤 Using dedicated system audio device: "${systemAudioDevice.label}"`);
        this.systemAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: systemAudioDevice.deviceId },
            sampleRate: this.sampleRate,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
      } else {
        console.log('⚠️ No dedicated system audio device found');
        console.log('🔄 Attempting audio loopback fallback...');
        
        try {
          // Use getDisplayMedia with audio loopback as fallback
          // This will trigger the setDisplayMediaRequestHandler in main.js
          this.systemAudioStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: { ideal: 1, max: 5 },
              width: { ideal: 320, max: 640 },
              height: { ideal: 180, max: 360 },
              cursor: 'never'
            },
            audio: true  // This will be handled by the loopback handler
          });
          
          // Disable the video track since we only need audio
          this.systemAudioStream.getVideoTracks().forEach(track => {
            track.enabled = false;
            console.log('📺 Video track disabled (audio loopback mode)');
          });
          
          console.log('✅ Audio loopback system audio capture successful');
          
        } catch (loopbackError) {
          console.log('❌ Audio loopback fallback failed:', loopbackError.message);
          console.log('');
          console.log('💡 To enable system audio capture on Windows:');
          console.log('   1. Enable "Stereo Mix" in Windows Sound settings');
          console.log('   2. Or install VoiceMeeter (virtual audio mixer)');
          console.log('   3. Or use VB-Audio Cable (virtual audio cable)');
          console.log('');
          console.log('📖 Instructions:');
          console.log('   - Right-click speaker icon → Open Sound settings');
          console.log('   - Go to Sound Control Panel → Recording');
          console.log('   - Right-click empty area → Show Disabled Devices');
          console.log('   - Enable "Stereo Mix" or "What U Hear"');
          
          // Continue without system audio - microphone only
          console.log('🎤 Continuing with microphone-only mode');
          window.electron?.send?.('system-audio-missing');
          return;
        }
      }

      // Log all stream tracks
      console.log('🖥️ System audio stream obtained:');
      this.systemAudioStream.getTracks().forEach((track, index) => {
        console.log(`  Track ${index}:`, {
          kind: track.kind,
          enabled: track.enabled,
          readyState: track.readyState,
          settings: track.getSettings()
        });
      });

      // Check if audio track is available
      const audioTracks = this.systemAudioStream.getAudioTracks();
      console.log(`🔊 Audio tracks found: ${audioTracks.length}`);
      
      if (audioTracks.length === 0) {
        console.warn('⚠️ User did not share system audio – continuing mic‑only');
        window.electron?.send?.('system-audio-missing');   // tell main/server
        return;   // leave isCapturing = true so mic keeps flowing
      }

      // Mark system audio permission as granted
      this.permissionsGranted.systemAudio = true;
      
      // Create audio context if not exists
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: this.sampleRate
        });
        
        // Get the actual sample rate (browsers may override our request)
        const realRate = this.audioContext.sampleRate;
        console.log(`🎵 System audio context created:`);
        console.log(`  - Sample rate: ${realRate}Hz (requested: ${this.sampleRate}Hz)`);
        console.log(`  - State: ${this.audioContext.state}`);
        console.log(`  - Base latency: ${this.audioContext.baseLatency || 'N/A'}`);
        
        // Send the actual sample rate to the server
        if (window.electron && window.electron.send) {
          window.electron.send('system-audio-meta', { rate: realRate });
        }
      } else {
        console.log(`🎵 Reusing existing audio context (state: ${this.audioContext.state})`);
      }

      const systemAudioSource = this.audioContext.createMediaStreamSource(this.systemAudioStream);
      
      // Create script processor for system audio data
      this.systemAudioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      let sysDataCount = 0;
      this.systemAudioProcessor.onaudioprocess = (event) => {
        if (!this.isCapturing) return;
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Log first few data packets for debugging
        if (sysDataCount < 3) {
          console.log(`🖥️ System audio data packet ${sysDataCount + 1}:`, {
            bufferSize: inputData.length,
            sampleRate: this.audioContext.sampleRate,
            contextState: this.audioContext.state,
            avgAmplitude: inputData.reduce((sum, val) => sum + Math.abs(val), 0) / inputData.length
          });
          sysDataCount++;
        }
        
        // Convert Float32Array to Int16Array (Linear16 format)
        const outputBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp and convert to 16-bit signed integer
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          outputBuffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        
        // Send system audio data to main process
        if (window.electron && window.electron.sendSystemAudioData) {
          window.electron.sendSystemAudioData(outputBuffer.buffer);
        }
      };

      // Connect the system audio processing chain
      systemAudioSource.connect(this.systemAudioProcessor);
      this.systemAudioProcessor.connect(this.audioContext.destination);
      
      // Listen for stream ending (device disconnected)
      this.systemAudioStream.getAudioTracks().forEach(track => {
        track.onended = () => {
          console.log('🎵 System audio device disconnected');
          this.stopCapture();
        };
      });
      
      console.log('✅ System audio capture initialized');
      
    } catch (error) {
      console.error('❌ Failed to start system audio capture:', error);
      
      // Provide specific error messages for different scenarios
      if (error.name === 'NotAllowedError') {
        const enhancedError = new Error('System audio access denied. Please allow microphone access for the system audio device.');
        enhancedError.name = 'NotAllowedError';
        throw enhancedError;
      } else if (error.name === 'NotFoundError') {
        const enhancedError = new Error('System audio device not found. Please enable "Stereo Mix" or install VoiceMeeter.');
        enhancedError.name = 'NotFoundError';
        throw enhancedError;
      } else if (error.name === 'NotSupportedError') {
        const enhancedError = new Error('System audio capture is not supported. Please enable a system audio device.');
        enhancedError.name = 'NotSupportedError';
        throw enhancedError;
      }
      
      throw error;
    }
  }

  stopCapture() {
    console.log('🛑 Stopping Windows audio capture...');
    console.log('🔍 Current state before stop:', {
      isCapturing: this.isCapturing,
      hasMicProcessor: !!this.microphoneProcessor,
      hasSysProcessor: !!this.systemAudioProcessor,
      hasAudioContext: !!this.audioContext,
      audioContextState: this.audioContext?.state,
      hasMicStream: !!this.microphoneStream,
      hasSysStream: !!this.systemAudioStream
    });
    
    this.isCapturing = false;
    
    // Stop microphone processor
    if (this.microphoneProcessor) {
      console.log('🎤 Disconnecting microphone processor');
      this.microphoneProcessor.disconnect();
      this.microphoneProcessor = null;
    }
    
    // Stop system audio processor
    if (this.systemAudioProcessor) {
      console.log('🖥️ Disconnecting system audio processor');
      this.systemAudioProcessor.disconnect();
      this.systemAudioProcessor = null;
    }
    
    // Close audio context
    if (this.audioContext) {
      console.log('🎵 Closing audio context');
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Stop microphone stream
    if (this.microphoneStream) {
      console.log('🎤 Stopping microphone stream tracks');
      this.microphoneStream.getTracks().forEach(track => {
        console.log(`  Stopping track: ${track.kind} (${track.readyState})`);
        track.stop();
      });
      this.microphoneStream = null;
    }
    
    // Stop system audio stream
    if (this.systemAudioStream) {
      console.log('🖥️ Stopping system audio stream tracks');
      this.systemAudioStream.getTracks().forEach(track => {
        console.log(`  Stopping track: ${track.kind} (${track.readyState})`);
        track.stop();
      });
      this.systemAudioStream = null;
    }
    
    console.log('✅ Windows audio capture stopped');
  }
}

// Global Windows audio capture instance
const windowsAudioCapture = new WindowsAudioCapture();

// Hook into the callbacks exposed by preload.js
if (window.electron && window.electron.onStartWindowsAudioCapture) {
  console.log('[WINDOWS-AUDIO] Registering start-capture callback');
  window.electron.onStartWindowsAudioCapture(async () => {
    console.log('[WINDOWS-AUDIO] start-capture callback fired - starting audio capture');
    console.log('[WINDOWS-AUDIO] Browser support check:');
    const support = windowsAudioCapture.checkBrowserSupport();
    console.log('[WINDOWS-AUDIO] Support results:', support);
    
    try {
      await windowsAudioCapture.startCapture();
      console.log('[WINDOWS-AUDIO] Windows audio capture started successfully');
      
      // Send success confirmation to main process
      if (window.electron.send) {
        window.electron.send('windows-audio-capture-success');
      }
    } catch (error) {
      console.error('[WINDOWS-AUDIO] Failed to start Windows audio capture:', error);
      console.error('[WINDOWS-AUDIO] Error stack:', error.stack);
      
      // Send detailed error back to main process
      if (window.electron.send) {
        window.electron.send('windows-audio-capture-error', {
          message: error.message,
          name: error.name,
          stack: error.stack
        });
      }
    }
  });
} else {
  console.error('[WINDOWS-AUDIO] window.electron or onStartWindowsAudioCapture not available');
  console.log('[WINDOWS-AUDIO] Available electron APIs:', Object.keys(window.electron || {}));
}

if (window.electron && window.electron.onStopWindowsAudioCapture) {
  window.electron.onStopWindowsAudioCapture(() => {
    windowsAudioCapture.stopCapture();
  });
}

// Export for potential direct usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WindowsAudioCapture;
}