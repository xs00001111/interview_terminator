import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase credentials');
}

// Create Supabase client instance
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Authentication service
export const AuthService = {
    /**
     * Sign up a new user
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise}
     */
    signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });
        if (error) throw error;
        return data;
    },

    /**
     * Sign in a user
     * @param {string} email 
     * @param {string} password 
     * @returns {Promise}
     */
    signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        return data;
    },

    /**
     * Sign out the current user
     * @returns {Promise}
     */
    signOut: async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
    },

    /**
     * Reset password for a user
     * @param {string} email 
     * @returns {Promise}
     */
    resetPassword: async (email) => {
        const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/landing/index.html'
        });
        if (error) throw error;
        return data;
    },

    /**
     * Get the current session
     * @returns {Promise}
     */
    getSession: async () => {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        return session;
    },

    /**
     * Get the current user
     * @returns {Object|null}
     */
    getCurrentUser: () => {
        return supabase.auth.user();
    },

    /**
     * Subscribe to auth state changes
     * @param {Function} callback 
     */
    onAuthStateChange: (callback) => {
        return supabase.auth.onAuthStateChange(callback);
    }
};