console.log('[RENDERER-AUTH] Script starting to load...');

// Use browser-compatible localStorage for session storage
class SupabaseStorage {
  getItem(key) {
    return localStorage.getItem(key);
  }
  setItem(key, value) {
    localStorage.setItem(key, value);
  }
  removeItem(key) {
    localStorage.removeItem(key);
  }
}

// Get Supabase credentials from environment variables via preload
const envVars = window.electron.getEnvVars();
const supabaseUrl = envVars.SUPABASE_URL || 'https://aqhcipqqdtchivmbxrap.supabase.co';
const supabaseKey = envVars.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGNpcHFxZHRjaGl2bWJ4cmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3NzE0NDUsImV4cCI6MjA1NzM0NzQ0NX0.ABSLZyrZ-8LojAriQKlJALmsgChKagrPLXzVabf559Q';

console.log('[RENDERER-AUTH] Using env vars - URL:', !!envVars.SUPABASE_URL, 'Key:', !!envVars.SUPABASE_ANON_KEY);

// Use the globally available Supabase from CDN
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: new SupabaseStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce', // Enable PKCE flow for OAuth
  },
});

console.log('[RENDERER-SUPABASE] Supabase client initialized');

// Expose the methods to the window object
window.auth = {
  signInWithGoogle: async () => {
    console.log('[RENDERER-SUPABASE] Starting Google sign-in');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'myapp://auth-callback',
        skipBrowserRedirect: true, // We will handle the redirect manually
      },
    });

    if (error) {
      console.error('[RENDERER-SUPABASE] Error starting Google sign-in:', error);
      return { error };
    }

    console.log('[RENDERER-SUPABASE] OAuth URL generated:', data.url);
    // Use the preload-exposed openExternal to open the URL in the default browser
    window.electron.openExternal(data.url);
    return { success: true, authUrl: data.url };
  },

  signInWithEmailPassword: async (email, password) => {
    return supabase.auth.signInWithPassword({ email, password });
  },

  handleAuthCallback: async (url) => {
    console.log('[RENDERER-SUPABASE] Processing auth callback:', url);
    
    try {
      const urlObj = new URL(url);
      
      // Check if this is an OAuth callback with an authorization code
      const code = urlObj.searchParams.get('code');
      
      if (code) {
        console.log('[RENDERER-SUPABASE] Found authorization code, using exchangeCodeForSession');
        
        // For OAuth flow with authorization code, exchange it for a session
        // This will automatically handle PKCE if the verifier was stored during initiation
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        
        if (error) {
          console.error('[RENDERER-SUPABASE] Error exchanging code for session:', error);
          return { error };
        }
        
        console.log('[RENDERER-SUPABASE] Session successfully obtained via code exchange');
        return { success: true, session: data?.session };
      } else {
        // Fallback: Try to parse tokens directly from hash (for implicit flow)
        const hashParams = new URLSearchParams(url.includes('#') ? url.split('#')[1] : '');
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (!accessToken || !refreshToken) {
          const error = 'No authorization code or tokens found in callback URL';
          console.error('[RENDERER-SUPABASE]', error);
          return { error: { message: error } };
        }

        console.log('[RENDERER-SUPABASE] Tokens found in hash, setting session...');
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          console.error('[RENDERER-SUPABASE] Error setting session:', error);
          return { error };
        }

        console.log('[RENDERER-SUPABASE] Session successfully set via tokens');
        return { success: true, session: data?.session };
      }
      
    } catch (e) {
      console.error('[RENDERER-SUPABASE] Error processing auth callback:', e);
      return { error: { message: 'Failed to process auth callback URL: ' + e.message } };
    }
  },

  signInWithEmailPassword: async (email, password) => {
    console.log('[RENDERER-SUPABASE] Signing in with email and password');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('[RENDERER-SUPABASE] Error signing in:', error);
      return { error };
    }

    console.log('[RENDERER-SUPABASE] Sign-in successful:', data?.session);
    return { success: true, session: data?.session };
  },

  getSession: async () => {
    const { data, error } = await supabase.auth.getSession();
    return { session: data?.session, error };
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  getUserInfo: async () => {
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !sessionData?.session?.user) {
        console.log('[RENDERER-SUPABASE] No active session for getUserInfo');
        return null;
      }

      const user = sessionData.session.user;
      console.log('[RENDERER-SUPABASE] Getting user info for:', user.email, 'Provider:', user.app_metadata?.provider);
      
      // Fetch user plan from database
      let userPlan = null;
      try {
        const { data: planData, error: planError } = await supabase
          .from('user_plans')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (!planError && planData) {
          // Map plan_type to type for frontend compatibility
          userPlan = {
            ...planData,
            type: planData.plan_type
          };
          console.log('[RENDERER-SUPABASE] Found existing user plan:', userPlan.plan_type);
        } else {
          console.log('[RENDERER-SUPABASE] No existing plan found, using default free plan');
        }
      } catch (planErr) {
        console.log('[RENDERER-SUPABASE] Could not fetch user plan (will use default):', planErr.message);
      }

      // If no plan exists (common for Google OAuth users), provide default free plan
      if (!userPlan) {
        userPlan = {
          plan_type: 'free',
          type: 'free',
          interviews_remaining: 3, // Default free plan allowance
          created_at: new Date().toISOString(),
          user_id: user.id,
          isDefault: true // Flag to indicate this is a default plan, not from database
        };
        console.log('[RENDERER-SUPABASE] Using default free plan for user');
      }

      // Ensure user has email and name information for display
      const userInfo = {
        ...user,
        email: user.email,
        user_metadata: {
          ...user.user_metadata,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'
        }
      };

      console.log('[RENDERER-SUPABASE] Returning user info - Email:', userInfo.email, 'Name:', userInfo.user_metadata?.full_name, 'Plan:', userPlan.plan_type);

      return {
        user: userInfo,
        plan: userPlan
      };
    } catch (error) {
      console.error('[RENDERER-SUPABASE] Error getting user info:', error);
      return null;
    }
  },
  
  // Listen for auth state changes
  onAuthStateChange: (callback) => {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
};