// Microphone capture using getUserMedia for older macOS versions
class MicrophoneCapture {
  constructor() {
    this.mediaStream = null;
    this.audioContext = null;
    this.processor = null;
    this.isCapturing = false;
    this.sampleRate = 16000; // Match server expectation
  }

  async startCapture() {
    if (this.isCapturing) {
      console.log('Microphone capture already active');
      return;
    }

    try {
      console.log('Requesting microphone access...');
      
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Create script processor for audio data
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (event) => {
        if (!this.isCapturing) return;
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Convert Float32Array to Int16Array (Linear16 format)
        const outputBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp and convert to 16-bit signed integer
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          outputBuffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        
        // Send audio data to main process
        if (window.electron && window.electron.sendMicrophoneData) {
          window.electron.sendMicrophoneData(Buffer.from(outputBuffer.buffer));
        }
      };

      // Connect the audio processing chain
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      
      this.isCapturing = true;
      console.log('✅ Microphone capture started successfully');
      
    } catch (error) {
      console.error('❌ Failed to start microphone capture:', error);
      this.stopCapture();
      throw error;
    }
  }

  stopCapture() {
    console.log('Stopping microphone capture...');
    
    this.isCapturing = false;
    
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    console.log('✅ Microphone capture stopped');
  }
}

// Global microphone capture instance
let microphoneCapture = null;

// Listen for microphone capture events from main process
if (window.electron) {
  window.electron.onMicrophoneCaptureStart = (callback) => {
    // This would be called when server requests microphone start
    document.addEventListener('start-microphone-capture', callback);
  };
  
  window.electron.onMicrophoneCaptureStop = (callback) => {
    // This would be called when server requests microphone stop
    document.addEventListener('stop-microphone-capture', callback);
  };
}

// Initialize microphone capture when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  microphoneCapture = new MicrophoneCapture();
  
  // Listen for start microphone capture events
  document.addEventListener('start-microphone-capture', async () => {
    try {
      await microphoneCapture.startCapture();
    } catch (error) {
      console.error('Failed to start microphone capture:', error);
    }
  });
  
  // Listen for stop microphone capture events
  document.addEventListener('stop-microphone-capture', () => {
    if (microphoneCapture) {
      microphoneCapture.stopCapture();
    }
  });
});

// Export for potential direct usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MicrophoneCapture;
}