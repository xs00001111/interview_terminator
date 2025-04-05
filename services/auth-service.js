const { createClient } = require('@supabase/supabase-js');
const EventEmitter = require('events');
const sessionStore = require('../utils/session-store');

// Get Supabase configuration from environment variables
const SUPABASE_URL = "https://aqhcipqqdtchivmbxrap.supabase.co";
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGNpcHFxZHRjaGl2bWJ4cmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3NzE0NDUsImV4cCI6MjA1NzM0NzQ0NX0.ABSLZyrZ-8LojAriQKlJALmsgChKagrPLXzVabf559Q';
const REDIRECT_URL = 'app://callback';

// Add validation to ensure environment variables are loaded
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[AUTH] Supabase credentials not found in environment variables');
  console.error('[AUTH] Please ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in .env file');
}

class AuthService extends EventEmitter {
  constructor() {
    super();
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.authWindow = null;
    this.session = null;
    this.subscription = null;
  }

  // Initialize auth service and check for existing session
  async initialize() {
    try {
      // Try to load session from storage
      const storedSession = sessionStore.loadSession();
      // Try to load subscription from storage
      const storedSubscription = sessionStore.loadSubscription();
      
      if (storedSession) {
        console.log('[AUTH] Found stored session, checking validity');
        
        // Set the session from storage
        this.session = storedSession;
        
        // Set the subscription from storage if available
        if (storedSubscription) {
          console.log('[AUTH] Found stored subscription');
          this.subscription = storedSubscription;
        }
        
        // Check if the session is still valid
        if (this.session.expires_at) {
          const expiresAt = new Date(this.session.expires_at * 1000);
          const now = new Date();
          const isSessionValid = expiresAt > now;
          
          if (isSessionValid) {
            console.log('[AUTH] Stored session is valid');
            
            // If we already have a subscription from storage, use it
            if (this.subscription) {
              console.log('[AUTH] Using stored subscription');
              this.emit('auth-success', this.session);
              return true;
            }
            
            // Otherwise fetch subscription from server
            const subscription = await this.fetchSubscription();
            if (subscription) {
              console.log('[AUTH] User has an active subscription');
              this.subscription = subscription;
              // Save the subscription to storage
              sessionStore.saveSession(this.session, this.subscription);
              this.emit('auth-success', this.session);
              return true;
            } else {
              console.log('[AUTH] User does not have an active subscription');
              this.emit('subscription-error', 'No active subscription found');
              return false;
            }
          } else {
            console.log('[AUTH] Stored session expired, attempting refresh');
            
            // Try to refresh the session
            const refreshedSession = await this.refreshSession();
            
            if (refreshedSession) {
              console.log('[AUTH] Session refreshed successfully');
              
              // Check if user has an active subscription after refresh
              const subscription = await this.fetchSubscription();
              if (subscription) {
                console.log('[AUTH] User has an active subscription');
                this.subscription = subscription;
                // Save the refreshed session and subscription
                sessionStore.saveSession(this.session, this.subscription);
                return true;
              } else {
                console.log('[AUTH] User does not have an active subscription');
                this.emit('subscription-error', 'No active subscription found');
                return false;
              }
            } else {
              console.log('[AUTH] Session refresh failed, clearing stored session');
              sessionStore.clearSession();
              return false;
            }
          }
        } else {
          console.log('[AUTH] Stored session is missing expiration time');
          sessionStore.clearSession();
          return false;
        }
      }
      
      console.log('[AUTH] No stored session found');
      return false;
    } catch (error) {
      console.error('[AUTH] Error initializing auth service:', error);
      return false;
    }
  }



  // Sign in with email/password
  async signInWithEmailPassword(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      // Extend the session expiration time to 7 days from now
      const extendedSession = { ...data.session };
      const now = new Date();
      const sevenDaysInSeconds = 7 * 24 * 60 * 60; // 7 days in seconds
      extendedSession.expires_at = Math.floor(now.getTime() / 1000) + sevenDaysInSeconds;
      
      this.session = extendedSession;
      console.log('[AUTH] Login successful');
      console.log('[AUTH] Session details:', {
        user: data.session.user.email,
        expires_at: new Date(extendedSession.expires_at * 1000).toISOString(),
        last_sign_in: data.session.user.last_sign_in_at
      });
      console.log('[AUTH] Session extended to 7 days');
      
      // Check if user has an active subscription
      const subscription = await this.fetchSubscription();
      if (subscription) {
        console.log('[AUTH] User has an active subscription');
        this.subscription = subscription;
        
        // Save session and subscription to persistent storage
        sessionStore.saveSession(this.session, this.subscription);
        
        this.emit('auth-success', this.session);
        return true;
      } else {
        console.log('[AUTH] User does not have an active subscription');
        
        // Save only the session to persistent storage
        sessionStore.saveSession(this.session);
        
        this.emit('subscription-error', 'No active subscription found');
        return false;
      }
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
      
      // Save session to persistent storage
      sessionStore.saveSession(this.session);
      
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
      // Check if session has required properties
      if (!this.session.expires_at || !this.session.user) {
        console.log('[DEBUG] Auth service - Session is missing required properties');
        return false;
      }
      
      const expiresAt = new Date(this.session.expires_at * 1000);
      const now = new Date();
      const isValid = expiresAt > now;
      
      console.log('[DEBUG] Auth service - Session expires at:', expiresAt.toISOString());
      console.log('[DEBUG] Auth service - Current time:', now.toISOString());
      console.log('[DEBUG] Auth service - Session is valid:', isValid);
      console.log('[DEBUG] Auth service - Time until expiry:', Math.floor((expiresAt - now) / 1000 / 60), 'minutes');
      
      // Also check if we have a subscription
      const hasSubscription = !!this.subscription;
      console.log('[DEBUG] Auth service - Has subscription:', hasSubscription);
      
      // Session is only valid if both the session is valid AND we have a subscription
      return isValid && hasSubscription;
    }
    
    return false;
  }

  // Refresh the session
  async refreshSession() {
    try {
      const { data, error } = await this.supabase.auth.refreshSession();
      
      if (error) throw error;
      
      // Extend the session expiration time to 7 days from now
      const extendedSession = { ...data.session };
      const now = new Date();
      const sevenDaysInSeconds = 7 * 24 * 60 * 60; // 7 days in seconds
      extendedSession.expires_at = Math.floor(now.getTime() / 1000) + sevenDaysInSeconds;
      
      this.session = extendedSession;
      console.log('[AUTH] Session refreshed successfully');
      console.log('[AUTH] New session expires at:', new Date(extendedSession.expires_at * 1000).toISOString());
      console.log('[AUTH] Session extended to 7 days');
      
      // Update the session in persistent storage (with subscription if available)
      if (this.subscription) {
        sessionStore.saveSession(this.session, this.subscription);
      } else {
        sessionStore.saveSession(this.session);
      }
      
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
      this.subscription = null;
      
      // Clear the session from persistent storage
      sessionStore.clearSession();
      
      this.emit('sign-out');
      return true;
    } catch (error) {
      console.error('Error signing out:', error);
      return false;
    }
  }

  /**
   * Fetch the user's subscription from Supabase
   * @returns {Object|null} The subscription object or null if not found
   */
  async fetchSubscription() {
    try {
      if (!this.session || !this.session.user) {
        console.log('[AUTH] No active session, cannot fetch subscription');
        return null;
      }

      const userId = this.session.user.id;
      console.log('[AUTH] Fetching subscription for user:', userId);

      // Query the subscriptions table for the current user
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (error) {
        console.error('[AUTH] Error fetching subscription:', error.message);
        return null;
      }

      if (!data) {
        console.log('[AUTH] No subscription found for user');
        return null;
      }

      // Check if the subscription is still valid (current_period_end is in the future)
      const now = new Date();
      const periodEnd = new Date(data.current_period_end);
      
      if (periodEnd <= now) {
        console.log('[AUTH] Subscription has expired:', {
          current_period_end: periodEnd.toISOString(),
          current_time: now.toISOString()
        });
        return null;
      }

      console.log('[AUTH] Active subscription found:', {
        plan_type: data.plan_type,
        status: data.status,
        current_period_end: periodEnd.toISOString()
      });

      return data;
    } catch (error) {
      console.error('[AUTH] Error in fetchSubscription:', error);
      return null;
    }
  }

  /**
   * Check if the user has an active subscription
   * @returns {Object|boolean} The subscription object or false if not found
   */
  hasActiveSubscription() {
    return this.subscription || false;
  }

  /**
   * Get the current subscription
   * @returns {Object|null} The subscription object
   */
  getSubscription() {
    return this.subscription;
  }
}

module.exports = AuthService;