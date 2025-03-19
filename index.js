// Script to handle loading indicator and server initialization
document.addEventListener('DOMContentLoaded', () => {
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');
  
  // Show loading overlay by default
  loadingOverlay.style.display = 'flex';
  
  // Listen for server starting event
  window.electron.onServerStarting(() => {
    loadingStatus.textContent = 'Server is starting up...';
  });
  
  // Listen for server ready event
  window.electron.onServerReady((data) => {
    console.log('[DEBUG] Server ready event received:', data);
    loadingStatus.textContent = 'Server is ready!';
    
    // Hide the loading overlay with a slight delay for better UX
    setTimeout(() => {
      console.log('[DEBUG] Hiding loading overlay');
      loadingOverlay.style.display = 'none';
    }, 1000);
  });
  
  // Listen for auth events
  window.electron.onAuthRequired(() => {
    loadingStatus.textContent = 'Authentication required...';
  });
  
  // Listen for auth success
  window.electron.onAuthSuccess(() => {
    loadingStatus.textContent = 'Authentication successful! Starting server...';
  });
  
  // Also listen for the general ready event as a fallback
  window.electron.onReady((data) => {
    console.log('[DEBUG] General ready event received:', data);
    loadingStatus.textContent = 'Server is ready!';
    
    // Hide the loading overlay with a slight delay for better UX
    setTimeout(() => {
      console.log('[DEBUG] Hiding loading overlay (from general ready event)');
      loadingOverlay.style.display = 'none';
    }, 1000);
  });
  
  // Add a timeout to show an error message if the server doesn't start within 30 seconds
  const serverTimeout = setTimeout(() => {
    if (loadingOverlay.style.display !== 'none') {
      loadingStatus.textContent = 'Server initialization is taking longer than expected. Please wait...';
    }
  }, 30000);
  
  // Listen for errors
  window.electron.onError((data) => {
    if (loadingOverlay.style.display !== 'none') {
      loadingStatus.textContent = `Error: ${data.message}`;
    }
  });
});