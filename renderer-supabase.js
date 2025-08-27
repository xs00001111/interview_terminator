// Renderer-only Supabase client with persistent storage
// This ensures PKCE flow state is maintained in the same context

// Get Supabase credentials from environment variables via preload
const envVars = window.electron.getEnvVars();
const SUPABASE_URL = envVars.SUPABASE_URL || "https://aqhcipqqdtchivmbxrap.supabase.co";
const SUPABASE_ANON_KEY = envVars.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGNpcHFxZHRjaGl2bWJ4cmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3NzE0NDUsImV4cCI6MjA1NzM0NzQ0NX0.ABSLZyrZ-8LojAriQKlJALmsgChKagrPLXzVabf559Q";

console.log('[RENDERER-SUPABASE] Using env vars - URL:', !!envVars.SUPABASE_URL, 'Key:', !!envVars.SUPABASE_ANON_KEY);

let supabaseClient = null;
let electronStore = null;

// Initialize electron-store for Supabase storage
function initializeElectronStore() {
    if (!electronStore) {
        // Create a new electron store instance for auth data
        electronStore = new (require('electron-store'))({
            name: 'supabase-auth',
            encryptionKey: 'interview-terminator-auth-key'
        });
        console.log('[RENDERER-SUPABASE] Electron store initialized');
    }
    return electronStore;
}

// Create custom storage adapter for Supabase using electron-store
function createSupabaseStorage() {
    const store = initializeElectronStore();
    
    return {
        getItem: async (key) => {
            const value = store.get(key) ?? null;
            console.log('[RENDERER-SUPABASE] Storage getItem:', key, value ? 'found' : 'not found');
            return value;
        },
        setItem: async (key, value) => {
            store.set(key, value);
            console.log('[RENDERER-SUPABASE] Storage setItem:', key, 'saved');
        },
        removeItem: async (key) => {
            store.delete(key);
            console.log('[RENDERER-SUPABASE] Storage removeItem:', key, 'removed');
        }
    };
}

// Initialize the Supabase client (singleton)
function initializeSupabaseClient() {
    if (!supabaseClient) {
        const storage = createSupabaseStorage();
        
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                flowType: 'pkce',
                detectSessionInUrl: false,
                persistSession: true,
                autoRefreshToken: true,
                storage: storage,
                storageKey: 'interm-auth' // avoid collisions
            }
        });
        
        console.log('[RENDERER-SUPABASE] Supabase client initialized with electron-store');
    }
    
    return supabaseClient;
}

// Google OAuth sign-in
async function signInWithGoogle() {
    try {
        const client = initializeSupabaseClient();
        console.log('[RENDERER-SUPABASE] Starting Google OAuth flow');
        
        const { data, error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: 'myapp://auth-callback',
                skipBrowserRedirect: true
            }
        });
        
        if (error) {
            console.error('[RENDERER-SUPABASE] OAuth initiation failed:', error);
            throw error;
        }
        
        console.log('[RENDERER-SUPABASE] OAuth URL generated:', data.url);
        
        // Debug: Check what keys are in storage after OAuth initiation
        const store = initializeElectronStore();
        const keys = Object.keys(store.store);
        console.log('[DEBUG] Storage keys after OAuth initiation:', keys);
        
        // Open the OAuth URL in system browser
        await window.electron.invoke('open-external-url', data.url);
        
        return { success: true, authUrl: data.url };
    } catch (error) {
        console.error('[RENDERER-SUPABASE] Google sign-in error:', error);
        return { success: false, error: error.message };
    }
}

// Handle auth callback
async function handleAuthCallback(callbackUrl) {
    try {
        const client = initializeSupabaseClient();
        console.log('[RENDERER-SUPABASE] Processing auth callback:', callbackUrl);
        
        // Debug: Check storage keys before exchange
        const store = initializeElectronStore();
        const keysBefore = Object.keys(store.store);
        console.log('[DEBUG] Storage keys before exchange:', keysBefore);
        
        // Convert to query format if needed and exchange
        const fullUrl = callbackUrl.includes('#') ? callbackUrl.replace('#', '?') : callbackUrl;
        
        const { error } = await client.auth.exchangeCodeForSession(fullUrl);
        
        if (error) {
            console.error('[RENDERER-SUPABASE] Exchange failed:', error);
            throw error;
        }
        
        // Get the current session
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        
        if (sessionError || !sessionData?.session) {
            throw new Error('Failed to get session after exchange');
        }
        
        console.log('[RENDERER-SUPABASE] Google OAuth successful:', sessionData.session?.user?.email);
        
        // Debug: Check storage keys after successful exchange
        const keysAfter = Object.keys(store.store);
        console.log('[DEBUG] Storage keys after exchange:', keysAfter);
        
        return {
            success: true,
            session: sessionData.session,
            user: sessionData.session?.user
        };
    } catch (error) {
        console.error('[RENDERER-SUPABASE] Auth callback failed:', error);
        return { success: false, error: error.message };
    }
}

// Get current session
async function getCurrentSession() {
    try {
        const client = initializeSupabaseClient();
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        return data?.session;
    } catch (error) {
        console.error('[RENDERER-SUPABASE] Failed to get session:', error);
        return null;
    }
}

// Sign out
async function signOut() {
    try {
        const client = initializeSupabaseClient();
        const { error } = await client.auth.signOut();
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('[RENDERER-SUPABASE] Sign out failed:', error);
        return false;
    }
}

// Export functions for use in HTML
window.rendererSupabase = {
    signInWithGoogle,
    handleAuthCallback,
    getCurrentSession,
    signOut,
    initializeSupabaseClient
};