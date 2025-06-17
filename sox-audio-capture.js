// SoX Audio Capture Module
// This module handles audio recording using SoX for mixed audio streams (mic + system audio)

const recorder = require('node-record-lpcm16');
const { EventEmitter } = require('events');

class SoxAudioCapture extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Default configuration
    this.sampleRateHertz = options.sampleRateHertz || 16000;
    this.threshold = options.threshold || 0;
    this.silence = options.silence || 1000;
    this.keepSilence = options.keepSilence !== false;
    
    // Recording state
    this.isRecording = false;
    this.recordingStream = null;
    this.recordingTimer = null;
    
    // SoX handles audio processing internally, no additional transforms needed
  }
  
  /**
   * Start recording with SoX
   * Returns a mixed stream containing both microphone and system audio
   */
  startRecording() {
    if (this.isRecording) {
      console.log('SoX recording already in progress');
      return;
    }
    
    this.isRecording = true;
    console.log('Starting SoX audio capture (mixed stream: mic + system audio)');
    
    try {
      // Start the recording with SoX
      this.recordingStream = recorder
        .record({
          sampleRateHertz: this.sampleRateHertz,
          threshold: this.threshold,
          silence: this.silence,
          keepSilence: this.keepSilence,
          recordProgram: 'sox',
          options: ['-d', '-b', '16', '-c', '1', '-r', '16000', '-t', 'wav', '-'],
        })
        .stream()
        .on('error', (err) => {
          this.handleRecordingError(err);
        })
        .on('data', (chunk) => {
          console.log(`🎵 [SOX] Audio chunk received: ${chunk.length} bytes`);
        })
        .on('end', () => {
          console.log('SoX recording stream ended');
          this.emit('end');
        });
      
      // SoX provides the mixed audio stream directly, no additional piping needed
      
      this.emit('started');
      console.log('SoX audio capture started successfully');
      
    } catch (error) {
      this.handleRecordingError(error);
    }
  }
  
  /**
   * Stop the recording
   */
  stopRecording() {
    if (!this.isRecording) {
      console.log('SoX recording not active');
      return;
    }
    
    console.log('Stopping SoX audio capture');
    
    // Set recording state to false before stopping streams
    // to prevent error handlers from firing during intentional shutdown
    this.isRecording = false;
    
    // Clear the recording timer if it exists
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
    
    try {
      // Stop the recording stream (SoX) if it's running
      if (this.recordingStream) {
        // Remove any existing error listeners before destroying the stream
        this.recordingStream.removeAllListeners('error');
        
        // Add a one-time error handler that just logs but doesn't crash
        this.recordingStream.once('error', (err) => {
          const errorMessage = err && err.message ? err.message : 'unknown error';
          console.error(`Non-fatal error during SoX stream cleanup: ${errorMessage}`);
        });
        
        // Safely destroy the stream
        // No unpipe needed since SoX handles audio processing internally
        
        try {
          this.recordingStream.destroy();
        } catch (destroyError) {
          const errorMessage = destroyError && destroyError.message ? destroyError.message : 'unknown error';
          console.error(`Non-fatal destroy error: ${errorMessage}`);
        }
        
        this.recordingStream = null;
      }
      
      this.emit('stopped');
      console.log('SoX audio capture stopped successfully');
      
    } catch (error) {
      // Only log the error, don't emit it for normal stop operations
      const errorMessage = error && error.message ? error.message : 'unknown error';
      console.error(`Error during SoX recording cleanup: ${errorMessage}`);
    }
  }
  
  /**
   * Handle recording errors
   */
  handleRecordingError(err) {
    const errorMessage = err && err.message ? err.message : 'Unknown SoX recording error';
    
    console.error('SoX recording error:', errorMessage);
    console.error('SoX recording options:', {
      sampleRateHertz: this.sampleRateHertz,
      recordProgram: 'sox',
      options: ['-d', '-b', '16', '-c', '1', '-r', '16000', '-t', 'wav', '-'],
      PATH: process.env.PATH
    });
    
    this.isRecording = false;
    this.emit('error', new Error(`SoX audio recording error: ${errorMessage}`));
  }
  
  /**
   * Get the current recording stream
   */
  getRecordingStream() {
    return this.recordingStream;
  }
  
  /**
   * Check if currently recording
   */
  getIsRecording() {
    return this.isRecording;
  }
  
  /**
   * Set a recording timer to limit duration
   */
  setRecordingTimer(duration, callback) {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
    }
    
    this.recordingTimer = setTimeout(() => {
      console.log(`SoX recording timer expired after ${duration}ms`);
      this.stopRecording();
      if (callback) callback();
    }, duration);
  }
  
  /**
   * Clear the recording timer
   */
  clearRecordingTimer() {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
  }
  
  /**
   * Verify SoX binary availability
   */
  static verifySoxBinary() {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const soxProcess = spawn('sox', ['--version'], { stdio: 'pipe' });
      
      let output = '';
      soxProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      soxProcess.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      soxProcess.on('close', (code) => {
        if (code === 0 || output.toLowerCase().includes('sox')) {
          console.log('SoX binary verified successfully');
          resolve(true);
        } else {
          reject(new Error(`SoX binary verification failed with code ${code}`));
        }
      });
      
      soxProcess.on('error', (err) => {
        reject(new Error(`SoX binary not found: ${err.message}`));
      });
    });
  }
}

module.exports = SoxAudioCapture;