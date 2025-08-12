const EventEmitter = require('events');
const sessionStore = require('../utils/session-store');

class AuthService extends EventEmitter {
  constructor(supabaseClient) {
    super();
    this.supabase = supabaseClient; // Use the Supabase client passed from main process
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
            const subscription = await this.fetchUserPlan();
            if (subscription) {
              console.log('[AUTH] User has an active plan');
              this.subscription = subscription;
              // Save the subscription to storage
              sessionStore.saveSession(this.session, this.subscription);
            } else {
              console.log('[AUTH] User does not have an active plan - using free plan');
            }
            
            // Allow access regardless of subscription status (free plan)
            this.emit('auth-success', this.session);
            return true;
          } else {
            console.log('[AUTH] Stored session expired, attempting refresh');
            
            // Try to refresh the session
            const refreshedSession = await this.refreshSession();
            
            if (refreshedSession) {
              console.log('[AUTH] Session refreshed successfully');
              
              // Check if user has an active subscription after refresh
              const subscription = await this.fetchUserPlan();
              if (subscription) {
                console.log('[AUTH] User has an active plan');
                this.subscription = subscription;
                // Save the refreshed session and subscription
                sessionStore.saveSession(this.session, this.subscription);
              } else {
                console.log('[AUTH] User does not have an active plan - using free plan');
                // Save only the session
                sessionStore.saveSession(this.session);
              }
              
              // Allow access regardless of subscription status (free plan)
              this.emit('auth-success', this.session);
              return true;
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

  // Sign in with Google OAuth using system browser
  async signInWithGoogleDesktop() {
    try {
      const { data, error } = await this.supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'myapp://auth-callback',
          skipBrowserRedirect: true, // important for Electron - don't auto-redirect
          queryParams: {
            redirect_to: 'myapp://auth-callback'  // Ensure this parameter is set
          }
        },
      });

      if (error) throw error;

      console.log('[AUTH] Google OAuth URL generated:', data.url);
      
      // Return the OAuth URL so main process can open it in system browser
      return {
        success: true,
        authUrl: data.url
      };
    } catch (error) {
      console.error('[AUTH] Google OAuth initiation failed:', error.message);
      this.emit('auth-error', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Handle auth callback from deep link 
  async handleDeepLinkCallback(callbackUrl) {
    try {
      console.log('[AUTH] Processing deep link callback:', callbackUrl);
      
      // Parse the URL to get the code and state parameters
      const url = new URL(callbackUrl);
      const code = url.searchParams.get('code');
      
      if (!code) {
        throw new Error('No authorization code received in callback');
      }
      
      console.log('[AUTH] Extracted code from callback:', code.substring(0, 10) + '...');
      
      // Convert the callback URL to the format Supabase expects for hash-based URLs
      // Some versions expect fragments (#) instead of query parameters (?)
      const hashUrl = callbackUrl.replace('?', '#');
      console.log('[AUTH] Trying with hash format:', hashUrl);
      
      // Try exchangeCodeForSession with hash format first
      let { data, error } = await this.supabase.auth.exchangeCodeForSession(hashUrl);
      
      if (error && error.message?.includes('flow_state_not_found')) {
        console.log('[AUTH] Hash format failed, trying original query format...');
        
        // Try with original query format
        const result = await this.supabase.auth.exchangeCodeForSession(callbackUrl);
        data = result.data;
        error = result.error;
      }
      
      if (error) {
        console.error('[AUTH] exchangeCodeForSession failed:', error);
        this.emit('auth-error', error.message);
        return { success: false, error: error.message };
      }
      
      var sessionData = data;
      
      if (!sessionData.session) {
        throw new Error('No session after successful auth exchange');
      }

      // Extend the session expiration time to 7 days from now
      const extendedSession = { ...sessionData.session };
      const now = new Date();
      const sevenDaysInSeconds = 7 * 24 * 60 * 60; // 7 days in seconds
      extendedSession.expires_at = Math.floor(now.getTime() / 1000) + sevenDaysInSeconds;
      
      this.session = extendedSession;
      console.log('[AUTH] Google OAuth login successful');
      console.log('[AUTH] Session details:', {
        user: sessionData.session.user.email,
        expires_at: new Date(extendedSession.expires_at * 1000).toISOString(),
        provider: sessionData.session.user.app_metadata?.provider
      });
      
      // Check if user has an active subscription
      const subscription = await this.fetchUserPlan();
      if (subscription) {
        console.log('[AUTH] User has an active subscription');
        this.subscription = subscription;
        // Save session and subscription to persistent storage
        sessionStore.saveSession(this.session, this.subscription);
      } else {
        console.log('[AUTH] User does not have an active plan - using free plan');
        // Save only the session to persistent storage
        sessionStore.saveSession(this.session);
      }
      
      // Emit auth success event
      this.emit('auth-success', this.session);
      
      return { success: true, session: this.session };
    } catch (error) {
      console.error('[AUTH] Error handling deep link callback:', error);
      this.emit('auth-error', error.message);
      return { success: false, error: error.message };
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
      const subscription = await this.fetchUserPlan();
      if (subscription) {
        console.log('[AUTH] User has an active subscription');
        this.subscription = subscription;
        
        // Save session and subscription to persistent storage
        sessionStore.saveSession(this.session, this.subscription);
      } else {
        console.log('[AUTH] User does not have an active plan - using free plan');
        
        // Save only the session to persistent storage
        sessionStore.saveSession(this.session);
      }
      
      // Always emit auth-success regardless of subscription status
      // This allows users with free plans to access the application
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

  // Get the current session
  async getSession() {
    try {
      const { data, error } = await this.supabase.auth.getSession();
      if (error) throw error;
      this.session = data.session;
      return this.session;
    } catch (error) {
      console.error('[AUTH] Failed to get current session:', error);
      return null;
    }
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
      
      // Session is valid if it's not expired
      // We no longer require a subscription for basic access (free plan)
      return isValid;
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
   * Fetch the user's plan from Supabase
   * @returns {Object|null} The plan object or null if not found
   */
  async fetchUserPlan() {
    try {
      if (!this.session || !this.session.user) {
        console.log('[AUTH] No active session, cannot fetch user plan');
        return null;
      }

      const userId = this.session.user.id;
      console.log('[AUTH] Fetching user plan for user:', userId);

      // Query the user_plans table instead of stripe_subscriptions
      const { data, error } = await this.supabase
        .from('user_plans')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(); // Use maybeSingle instead of single to avoid errors when multiple rows exist

      if (error) {
        console.error('[AUTH] Error fetching user plan:', error.message);
        return null;
      }

      if (!data) {
        console.log('[AUTH] No plan found for user');
        return null;
      }

      // Check if the plan is still valid (expires_at is in the future or null)
      const now = new Date();
      const isExpired = data.expires_at ? new Date(data.expires_at) < now : false;
      
      if (isExpired && data.plan_type === 'guaranteed_job') {
        console.log('[AUTH] Plan has expired:', {
          expires_at: data.expires_at,
          current_time: now.toISOString()
        });
        return null;
      }

      console.log('[AUTH] Active plan found:', {
        type: data.plan_type,
        interviews_remaining: data.interviews_remaining,
        minutes_per_interview: data.minutes_per_interview
      });

      return data;
    } catch (error) {
      console.error('[AUTH] Error in fetchUserPlan:', error);
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

  async getUserInfo() {
    if (!this.session || !this.session.user) {
      return null;
    }

    // Fetch the latest user plan to ensure interviews_remaining is up-to-date
    const latestPlan = await this.fetchUserPlan();

    // Map the plan_type field to type for frontend compatibility
    const mappedPlan = latestPlan ? {
      ...latestPlan,
      type: latestPlan.plan_type // Map plan_type to type
    } : null;

    // Return basic user info and the current plan, including interviews_remaining
    return {
      user: this.session.user,
      plan: mappedPlan // This will be the full plan object with interviews_remaining and type field
    };
  }
}

module.exports = AuthService;