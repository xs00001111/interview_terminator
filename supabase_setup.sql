-- This SQL script helps set up the necessary tables in Supabase for the Conversation Helper app

-- Create the api_keys table to store user API keys
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_speech_key TEXT NOT NULL,
  google_gemini_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Set up Row Level Security (RLS) to ensure users can only access their own API keys
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to select only their own API keys
CREATE POLICY "Users can view their own API keys" 
  ON public.api_keys 
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Create policy to allow users to insert their own API keys
CREATE POLICY "Users can insert their own API keys" 
  ON public.api_keys 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

-- Create policy to allow users to update their own API keys
CREATE POLICY "Users can update their own API keys" 
  ON public.api_keys 
  FOR UPDATE 
  USING (auth.uid() = user_id);

-- Create function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update the updated_at timestamp
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Grant necessary permissions
GRANT ALL ON public.api_keys TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.api_keys_id_seq TO authenticated;