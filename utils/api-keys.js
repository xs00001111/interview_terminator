const fs = require('fs').promises;
const path = require('path');

async function saveApiKeys(apiKeys, envPath) {
  try {
    // Read existing .env file if it exists
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch (err) {
      console.log('No existing .env file found, creating new one.');
    }

    // Parse existing env content
    const envLines = envContent.split('\n').filter(line => line.trim());
    const envVars = {};
    envLines.forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key) envVars[key.trim()] = valueParts.join('=').trim();
    });

    // Update API keys
    Object.entries(apiKeys).forEach(([key, value]) => {
      envVars[key] = value;
    });

    // Create new .env content
    const newEnvContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // Write updated content back to .env file
    await fs.writeFile(envPath, newEnvContent + '\n');
    
    console.log('API keys have been successfully written to .env file');
    return true;
  } catch (error) {
    console.error('Error saving API keys:', error.message);
    return false;
  }
}

module.exports = {
  saveApiKeys
};