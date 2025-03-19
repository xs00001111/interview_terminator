const { createClient } = require('@supabase/supabase-js');
const EventEmitter = require('events');

// Supabase configuration
const SUPABASE_URL = 'https://aqhcipqqdtchivmbxrap.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGNpcHFxZHRjaGl2bWJ4cmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3NzE0NDUsImV4cCI6MjA1NzM0NzQ0NX0.ABSLZyrZ-8LojAriQKlJALmsgChKagrPLXzVabf559Q';
const REDIRECT_URL = 'app://callback';

class AuthService extends EventEmitter {
  constructor() {
    super();
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.authWindow = null;
    this.session = null;
  }



  // Sign in with email/password
  async signInWithEmailPassword(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      this.session = data.session;
      console.log('[AUTH] Login successful');
      console.log('[AUTH] Session details:', {
        user: data.session.user.email,
        expires_at: new Date(data.session.expires_at * 1000).toISOString(),
        last_sign_in: data.session.user.last_sign_in_at
      });
      this.emit('auth-success', this.session);
      return true;
    } catch (error) {
      console.error('[AUTH] Login failed:', error.message);
      console.error('[AUTH] Error details:', {
        status: error.status,
        name: error.name,
        timestamp: new Date().toISOString()
      });
      this.emit('auth-error', error.message);
      return false;
    }
  }

  // Create the auth window
  createAuthWindow(authUrl) {
    this.authWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Register protocol handler for the callback
    if (!session.defaultSession.protocol.isRegisteredProtocol('app')) {
      session.defaultSession.protocol.registerHttpProtocol('app', (request, callback) => {
        const url = new URL(request.url);
        if (url.hostname === 'callback') {
          this.handleAuthCallback(url);
        }
      });
    }

    // Load the auth URL
    this.authWindow.loadURL(authUrl);

    // Handle window close
    this.authWindow.on('closed', () => {
      this.authWindow = null;
    });
  }

  // Handle the auth callback
  async handleAuthCallback(url) {
    try {
      // Extract the authorization code from the URL
      const code = new URLSearchParams(url.search).get('code');
      
      if (!code) {
        throw new Error('No authorization code received');
      }
      
      // Exchange the code for a token
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email: this.email,
        password: this.password
      });
      
      if (error) throw error;
      
      // Store the session
      this.session = data.session;
      
      // Close the auth window
      if (this.authWindow) {
        this.authWindow.close();
        this.authWindow = null;
      }
      
      // Emit auth success event
      this.emit('auth-success', this.session);
      
      return this.session;
    } catch (error) {
      console.error('Error handling auth callback:', error);
      this.emit('auth-error', error.message);
      
      // Close the auth window
      if (this.authWindow) {
        this.authWindow.close();
        this.authWindow = null;
      }
      
      return null;
    }
  }

  // Get the current session
  getSession() {
    return this.session;
  }

  // Check if we have a valid session
  // Add these debug logs to the hasValidSession method in auth-service.js
  hasValidSession() {
    const hasSession = !!this.session;
    console.log('[DEBUG] Auth service - Has session:', hasSession);
    
    if (hasSession) {
      const expiresAt = new Date(this.session.expires_at * 1000);
      const now = new Date();
      const isValid = expiresAt > now;
      
      console.log('[DEBUG] Auth service - Session expires at:', expiresAt.toISOString());
      console.log('[DEBUG] Auth service - Current time:', now.toISOString());
      console.log('[DEBUG] Auth service - Session is valid:', isValid);
      console.log('[DEBUG] Auth service - Time until expiry:', Math.floor((expiresAt - now) / 1000 / 60), 'minutes');
      
      return isValid;
    }
    
    return false;
  }

  // Refresh the session
  async refreshSession() {
    try {
      const { data, error } = await this.supabase.auth.refreshSession();
      
      if (error) throw error;
      
      this.session = data.session;
      console.log('[AUTH] Session refreshed successfully');
      console.log('[AUTH] New session expires at:', new Date(data.session.expires_at * 1000).toISOString());
      return this.session;
    } catch (error) {
      console.error('[AUTH] Session refresh failed:', error.message);
      console.error('[AUTH] Refresh error details:', {
        status: error.status,
        name: error.name,
        timestamp: new Date().toISOString()
      });
      this.emit('auth-error', error.message);
      return null;
    }
  }

  // Sign out
  async signOut() {
    try {
      await this.supabase.auth.signOut();
      this.session = null;
      this.emit('sign-out');
      return true;
    } catch (error) {
      console.error('Error signing out:', error);
      return false;
    }
  }
}

module.exports = AuthService;