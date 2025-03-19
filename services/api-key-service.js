const { createClient } = require('@supabase/supabase-js');

// Hardcoded Supabase credentials
const SUPABASE_URL = 'https://aqhcipqqdtchivmbxrap.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGNpcHFxZHRjaGl2bWJ4cmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3NzE0NDUsImV4cCI6MjA1NzM0NzQ0NX0.ABSLZyrZ-8LojAriQKlJALmsgChKagrPLXzVabf559Q';

class ApiKeyService {
  constructor() {
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this.session = null;
    this.apiKeys = null;
  }

  async initialize(sessionData) {
    if (sessionData) {
      this.session = sessionData;
      await this.fetchApiKeys();
      return true;
    }
    return false;
  }

  async fetchApiKeys() {
    try {
      if (!this.session) {
        throw new Error('No active session. Please sign in first.');
      }

      // Get API keys from Supabase function
      const { data, error } = await this.supabase.rpc('get_decrypted_api_keys').single();
      
      if (error) throw error;
      
      this.apiKeys = {
        GOOGLE_SPEECH_API_KEY: data.google_speech_api_key || '',
        GOOGLE_GEMINI_API_KEY: data.google_gemini_api_key || '',
        OPENAI_API_KEY: data.openai_api_key || ''
      };
      
      console.log('API keys retrieved successfully');
      return this.apiKeys;
    } catch (error) {
      console.error('Error fetching API keys:', error.message);
      throw error;
    }
  }

  getApiKeys() {
    return this.apiKeys;
  }

  hasValidKeys() {
    return this.apiKeys && 
           this.apiKeys.GOOGLE_SPEECH_API_KEY && 
           this.apiKeys.GOOGLE_GEMINI_API_KEY && 
           this.apiKeys.OPENAI_API_KEY;
  }
}

module.exports = new ApiKeyService();