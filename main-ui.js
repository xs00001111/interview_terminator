// Utility function to show notifications and prevent duplicates
function showNotification(message, type = 'success') {
    // Remove any existing notifications first to prevent duplicates
    const existingNotifications = document.querySelectorAll('.context-success-notification');
    existingNotifications.forEach(notification => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    });
    
    // Create new notification
    const notification = document.createElement('div');
    notification.className = 'context-success-notification';
    if (type === 'success') {
        notification.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    } else if (type === 'error') {
        notification.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
        notification.style.backgroundColor = 'rgba(255, 68, 68, 0.9)';
    } else if (type === 'file-success') {
        notification.innerHTML = `<i class="fas fa-file-upload"></i> ${message}`;
        notification.classList.add('file-success');
    } else if (type === 'text-success') {
        notification.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
        notification.classList.add('text-success');
    }
    
    document.body.appendChild(notification);
    
    // Show the notification with animation
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 500);
    }, 3000);
    
    return notification;
}

document.addEventListener('DOMContentLoaded', () => {
    // Global variables for version-specific behavior
    let isMacOS15Plus = false;
    let hasAIAnswerGenerated = false;

    // Check macOS version and show alert if below 15.0
    function checkMacOSVersion() {
        if (navigator.platform.includes('Mac')) {
            const userAgent = navigator.userAgent;
            const macOSMatch = userAgent.match(/Mac OS X (\d+)_(\d+)/);
            
            if (macOSMatch) {
                const majorVersion = parseInt(macOSMatch[1]);
                const minorVersion = parseInt(macOSMatch[2]);
                
                // macOS 15.0 corresponds to Mac OS X 10_15 in user agent
                // Actually, macOS 15 (Sequoia) would be represented differently
                // Let's check for macOS version using a more reliable method
                if (window.electron && window.electron.getOSVersion) {
                    window.electron.getOSVersion().then(kernelVersion => {
                        // Convert Darwin kernel version to macOS version
                        // macOS 15 (Sequoia) corresponds to Darwin 24.x
                        // macOS 14 (Sonoma) corresponds to Darwin 23.x
                        // macOS 13 (Ventura) corresponds to Darwin 22.x
                        // etc.
                        const versionParts = kernelVersion.split('.');
                        const darwinMajor = parseInt(versionParts[0]);
                        
                        // Darwin version to macOS version mapping
                        // Darwin 24+ = macOS 15+
                        isMacOS15Plus = darwinMajor >= 24;
                        const legacyInstruction = document.getElementById('earphone-instruction-legacy');
                        const modernInstruction = document.getElementById('earphone-instruction-modern');

                        if (darwinMajor < 24) {
                            showMacOSVersionAlert();
                            if (legacyInstruction) legacyInstruction.style.display = 'list-item';
                            if (modernInstruction) modernInstruction.style.display = 'none';
                        } else {
                            if (legacyInstruction) legacyInstruction.style.display = 'none';
                            if (modernInstruction) modernInstruction.style.display = 'list-item';
                        }
                    }).catch(() => {
                        // Fallback: show alert for older versions based on user agent
                        isMacOS15Plus = false; // Default to older version behavior on error
                        const legacyInstruction = document.getElementById('earphone-instruction-legacy');
                        const modernInstruction = document.getElementById('earphone-instruction-modern');
                        if (majorVersion < 10 || (majorVersion === 10 && minorVersion < 15)) {
                            showMacOSVersionAlert();
                            if (legacyInstruction) legacyInstruction.style.display = 'list-item';
                            if (modernInstruction) modernInstruction.style.display = 'none';
                        } else {
                            // Assume modern if OS version is high enough by user agent but kernel version failed
                            isMacOS15Plus = true; // Assume modern version
                            if (legacyInstruction) legacyInstruction.style.display = 'none';
                            if (modernInstruction) modernInstruction.style.display = 'list-item';
                        }
                    });
                } else {
                    // Fallback method using user agent
                    isMacOS15Plus = false; // Default to older version behavior when getOSVersion unavailable
                    const legacyInstruction = document.getElementById('earphone-instruction-legacy');
                    const modernInstruction = document.getElementById('earphone-instruction-modern');
                    if (majorVersion < 10 || (majorVersion === 10 && minorVersion < 15)) {
                        showMacOSVersionAlert();
                        if (legacyInstruction) legacyInstruction.style.display = 'list-item';
                        if (modernInstruction) modernInstruction.style.display = 'none';
                    } else {
                         // Assume modern if OS version is high enough by user agent but getOSVersion doesn't exist
                        isMacOS15Plus = true; // Assume modern version
                        if (legacyInstruction) legacyInstruction.style.display = 'none';
                        if (modernInstruction) modernInstruction.style.display = 'list-item';
                    }
                }
            }
        }
    }
    
    function showMacOSVersionAlert() {
        // Create alert modal
        const alertModal = document.createElement('div');
        alertModal.className = 'macos-version-alert';
        alertModal.innerHTML = `
            <div class="alert-content">
                <div class="alert-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <h3>macOS Version Notice</h3>
                <p>For the best experience, we recommend upgrading to macOS 15+ (Sequoia or later).</p>
                <p>Your current version may have limited functionality.</p>
                <div class="alert-buttons">
                    <button class="alert-btn primary" onclick="this.closest('.macos-version-alert').remove()">Got it</button>
                    <button class="alert-btn secondary" onclick="window.electron && window.electron.openExternal('https://support.apple.com/en-us/102662'); this.closest('.macos-version-alert').remove()">Learn More</button>
                </div>
            </div>
        `;
        
        // Add styles for the alert
        const alertStyles = document.createElement('style');
        alertStyles.textContent = `
            .macos-version-alert {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
                backdrop-filter: blur(5px);
            }
            
            .macos-version-alert .alert-content {
                background: #2a2a2a;
                border-radius: 12px;
                padding: 30px;
                max-width: 400px;
                text-align: center;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                border: 1px solid #444;
            }
            
            .macos-version-alert .alert-icon {
                font-size: 48px;
                color: #ff9500;
                margin-bottom: 20px;
            }
            
            .macos-version-alert h3 {
                color: #fff;
                margin: 0 0 15px 0;
                font-size: 20px;
            }
            
            .macos-version-alert p {
                color: #ccc;
                margin: 0 0 10px 0;
                line-height: 1.5;
            }
            
            .macos-version-alert .alert-buttons {
                margin-top: 25px;
                display: flex;
                gap: 10px;
                justify-content: center;
            }
            
            .macos-version-alert .alert-btn {
                padding: 10px 20px;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.2s;
            }
            
            .macos-version-alert .alert-btn.primary {
                background: #007AFF;
                color: white;
            }
            
            .macos-version-alert .alert-btn.primary:hover {
                background: #0056CC;
            }
            
            .macos-version-alert .alert-btn.secondary {
                background: #444;
                color: #ccc;
            }
            
            .macos-version-alert .alert-btn.secondary:hover {
                background: #555;
                color: #fff;
            }
        `;
        
        document.head.appendChild(alertStyles);
        document.body.appendChild(alertModal);
    }
    
    // Check macOS version on startup
    checkMacOSVersion();
    
    // Refresh rate control elements removed
    
    // Auth DOM elements
    const authContainer = document.querySelector('.auth-container');
    const authForm = document.querySelector('.auth-form');
    const closeAuthBtn = document.querySelectorAll('.close-auth');
    const loginButton = document.querySelector('.login-button');
    const authError = document.querySelector('.auth-status');
    
    // Transparency toggle functionality
    const transparencyToggle = document.getElementById('toggle-transparency');
    
    // Check if user has a saved preference for transparency
    const isSolidBg = localStorage.getItem('solidBackground') === 'true';
    if (isSolidBg) {
        document.body.classList.add('solid-bg');
        transparencyToggle.querySelector('span').textContent = 'Solid';
    }
    
    // Add event listener for transparency toggle
    transparencyToggle.addEventListener('click', () => {
        const isCurrentlySolid = document.body.classList.toggle('solid-bg');
        localStorage.setItem('solidBackground', isCurrentlySolid);
        
        // Update button text based on current state
        transparencyToggle.querySelector('span').textContent = 
            isCurrentlySolid ? 'Solid' : 'Transparency';
            
        console.log(`[UI] Background mode changed to: ${isCurrentlySolid ? 'Solid' : 'Transparent'}`);
    });
    
    // Hide auth container by default until we know session status
    authContainer.style.display = 'none';
    
    // Add event listeners for Enter key on login form inputs
    const authInputs = authForm.querySelectorAll('input');
    authInputs.forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          loginButton.click();
        }
      });
    });
    
    // Add event listener for the create account link
    const createAccountLink = document.getElementById('create-account-link');
    if (createAccountLink) {
      createAccountLink.addEventListener('click', (e) => {
        e.preventDefault();
        // Use Electron's shell to open the external URL in the default browser
        window.electron.openExternal('https://interm.ai/');
      });
    }
    
    // Add event listener for the subscription link
    const subscriptionLinkElement = document.getElementById('subscription-link');
    if (subscriptionLinkElement) {
      subscriptionLinkElement.addEventListener('click', (e) => {
        e.preventDefault();
        // Use Electron's shell to open the external URL in the default browser
        window.electron.openExternal('https://interm.ai/');
      });
    }

    // Hide auth container after successful login
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = authForm.querySelector('input[type="email"]').value;
      const password = authForm.querySelector('input[type="password"]').value;
      
      console.log('[AUTH] Login attempt with email:', email);
      authError.textContent = '';
      
      try {
        console.log('[AUTH] Submitting login credentials...');
        await window.auth.completeLogin({
          email,
          password
        });
        console.log('[AUTH] Login request submitted successfully');
      } catch (error) {
        console.error('[AUTH] Login error:', error);
        authError.textContent = error.message;
      }
    });
    
    // Create logout button
    const logoutButton = document.createElement('button');
    logoutButton.className = 'logout-button';
    logoutButton.textContent = 'Logout';
    logoutButton.style.display = 'none'; // Hide by default
    logoutButton.style.marginTop = '5px'; // Add margin to separate from window controls
    logoutButton.style.width = 'auto'; // Make sure it has proper width
    
    // Add logout button under the window controls
    const windowControlsContainer = document.querySelector('.window-controls-container');
    windowControlsContainer.appendChild(logoutButton);
    
    // Add event listener for logout button
    logoutButton.addEventListener('click', async () => {
      try {
        console.log('[AUTH] Logout attempt');
        const result = await window.auth.logout();
        console.log('[AUTH] Logout result:', result);
      } catch (error) {
        console.error('[AUTH] Logout error:', error);
      }
    });
    
    // Listen for auth success
    window.auth.onAuthSuccess((data) => {
      console.log('[AUTH] Authentication successful!', data);
      // Show success message before hiding the container
      authError.textContent = 'Login successful!';
      authError.className = 'auth-success';
      
      // Load saved context from database after successful authentication
      loadSavedContextFromDatabase();
      
      // Hide the auth container after a short delay to show the success message
      setTimeout(() => {
        authContainer.style.display = 'none';
        loginButton.style.display = 'none'; // Hide login button after successful auth
        logoutButton.style.display = 'block'; // Show logout button
        // Reset the message and class after hiding
        setTimeout(() => {
          authError.textContent = '';
          authError.className = 'auth-error';
        }, 500);
      }, 1500);
    });
    
    // Listen for sign out event
    window.auth.onSignOut(() => {
      console.log('[AUTH] Sign out event received');
      // Show login button and hide logout button
      loginButton.style.display = 'block';
      logoutButton.style.display = 'none';
      // Show auth container
      authContainer.style.display = 'block';
    });
    
    // Check if we already have a valid session when the app starts
    window.auth.checkSession().then(hasValidSession => {
      console.log('[AUTH] Initial session check:', hasValidSession);
      if (hasValidSession) {
        // If we have a valid session, keep auth container hidden
        authContainer.style.display = 'none';
        loginButton.style.display = 'none';
        logoutButton.style.display = 'block'; // Show logout button
        
        // Load saved context from database if we have a valid session
        loadSavedContextFromDatabase();
      } else {
        // If no valid session, show auth container
        authContainer.style.display = 'block';
        logoutButton.style.display = 'none'; // Hide logout button
      }
    }).catch(error => {
      console.error('[AUTH] Error checking session:', error);
      // Show auth container if there's an error checking session
      authContainer.style.display = 'block';
    });
    
    // Listen for auth-required event
    window.auth.onAuthRequired((data) => {
      console.log('[AUTH] Auth required event received:', data);
      // Show auth container when auth is required
      authContainer.style.display = 'block';
    });
    
    // Listen for auth errors
    window.auth.onAuthError((data) => {
      console.error('[AUTH] Authentication failed:', data.message);
      authError.textContent = data.message || 'Authentication failed';

      
      // Check if this is a subscription error
      const subscriptionLink = document.querySelector('.subscription-link');
      const createAccountText = document.getElementById('create-account-text');
      
      if (data.isSubscriptionError) {
        // Show the subscription link section
        subscriptionLink.style.display = 'block';
        
        // Hide the create account text for subscription errors
        if (createAccountText) {
          createAccountText.style.display = 'none';
        }
        
        // Update the link URL if provided
        if (data.subscriptionUrl) {
          const linkElement = subscriptionLink.querySelector('a');
          if (linkElement) {
            linkElement.href = data.subscriptionUrl;
          }
        }
        
        // Style the error message in red
          authError.className = 'auth-error';

        
      } else {
        // Hide the subscription link for other errors
        subscriptionLink.style.display = 'none';
        
        // Show the create account text for non-subscription errors
        if (createAccountText) {
          createAccountText.style.display = 'block';
        }
      }
      
      // Make sure the auth container is visible when there's an error
      authContainer.style.display = 'block';
    });
    
    // Listen for plan limit reached event
    window.electron.onPlanLimitReached((data) => {
      console.log('[PLAN] Plan limit reached event received, creating modal:', data);

      // Create modal container
      const planLimitModal = document.createElement('div');
      planLimitModal.className = 'plan-limit-modal';
      
      // Create modal content
      const modalContent = document.createElement('div');
      modalContent.className = 'plan-limit-modal-content';
      
      // Add header with close button
      const modalHeader = document.createElement('div');
      modalHeader.className = 'plan-limit-modal-header';
      modalHeader.innerHTML = `
        <h3>Plan Limit Reached</h3>
        <button class="close-plan-modal">&times;</button>
      `;
      
      // Add message content
      const modalMessage = document.createElement('div');
      modalMessage.className = 'plan-limit-modal-message';
      modalMessage.innerHTML = `
        <p>${data.reason || 'You have reached the limit of your current plan.'}</p>
        <p>To continue using the service, please upgrade your plan.</p>
      `;
      
      // Add upgrade button
      const upgradeButton = document.createElement('button');
      upgradeButton.className = 'plan-upgrade-button';
      upgradeButton.textContent = 'Upgrade Plan';
      upgradeButton.addEventListener('click', () => {
        // Open the upgrade URL in default browser
        window.electron.openExternal('https://interm.ai/');
        // Close the modal after clicking
        if (planLimitModal.parentNode) {
          document.body.removeChild(planLimitModal);
        }
      });
      
      // Assemble modal
      modalContent.appendChild(modalHeader);
      modalContent.appendChild(modalMessage);
      modalContent.appendChild(upgradeButton);
      planLimitModal.appendChild(modalContent);
      
      // Add to body
      document.body.appendChild(planLimitModal);
      
      // Add event listener for close button
      const closeModalBtn = planLimitModal.querySelector('.close-plan-modal');
      if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
          if (planLimitModal.parentNode) {
            document.body.removeChild(planLimitModal);
          }
        });
      }
      console.log('[PLAN] Plan limit modal setup complete and displayed');
    });
    
    // Add event listener for the static upgrade link if it exists
    const staticUpgradeLink = document.getElementById('upgrade-link');
    if (staticUpgradeLink) {
      staticUpgradeLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.electron.openExternal('https://interm.ai/');
      });
    }

    // Login button now shows auth container if hidden
    loginButton.addEventListener('click', () => {
      if (authContainer.style.display === 'none') {
        authContainer.style.display = 'block';
      }
    });
    const conversationArea = document.getElementById('conversation-area');
    const toggleRecordingButton = document.getElementById('toggle-recording');
    const minimizeButton = document.getElementById('minimize');
    const closeButton = document.getElementById('close');

    // Context section elements
    const contextContent = document.getElementById('context-content');
    const contextTextInput = document.getElementById('context-text');
    const setTextContextButton = document.getElementById('set-text-context');
    // const uploadFileButton = document.getElementById('upload-file');
    const fileInput = document.getElementById('file-input');
    
    // Add clear context button to the context title
    const contextTitle = document.querySelector('.context-title');
    const clearContextButton = document.createElement('button');
    clearContextButton.id = 'clear-context';
    clearContextButton.className = 'clear-context';
    clearContextButton.title = 'Hide Context';
    clearContextButton.innerHTML = '<i class="fas fa-times"></i>';
    
    // Add delete context button
    const deleteContextButton = document.createElement('button');
    deleteContextButton.id = 'delete-context';
    deleteContextButton.className = 'delete-context';
    deleteContextButton.title = 'Delete Context';
    deleteContextButton.innerHTML = '<i class="fas fa-trash-alt"></i>';
    
    // Insert the buttons before the toggle button
    const toggleContextButton = document.getElementById('toggle-context');
    if (contextTitle && toggleContextButton) {
      contextTitle.insertBefore(deleteContextButton, toggleContextButton);
      contextTitle.insertBefore(clearContextButton, deleteContextButton);
    }

    // Get the new prominent upload button
    const uploadContextBtn = document.getElementById('upload-context-btn');
    
    // Event listener for the clear context button
    if (clearContextButton) {
        clearContextButton.addEventListener('click', () => {
            // Clear the context content
            contextContent.textContent = 'No context provided yet. Please add your resume, job description, or any relevant information before starting the interview.';
            contextContent.classList.add('empty');
            
            // Hide the entire context area
            const contextArea = document.getElementById('context-area');
            if (contextArea) {
                contextArea.classList.add('hidden');
                
                // Create a button to reopen the context area
                createReopenContextButton();
            }
            
            // Notify the main process that context has been cleared
            window.electron.sendToServer({
                type: 'clear-context'
            });
            

        });
    }
    
    // Event listener for the delete context button
    if (deleteContextButton) {
        deleteContextButton.addEventListener('click', () => {
            // Show confirmation dialog
            const confirmDelete = confirm('Are you sure you want to delete this context? This action cannot be undone.');
            
            if (confirmDelete) {
                // Clear the context content
                contextContent.textContent = 'No context provided yet. Please add your resume, job description, or any relevant information before starting the interview.';
                contextContent.classList.add('empty');
                
                // Notify the main process that context has been deleted
                window.electron.deleteContext();
                
                // Show success notification using the utility function
                showNotification('Context deleted successfully!', 'success');
                

            }
        });
    }
    
    // Function to load saved context from database
    function loadSavedContextFromDatabase() {
      window.electron.loadContext()
        .then(result => {
          if (result.success && result.context !== undefined && result.context !== null) {
            // Make sure the context area is visible
            const contextArea = document.getElementById('context-area');
            if (contextArea && contextArea.classList.contains('hidden')) {
              contextArea.classList.remove('hidden');
            }
            
            // Display the loaded context ONLY in the dedicated div below the upload button
            const savedContextDisplay = document.getElementById('saved-context-display');
            if (savedContextDisplay) {
              savedContextDisplay.textContent = result.context;
            }
            
            // Keep the contextContent completely empty and remove empty state
            if (contextContent) {
              contextContent.textContent = '';
              contextContent.classList.remove('empty');
            } else {
              console.error('[CONTEXT] contextContent element not found');
            }
            
            // Show a notification that context was loaded
            showNotification('Loaded saved context', 'success');
          } else {
            // If the context area exists but there's no context, show empty state
            if (contextContent) {
              contextContent.textContent = 'No context provided yet. Please add your resume, job description, or any relevant information before starting the interview.';
              contextContent.classList.add('empty');
            }
            
            // Clear the saved context display if it exists
            const savedContextDisplay = document.getElementById('saved-context-display');
            if (savedContextDisplay) {
              savedContextDisplay.textContent = '';
            }
          }
        })
        .catch(error => {
          console.error('[CONTEXT] Error loading context:', error);
          
          // Show error notification using the utility function
          showNotification(`Error loading context: ${error.message}`, 'error');
        });
    }
    
    
    // Listen for context saved event
    window.electron.onContextSaved(data => {
      if (data.success) {
        // Show a notification that context was saved using the utility function
        // showNotification('Context saved successfully!', 'success'); // Removed banner
      }
    });
    
    // Listen for context update events from main process
    window.electron.onContextUpdate(data => {
      if (data && data.context) {
        // Make sure the context area is visible
        const contextArea = document.getElementById('context-area');
        if (contextArea && contextArea.classList.contains('hidden')) {
          contextArea.classList.remove('hidden');
        }
        
        // Display the context ONLY in the saved-context-display element
        const savedContextDisplay = document.getElementById('saved-context-display');
        if (savedContextDisplay) {
          savedContextDisplay.textContent = data.context;
        }
        
        // Always ensure contextContent is completely empty
        if (contextContent) {
          contextContent.textContent = '';
          contextContent.classList.remove('empty');
        } else {
          console.error('[CONTEXT] contextContent element not found');
        }
        
        // Remove any processing notifications that might be visible
        const processingNotifications = document.querySelectorAll('.context-processing-notification');
        processingNotifications.forEach(notification => {
          notification.classList.add('fade-out');
          setTimeout(() => {
            if (notification.parentNode) {
              notification.parentNode.removeChild(notification);
            }
          }, 500);
        });
        
        // Show a completion notification that context is ready for use
        showNotification('Context processed successfully! <span class="processing-complete">Ready for interview suggestions</span>', 'success');
      }
    });
    
    // Function to create a button to reopen the context area
    function createReopenContextButton() {
        // Check if the button already exists
        let reopenButton = document.getElementById('reopen-context');
        
        // If the button doesn't exist, create it
        if (!reopenButton) {
            reopenButton = document.createElement('button');
            reopenButton.id = 'reopen-context';
            reopenButton.className = 'reopen-context-button';
            reopenButton.innerHTML = '<i class="fas fa-file-alt"></i> Show Context';
            reopenButton.title = 'Reopen Context Panel';
            
            // Add event listener to reopen the context area
            reopenButton.addEventListener('click', () => {
                const contextArea = document.getElementById('context-area');
                if (contextArea) {
                    contextArea.classList.remove('hidden');
                    // Remove the reopen button when context area is shown
                    reopenButton.remove();
                }
            });
            
            // Add the button to the main section
            const mainSection = document.querySelector('.main-section');
            if (mainSection) {
                mainSection.appendChild(reopenButton);
            }
        }
    }
    
    // We'll handle the upload button functionality in the click handlers below

    // Variable to track selected file
    let selectedFile = null;
    
    // Event listener for the file input change (handle the selected file)
    if (fileInput) {
        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {

                selectedFile = file;
                
                // Don't update contextContent, process the file immediately
                processSelectedFile(selectedFile);
                
                // Update upload button text and style
                if (uploadContextBtn) {
                    uploadContextBtn.innerHTML = '<i class="fas fa-upload"></i> Upload';
                    uploadContextBtn.classList.add('ready-to-upload');
                }
                
                // if (uploadFileButton) {
                //     uploadFileButton.innerHTML = '<i class="fas fa-file-upload"></i> Upload';
                //     uploadFileButton.classList.add('ready-to-upload');
                // }
                
                // Show the context area if it's hidden
                const contextArea = document.getElementById('context-area');
                if (contextArea && contextArea.classList.contains('hidden')) {
                    contextArea.classList.remove('hidden');
                }
                
                // Reset the file input to prevent duplicate file selection prompts
                // but keep the selectedFile variable intact
                event.target.value = '';
            }
        });
    }
    
    
    // Set up the upload buttons with proper handlers
    if (uploadContextBtn) {
        // Create click handler function for the main upload button
        uploadContextBtn.clickHandler = () => {
            if (selectedFile) {
                // Process the selected file
                processSelectedFile(selectedFile);
                // Reset the selected file
                selectedFile = null;
                // Reset button text
                uploadContextBtn.innerHTML = '<i class="fas fa-upload"></i> Upload Resume or Job Description';
                uploadContextBtn.classList.remove('ready-to-upload');
            } else {
                // If no file is selected, trigger the file input
                fileInput.click();
            }
        };
        
        // Add event listener
        uploadContextBtn.addEventListener('click', uploadContextBtn.clickHandler);
    }
    
    // Function to process the selected file
    function processSelectedFile(file) {
        
        // Show processing indicator in a temporary notification instead of contextContent
        const processingNotification = document.createElement('div');
        processingNotification.className = 'context-processing-notification';
        processingNotification.innerHTML = `
            <div class="processing-indicator">
                <i class="fas fa-spinner fa-spin"></i>
                <div>
                    <p><strong>Processing:</strong> ${file.name}</p>
                    <p class="processing-note">The file is being analyzed. A summary will be available shortly.</p>
                </div>
            </div>
        `;
        document.body.appendChild(processingNotification);
        
        // Show the notification with animation
        setTimeout(() => {
            processingNotification.classList.add('show');
        }, 10);
        
        // Keep contextContent empty
        contextContent.textContent = '';
        contextContent.classList.remove('empty');
        
        // Create a temporary file path to send to the main process
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const fileContent = e.target.result;
                const fileName = file.name;
                
                // Create a temporary file and use setContextFile API for unified handling
                const tempFilePath = await window.electron.createTempFile({
                    fileName: fileName,
                    fileContent: Array.from(new Uint8Array(fileContent)),
                    fileType: file.type
                });
                
                // Use the unified setContextFile API
                window.electron.setContextFile(tempFilePath);
                

                
                // Show initial success message (the full summary will be shown by the context-update handler)
                const successNotification = document.createElement('div');
                successNotification.className = 'context-success-notification file-success';
                successNotification.innerHTML = '<i class="fas fa-check-circle"></i> File uploaded successfully! <span class="processing-summary">Generating summary...</span>';
                document.body.appendChild(successNotification);
                
                // Show the notification with animation
                setTimeout(() => {
                    successNotification.classList.add('show');
                }, 10);
                
                // Remove notification after 3 seconds
                setTimeout(() => {
                    successNotification.classList.add('fade-out');
                    setTimeout(() => {
                        document.body.removeChild(successNotification);
                    }, 500);
                }, 3000);
                
                // Reset both upload buttons to their default state
                if (uploadContextBtn) {
                    uploadContextBtn.innerHTML = '<i class="fas fa-upload"></i> Upload Resume or Job Description';
                    uploadContextBtn.classList.remove('ready-to-upload');
                }
                
                // Reset the file input to prevent duplicate file selection prompts
                if (fileInput) {
                    fileInput.value = '';
                }
                
                // Reset the selectedFile variable
                selectedFile = null;
                
            } catch (error) {
                console.error('Error processing file:', error);
                
                // Show error in a notification instead of contextContent
                const errorNotification = document.createElement('div');
                errorNotification.className = 'context-error-notification';
                errorNotification.innerHTML = `<i class="fas fa-exclamation-circle"></i> Error: ${error.message}`;
                document.body.appendChild(errorNotification);
                
                // Show the notification with animation
                setTimeout(() => {
                    errorNotification.classList.add('show');
                }, 10);
                
                // Remove notification after 5 seconds
                setTimeout(() => {
                    errorNotification.classList.add('fade-out');
                    setTimeout(() => {
                        document.body.removeChild(errorNotification);
                    }, 500);
                }, 5000);
                
                // Keep contextContent empty
                contextContent.textContent = '';
                contextContent.classList.remove('empty');
                
                // Reset buttons and input on error too
                if (uploadContextBtn) {
                    uploadContextBtn.innerHTML = '<i class="fas fa-upload"></i> Upload Resume or Job Description';
                    uploadContextBtn.classList.remove('ready-to-upload');
                }
                
                // if (uploadFileButton) {
                //     uploadFileButton.innerHTML = '<i class="fas fa-file-upload"></i> Upload File';
                //     uploadFileButton.classList.remove('ready-to-upload');
                // }
                
                if (fileInput) {
                    fileInput.value = '';
                }
                
                selectedFile = null;
            }
        };
        
        // Start reading the file to trigger the onload event
        reader.readAsArrayBuffer(file);
    }

    // Event listener for setting text context
    if (setTextContextButton && contextTextInput) {
        setTextContextButton.addEventListener('click', () => {
            const text = contextTextInput.value.trim();
            if (text) {

                
                // Show processing indicator in a temporary notification instead of contextContent
                const processingNotification = document.createElement('div');
                processingNotification.className = 'context-processing-notification';
                processingNotification.innerHTML = `
                    <div class="processing-indicator">
                        <i class="fas fa-spinner fa-spin"></i>
                        <div>
                            <p><strong>Processing:</strong> Text input</p>
                            <p class="processing-note">Your text is being analyzed. A summary will be available shortly.</p>
                        </div>
                    </div>
                `;
                document.body.appendChild(processingNotification);
                
                // Show the notification with animation
                setTimeout(() => {
                    processingNotification.classList.add('show');
                }, 10);
                
                // Remove notification after text is processed (will be handled by context-update event)
                // Keep contextContent empty
                contextContent.textContent = '';
                contextContent.classList.remove('empty');
                contextTextInput.value = ''; // Clear the input field
                
                // Send text to server for processing
                window.electron.sendToServer({
                    type: 'process-text-context',
                    data: {
                        text: text
                    }
                });
                
                // Show immediate success notification for text input
                const successNotification = document.createElement('div');
                successNotification.className = 'context-success-notification text-success';
                successNotification.innerHTML = '<i class="fas fa-check-circle"></i> Text context added successfully! <span class="processing-summary">Generating summary...</span>';
                document.body.appendChild(successNotification);
                
                // Show the notification with animation
                setTimeout(() => {
                    successNotification.classList.add('show');
                }, 10);
                
                // Remove notification after 3 seconds
                setTimeout(() => {
                    successNotification.classList.add('fade-out');
                    setTimeout(() => {
                        document.body.removeChild(successNotification);
                    }, 500);
                }, 3000);
                
                // Show the context area if it's hidden
                const contextArea = document.getElementById('context-area');
                if (contextArea && contextArea.classList.contains('hidden')) {
                    contextArea.classList.remove('hidden');
                }
            } else {
                // Optionally provide feedback if the input is empty

            }
        });
    }
    const statusIndicator = document.getElementById('status-indicator');
    const contextArea = document.getElementById('context-area');
    const contextText = document.getElementById('context-text');
    // Removed duplicate declarations for setTextContextButton, uploadFileButton, fileInput
    const container = document.querySelector('.container');
  
  // State variables
  let isRecording = false;
  let typingEffect = null;
  
  // Add CSS for time limit notification
  const style = document.createElement('style');
  style.textContent = `
    .time-limit-notification {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background-color: #f44336;
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      max-width: 80%;
      text-align: center;
      font-weight: bold;
    }
    
    .time-limit-notification.show {
      opacity: 1;
    }
    
    .time-limit-notification.fade-out {
      opacity: 0;
    }
    
    .time-limit-notification i {
      margin-right: 8px;
    }
  `;
  document.head.appendChild(style);
  
  // Initialize the UI
  function initializeUI() {
    // Initialize context area
    if (contextContent.textContent.trim() === 'No context provided yet.' || 
        contextContent.textContent.includes('No context provided yet')) {
      contextContent.classList.add('empty');
    }
    
    // Check if context area is hidden and create reopen button if needed
    const contextArea = document.getElementById('context-area');
    if (contextArea && contextArea.classList.contains('hidden')) {
      createReopenContextButton();
    }
    
    // Add a welcome message with typing effect
    const welcomePrefix = '';
    const typingTexts = [
      'Provide me hints in job interview',
      'Provide me hints in sales meeting',
      'Provide me hints in podcast recording'
    ];
    
    // Add initial welcome message
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message welcome-message';
    
    const welcomeSpan = document.createElement('span');
    welcomeSpan.textContent = welcomePrefix;
    welcomeSpan.style.textAlign = 'left';
    welcomeSpan.style.alignSelf = 'flex-start';
    
    const typingSpan = document.createElement('span');
    typingSpan.id = 'typing-text';
    typingSpan.style.textAlign = 'left';
    typingSpan.style.alignSelf = 'flex-start';
    
    messageDiv.appendChild(welcomeSpan);
    messageDiv.appendChild(typingSpan);
  //   messageDiv.appendChild(recordingSpan);
    
    conversationArea.appendChild(messageDiv);
    
    // Start the typing effect
    startTypingEffect(typingTexts, typingSpan);
  }
  
  // Function to create typing effect
  function startTypingEffect(texts, element) {
    let textIndex = 0;
    let charIndex = 0;
    let isDeleting = false;
    let typingDelay = 100; // Delay between each character typing
    let deletingDelay = 50; // Faster when deleting
    let pauseDelay = 1000; // Pause when text is fully typed
    
    function type() {
      const currentText = texts[textIndex];
      
      if (isDeleting) {
        // Deleting text
        element.textContent = currentText.substring(0, charIndex - 1);
        charIndex--;
        typingDelay = deletingDelay;
        
        if (charIndex === 0) {
          isDeleting = false;
          textIndex = (textIndex + 1) % texts.length;
          typingDelay = 100;
        }
      } else {
        // Typing text
        element.textContent = currentText.substring(0, charIndex + 1);
        charIndex++;
        
        if (charIndex === currentText.length) {
          isDeleting = true;
          typingDelay = pauseDelay; // Pause before deleting
        }
      }
      
      typingEffect = setTimeout(type, typingDelay);
    }
    
    // Start the typing effect
    type();
  }
  
  // Handle recording status updates
  window.electron.onRecordingStatus((data) => {
    isRecording = data.isRecording;
    updateRecordingUI();
  });
  
  // Handle time limit reached notification
  window.electron.onTimeLimitReached((data) => {
    isRecording = false;
    updateRecordingUI();
    
    // Display a notification to the user
    const notification = document.createElement('div');
    notification.className = 'time-limit-notification';
    notification.innerHTML = `<i class="fas fa-clock"></i> ${data.message}`;
    document.body.appendChild(notification);
    
    // Show the notification with animation
    setTimeout(() => {
      if (notification && notification.classList) {
        notification.classList.add('show');
      }
    }, 10);
    
    // Remove notification after 10 seconds
    setTimeout(() => {
      if (notification && notification.classList) {
        notification.classList.add('fade-out');
        setTimeout(() => {
          if (notification && notification.parentNode) {
            document.body.removeChild(notification);
          }
        }, 500);
      }
    }, 10000);
  });
  
  // Handle plan limit reached notification
  window.electron.onPlanLimitReached((data) => {
    console.log('[PLAN] Plan limit reached event received:', data);
    
    // Update recording state
    isRecording = false;
    updateRecordingUI();
    console.log('[PLAN] Recording UI updated');
    
    // Display a red notification to the user
    const notification = document.createElement('div');
    notification.className = 'time-limit-notification';
    notification.style.backgroundColor = '#f44336'; // Ensure it's red
    notification.innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${data.reason || 'You\'ve used all your interviews for this plan.'}`;
    console.log('[PLAN] Notification element created with class:', notification.className);
    document.body.appendChild(notification);
    
    // Show the notification with animation
    setTimeout(() => {
      if (notification && notification.classList) {
        notification.classList.add('show');
      }
    }, 10);
    
    // Keep the notification visible longer (10 seconds) since it's an important plan limit message
    setTimeout(() => {
      if (notification && notification.classList) {
        notification.classList.add('fade-out');
        setTimeout(() => {
          if (notification && notification.parentNode) {
            document.body.removeChild(notification);
          }
        }, 500);
      }
    }, 10000);
  });
  
  // Handle ready event
  window.electron.onReady((data) => {
    console.log('[DEBUG] App ready:', data);
    updateRecordingUI();
  });
  
  // Handle context updates
  window.electron.onContextUpdate((data) => {
    
    // Process the context update data
    const contextData = {
      hasMessage: !!data.message,
      hasSummary: !!data.summary,
      summaryLength: data.summary ? data.summary.length : 0,
      isFile: !!data.isFile
    };
    

    
    // Remove any processing notifications that might be visible
    const processingNotifications = document.querySelectorAll('.context-processing-notification');
    processingNotifications.forEach(notification => {
      notification.classList.add('fade-out');
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 500);
    });
    
    // Clear existing content
    contextContent.innerHTML = '';
    contextContent.classList.remove('empty');
    
    // Create a container for the context information
    const contextContainer = document.createElement('div');
    contextContainer.className = 'context-container';
    
    // Add file/text information if available
    if (data.message) {
      const contextInfoDiv = document.createElement('div');
      contextInfoDiv.className = 'context-info';
      contextInfoDiv.innerHTML = `<i class="fas fa-file"></i> ${data.message}`;
      contextContainer.appendChild(contextInfoDiv);

    }
    
    // Add summary if available
    if (data.summary) {

      const summaryDiv = document.createElement('div');
      summaryDiv.className = 'context-summary';
      
      const summaryTitle = document.createElement('div');
      summaryTitle.className = 'summary-title';
      summaryTitle.innerHTML = '<i class="fas fa-file-alt"></i> <strong>Backend Analysis:</strong>';
      summaryDiv.appendChild(summaryTitle);
      
      // Show a completion notification that context is ready for use
      const completionNotification = document.createElement('div');
      completionNotification.className = 'context-success-notification';
      completionNotification.innerHTML = '<i class="fas fa-check-circle"></i> Context processed successfully! <span class="processing-complete">Ready for interview suggestions</span>';
      document.body.appendChild(completionNotification);
      
      // Show the notification with animation
      setTimeout(() => {
          completionNotification.classList.add('show');
      }, 10);
      
      // Remove notification after 4 seconds
      setTimeout(() => {
          completionNotification.classList.add('fade-out');
          setTimeout(() => {
              if (completionNotification.parentNode) {
                  completionNotification.parentNode.removeChild(completionNotification);
              }
          }, 500);
      }, 4000);
      
      const summaryContent = document.createElement('div');
      summaryContent.className = 'summary-content';
      
      // Format the summary with better styling if it contains multiple lines
      const formattedSummary = data.summary.split('\n').map(line => {
        // Check if line is a bullet point
        if (line.trim().startsWith('-') || line.trim().startsWith('•')) {
          return `<li>${line.trim().substring(1).trim()}</li>`;
        }
        // Check if line is a heading (starts with # or ##)
        else if (line.trim().startsWith('#')) {
          const headingLevel = line.trim().split(' ')[0].length;
          const headingText = line.trim().substring(headingLevel).trim();
          return `<h${Math.min(headingLevel, 4)} class="summary-heading">${headingText}</h${Math.min(headingLevel, 4)}>`;
        }
        // Regular paragraph
        else if (line.trim()) {
          return `<p>${line.trim()}</p>`;
        }
        return '';
      }).join('');
      
      // If we detected bullet points, wrap them in a ul
      const processedSummary = formattedSummary.includes('<li>') ? 
        `<ul class="summary-list">${formattedSummary}</ul>` : formattedSummary;
      
      summaryContent.innerHTML = processedSummary || data.summary;
      summaryDiv.appendChild(summaryContent);
      
      contextContainer.appendChild(summaryDiv);
      
      // Show success notification with appropriate styling based on context type
      const successNotification = document.createElement('div');
      successNotification.className = 'context-success-notification';
      
      // Add specific class based on whether it's a file or text
      if (data.isFile) {
        successNotification.classList.add('file-success');
        successNotification.innerHTML = '<i class="fas fa-file-upload"></i> File processed successfully! <span class="summary-available">Summary available</span>';
      } else {
        successNotification.classList.add('text-success');
        successNotification.innerHTML = '<i class="fas fa-check-circle"></i> Text context added successfully! <span class="summary-available">Summary available</span>';
      }
      
      document.body.appendChild(successNotification);
      
      // Show the notification with animation
      setTimeout(() => {
        successNotification.classList.add('show');
      }, 10);
      
      // Remove notification after 3 seconds
      setTimeout(() => {
        successNotification.classList.add('fade-out');
        setTimeout(() => {
          if (document.body.contains(successNotification)) {
            document.body.removeChild(successNotification);
          }
        }, 500);
      }, 3000);
      
      // Show the context area if it's hidden
      const contextArea = document.getElementById('context-area');
      if (contextArea && contextArea.classList.contains('hidden')) {
        contextArea.classList.remove('hidden');
      }
      
      // Display a success notification about the summary
      const summaryNotification = document.createElement('div');
      summaryNotification.className = 'context-success-notification general-success'; // Added a general class for styling
      summaryNotification.innerHTML = '<i class="fas fa-check-circle"></i> A summary has been generated and is available in the context panel.';
      
      document.body.appendChild(summaryNotification);
      
      // Show the notification with animation
      setTimeout(() => {
        summaryNotification.classList.add('show');
      }, 10);
      
      // Remove notification after 3 seconds
      setTimeout(() => {
        summaryNotification.classList.add('fade-out');
        setTimeout(() => {
          if (document.body.contains(summaryNotification)) {
            document.body.removeChild(summaryNotification);
          }
        }, 500);
      }, 3000);
    } else {
      // If no summary is available, show a basic success notification
      const successNotification = document.createElement('div');
      successNotification.className = 'context-success-notification';
      
      if (data.isFile) {
        successNotification.classList.add('file-success');
        successNotification.innerHTML = '<i class="fas fa-file-upload"></i> File uploaded successfully!';
      } else {
        successNotification.classList.add('text-success');
        successNotification.innerHTML = '<i class="fas fa-check-circle"></i> Text context added successfully!';
      }
      
      document.body.appendChild(successNotification);
      
      // Show the notification with animation
      setTimeout(() => {
        successNotification.classList.add('show');
      }, 10);
      
      // Remove notification after 3 seconds
      setTimeout(() => {
        successNotification.classList.add('fade-out');
        setTimeout(() => {
          if (document.body.contains(successNotification)) {
            document.body.removeChild(successNotification);
          }
        }, 500);
      }, 3000);
      
      // Message removed as per user request to not show 'Context successfully updated'
    }
    
    // Add the container to the context content area
    contextContent.appendChild(contextContainer);
  });
  
  // Handle errors
  window.electron.onError((data) => {
    console.error('[ERROR]', data.message);
    addAIMessage(`Error: ${data.message}`);
  });
  
  // Handle incoming transcript data
  window.electron.onTranscript((data) => {
    console.log('[DEBUG] Received transcript:', data);
    if (data.text && data.text.trim()) {
      // Handle based on source
      if (data.source === 'systemAudio') {
        // System audio goes to interview question box (interviewer)
        updateInterviewerQuestionBox(data.text, false);
      } else if (data.source === 'microphone') {
        // Microphone audio goes to transcript section (me)
        addTranscriptMessage(data.text, data.speakerInfo, false);
      } else {
        // Fallback for backward compatibility
        addTranscriptMessage(data.text, data.speakerInfo, true);
        
        // Also display in interviewer question box if we don't have speaker info yet
        if (!data.speakerInfo || !data.speakerInfo.hasSpeakerInfo) {
          updateInterviewerQuestionBox(data.text, true);
        }
      }
      
      // Don't automatically generate AI suggestions - wait for Answer button click
    }
  });

  // Handle incoming interim transcript data for real-time display
  window.electron.onInterimTranscript((data) => {
    console.log('[DEBUG] Received interim transcript:', data);
    if (data.text && data.text.trim()) {
      // Handle based on source - similar to regular transcript but mark as preliminary
      if (data.source === 'systemAudio') {
        // System audio goes to interview question box (interviewer)
        updateInterviewerQuestionBox(data.text, true); // Mark as preliminary
      } else if (data.source === 'microphone') {
        // Microphone audio goes to transcript section (me)
        addTranscriptMessage(data.text, data.speakerInfo, true); // Mark as preliminary
      } else {
        // Fallback for backward compatibility
        addTranscriptMessage(data.text, data.speakerInfo, true);
        
        // Also display in interviewer question box if we don't have speaker info yet
        if (!data.speakerInfo || !data.speakerInfo.hasSpeakerInfo) {
          updateInterviewerQuestionBox(data.text, true);
        }
      }
    }
  });
  
  // Track transcript messages by speaker ID
  const transcriptMessagesBySpeaker = {};
  let lastTranscriptId = 0;
  
  // Store previous transcript text to prevent duplicates
  const previousTranscripts = {};
  
  // Store the latest interviewer question for display above AI suggestions
  let latestInterviewerQuestion = '';
  
  // Track the current interviewer question element for streaming updates
  let currentInterviewerQuestionElement = null;
  
  // Add a transcript message to the transcript section
  // Added isPreliminary parameter to handle immediate display before speaker detection
  function addTranscriptMessage(text, speakerInfo, isPreliminary = false) {
    let messageDiv;
    let isNewMessage = false;
    const currentScrollPos = transcriptContent.scrollTop;
    const isAtBottom = transcriptContent.scrollHeight - transcriptContent.clientHeight <= transcriptContent.scrollTop + 5;
    const isMidView = !isAtBottom && currentScrollPos > 0;
    
    // Handle messages with speaker information
    if (speakerInfo && speakerInfo.hasSpeakerInfo && speakerInfo.segments && Array.isArray(speakerInfo.segments)) {
      // Process each speaker segment
      speakerInfo.segments.forEach(segment => {
        const speakerId = segment.speakerId;
        
        // Initialize previous transcript for this speaker if it doesn't exist
        if (!previousTranscripts[speakerId]) {
          previousTranscripts[speakerId] = '';
        }
        
        // Check if the new text is different from the previous one to avoid repetition
        // Only update if the new text is different or contains new content
        const newText = segment.text;
        const prevText = previousTranscripts[speakerId];
        
        // Enhanced question detection for better interviewer identification
        // Check if this is an interviewer segment or contains a question pattern
        if (segment.role === 'interviewer' || segment.role === 'INTERVIEWER' || isLikelyQuestion(newText)) {
          // If it's marked as me/INTERVIEWEE but contains a question, it might be misclassified
          if ((segment.role === 'me' || segment.role === 'INTERVIEWEE') && isLikelyQuestion(newText)) {
            console.log('[DEBUG] Detected question pattern in me/INTERVIEWEE text, treating as interviewer');
            // Override the role for display purposes
            segment.role = 'interviewer';
          }
          
          latestInterviewerQuestion = newText;
          console.log('[DEBUG] Updated latest interviewer question:', latestInterviewerQuestion);
          
          // Update the interviewer question box with streaming effect if it exists
          updateInterviewerQuestionBox(newText);
        } else if (segment.role === 'me' || segment.role === 'INTERVIEWEE') {
          // If this is an interviewee segment and the current question matches this text,
          // it means we previously displayed it as an interviewer question before role detection
          // We should clear it to avoid showing interviewee speech as questions
          if (currentInterviewerQuestionElement && 
              currentInterviewerQuestionElement.textContent === newText) {
            
            // Version-specific clearing logic
            let shouldClear = false;
            
            if (isMacOS15Plus) {
              // For macOS 15+: only clear system audio if AI answer exists
              if (data.source === 'systemAudio') {
                shouldClear = hasAIAnswerGenerated;
                console.log(`[DEBUG] macOS 15+ system audio clearing: hasAIAnswerGenerated=${hasAIAnswerGenerated}`);
              } else {
                // For microphone input on macOS 15+, always clear (same as before)
                shouldClear = true;
              }
            } else {
              // For older macOS versions using SoX: keep previous clearing logic (always clear)
              shouldClear = true;
              console.log('[DEBUG] macOS <15 using SoX: applying previous clearing logic');
            }
            
            if (shouldClear) {
              console.log('[DEBUG] Clearing incorrectly displayed interviewee text from question box');
              currentInterviewerQuestionElement.textContent = '';
              latestInterviewerQuestion = '';
            } else {
              console.log('[DEBUG] Preserving system audio text - no AI answer generated yet');
            }
          }
        }
        
        // Check if we already have a message for this speaker
        if (transcriptMessagesBySpeaker[speakerId]) {
          // Update existing message
          messageDiv = transcriptMessagesBySpeaker[speakerId];
          const speakerSection = messageDiv.querySelector(`.speaker-section[data-speaker-id="${speakerId}"]`);
          
          if (speakerSection) {
            // Update existing speaker section only if text has changed
            const speakerText = speakerSection.querySelector('span:last-child');
            // Only update if the new text is different or contains new content
            if (newText !== prevText) {
              speakerText.textContent = newText;
              previousTranscripts[speakerId] = newText;
              
              // Update latest interviewer question if this is an interviewer
              if (segment.role === 'interviewer' || segment.role === 'INTERVIEWER') {
                latestInterviewerQuestion = newText;
                console.log('[DEBUG] Updated latest interviewer question:', latestInterviewerQuestion);
              }
            }
          } else {
            // Create new speaker section for this speaker
            const newSpeakerSection = createSpeakerSection(speakerId, newText, segment.role);
            messageDiv.appendChild(newSpeakerSection);
            previousTranscripts[speakerId] = newText;
          }
        } else {
          // Create new message for this speaker
          messageDiv = document.createElement('div');
          messageDiv.className = 'message human-message';
          messageDiv.setAttribute('data-transcript-id', lastTranscriptId++);
          
          // Add the 'recent-message' class to highlight it
          messageDiv.classList.add('recent-message');
          
          // Check if we need to replace a preliminary message
          const defaultSpeakerId = 'default';
          const preliminaryMessage = transcriptMessagesBySpeaker[defaultSpeakerId];
          
          if (preliminaryMessage && isPreliminary === false) {
            // We have a confirmed speaker for what was previously a preliminary message
            // Replace the preliminary message with this one
            const preliminaryText = preliminaryMessage.querySelector('span:last-child')?.textContent;
            
            // Only replace if the text is similar (to avoid replacing unrelated messages)
            if (preliminaryText && segment.text.includes(preliminaryText) || preliminaryText.includes(segment.text)) {
              // Create the proper speaker section
              const speakerSection = createSpeakerSection(speakerId, segment.text, segment.role);
              
              // Replace the content of the preliminary message
              preliminaryMessage.innerHTML = '';
              preliminaryMessage.appendChild(speakerSection);
              
              // Update our references
              messageDiv = preliminaryMessage;
              delete transcriptMessagesBySpeaker[defaultSpeakerId];
              transcriptMessagesBySpeaker[speakerId] = messageDiv;
              previousTranscripts[speakerId] = segment.text;
            } else {
              // Create a new speaker section
              const speakerSection = createSpeakerSection(speakerId, segment.text, segment.role);
              messageDiv.appendChild(speakerSection);
              
              // Add to transcript section
              transcriptContent.appendChild(messageDiv);
              
              // Store reference to this speaker's message
              transcriptMessagesBySpeaker[speakerId] = messageDiv;
              previousTranscripts[speakerId] = segment.text;
              isNewMessage = true;
            }
          } else {
            // Create a new speaker section
            const speakerSection = createSpeakerSection(speakerId, segment.text, segment.role);
            messageDiv.appendChild(speakerSection);
            
            // Add to transcript section
            transcriptContent.appendChild(messageDiv);
            
            // Store reference to this speaker's message
            transcriptMessagesBySpeaker[speakerId] = messageDiv;
            previousTranscripts[speakerId] = segment.text;
            isNewMessage = true;
          }
        }
      });
    } else {
      // Simple text without speaker information
      // Use a default speaker ID for non-speaker messages
      const defaultSpeakerId = 'default';
      
      // Initialize previous transcript for default speaker if it doesn't exist
      if (!previousTranscripts[defaultSpeakerId]) {
        previousTranscripts[defaultSpeakerId] = '';
      }
      
      // Check if the new text is different from the previous one to avoid repetition
      const prevText = previousTranscripts[defaultSpeakerId];
      
      if (transcriptMessagesBySpeaker[defaultSpeakerId]) {
        // Update existing message
        messageDiv = transcriptMessagesBySpeaker[defaultSpeakerId];
        
        // Check if we have a speaker section or just a plain div
        let messageText = messageDiv.querySelector('.speaker-section span:last-child');
        if (!messageText) {
          messageText = messageDiv.querySelector('div');
        }
        
        // Only update if the text has changed to avoid repetition
        if (text !== prevText) {
          if (messageText) {
            messageText.textContent = text;
          } else {
            // If we have speaker info now but didn't before, create a proper speaker section
            if (isPreliminary) {
              const isMacOS15Plus = window.isMacOS15Plus;
              const isUserSpeaking = speakerInfo && speakerInfo.segments && 
                                    speakerInfo.segments.some(segment => segment.role === 'me');

              if (isMacOS15Plus && isUserSpeaking) {
                let meSection = messageDiv.querySelector('.speaker-section[data-role="me"]');
                if (meSection) {
                  const meTextSpan = meSection.querySelector('span:last-child');
                  if (meTextSpan) {
                    meTextSpan.textContent = text;
                  }
                } else {
                  // Create and append the 'Me:' section, clear existing content of messageDiv first
                  messageDiv.innerHTML = ''; 
                  const tempSpeakerSection = document.createElement('div');
                  tempSpeakerSection.className = 'speaker-section';
                  tempSpeakerSection.setAttribute('data-speaker-id', defaultSpeakerId); // Or a specific 'me' ID
                  tempSpeakerSection.setAttribute('data-role', 'me');
                  
                  const speakerLabel = document.createElement('span');
                  speakerLabel.className = 'speaker-label';
                  speakerLabel.textContent = 'Me:';
                  
                  const textSpan = document.createElement('span');
                  textSpan.textContent = text;
                  
                  tempSpeakerSection.appendChild(speakerLabel);
                  tempSpeakerSection.appendChild(textSpan);
                  messageDiv.appendChild(tempSpeakerSection);
                }
              } else {
                // Original logic for "Processing..." or other preliminary default messages
                const tempSpeakerSection = document.createElement('div');
                tempSpeakerSection.className = 'speaker-section';
                tempSpeakerSection.setAttribute('data-speaker-id', defaultSpeakerId);
                
                const speakerLabel = document.createElement('span');
                speakerLabel.className = 'speaker-label';
                speakerLabel.textContent = 'Processing...';
                speakerLabel.style.fontStyle = 'italic';
                speakerLabel.style.opacity = '0.8';
                
                const textSpan = document.createElement('span');
                textSpan.textContent = text;
                
                tempSpeakerSection.appendChild(speakerLabel);
                tempSpeakerSection.appendChild(textSpan);
                messageDiv.appendChild(tempSpeakerSection);
              }
            } else {
              // Just create a simple text div for non-preliminary updates
              const newMessageText = document.createElement('div');
              newMessageText.textContent = text;
              messageDiv.appendChild(newMessageText);
            }
          }
          previousTranscripts[defaultSpeakerId] = text;
        }
      } else {
        // Create new message
        messageDiv = document.createElement('div');
        messageDiv.className = 'message human-message';
        messageDiv.setAttribute('data-transcript-id', lastTranscriptId++);
        
        // Add the 'recent-message' class to highlight it
        messageDiv.classList.add('recent-message');
        
        if (isPreliminary) {
          const isMacOS15Plus = window.isMacOS15Plus;
          const isUserSpeaking = speakerInfo && speakerInfo.segments && 
                                speakerInfo.segments.some(segment => segment.role === 'me');

          if (isMacOS15Plus && isUserSpeaking) {
            // Since messageDiv is new, no need to search for existing 'Me' section, just create and append.
            const tempSpeakerSection = document.createElement('div');
            tempSpeakerSection.className = 'speaker-section';
            tempSpeakerSection.setAttribute('data-speaker-id', defaultSpeakerId); // Or a specific 'me' ID
            tempSpeakerSection.setAttribute('data-role', 'me');
            
            const speakerLabel = document.createElement('span');
            speakerLabel.className = 'speaker-label';
            speakerLabel.textContent = 'Me:';
            
            const textSpan = document.createElement('span');
            textSpan.textContent = text;
            
            tempSpeakerSection.appendChild(speakerLabel);
            tempSpeakerSection.appendChild(textSpan);
            messageDiv.appendChild(tempSpeakerSection);
          } else {
            // Original logic for "Processing..." or other preliminary default messages when messageDiv is new
            const tempSpeakerSection = document.createElement('div');
            tempSpeakerSection.className = 'speaker-section';
            tempSpeakerSection.setAttribute('data-speaker-id', defaultSpeakerId);
            
            const speakerLabel = document.createElement('span');
            speakerLabel.className = 'speaker-label';
            speakerLabel.textContent = 'Processing...';
            speakerLabel.style.fontStyle = 'italic';
            speakerLabel.style.opacity = '0.8';
            
            const textSpan = document.createElement('span');
            textSpan.textContent = text;
            
            tempSpeakerSection.appendChild(speakerLabel);
            tempSpeakerSection.appendChild(textSpan);
            messageDiv.appendChild(tempSpeakerSection);
          }
        } else {
          // Just create a simple text div for non-preliminary updates
          const messageText = document.createElement('div');
          messageText.textContent = text;
          messageDiv.appendChild(messageText);
        }
        
        // Add to transcript section
        transcriptContent.appendChild(messageDiv);
        
        // Store reference and update previous text
        transcriptMessagesBySpeaker[defaultSpeakerId] = messageDiv;
        previousTranscripts[defaultSpeakerId] = text;
        isNewMessage = true;
      }
    }
    
    // Enhanced scroll behavior:
    // 1. If user is at bottom or this is a new message, scroll to bottom
    // 2. If user has manually scrolled up (mid-view), maintain their position
    // 3. If this is a significant update, center the latest message
    
    if (isAtBottom || isNewMessage) {
      // Auto-scroll to bottom for new messages or when already at bottom
      transcriptContent.scrollTop = transcriptContent.scrollHeight;
    } else if (isMidView) {
      // User has manually scrolled up, maintain their position
      transcriptContent.scrollTop = currentScrollPos;
    } else {
      // Center the most recent transcript
      if (messageDiv) {
        // Calculate position to center the message
        const messageRect = messageDiv.getBoundingClientRect();
        const containerRect = transcriptContent.getBoundingClientRect();
        const centerPosition = messageDiv.offsetTop - (containerRect.height / 2) + (messageRect.height / 2);
        
        // Smooth scroll to center the message
        transcriptContent.scrollTo({
          top: centerPosition,
          behavior: 'smooth'
        });
      }
    }
    
    // Add a highlight effect to the most recent message
    if (messageDiv) {
      // Remove highlight from all messages
      document.querySelectorAll('.transcript-content .message').forEach(msg => {
        msg.classList.remove('recent-message');
      });
      
      // Add highlight to current message
      messageDiv.classList.add('recent-message');
    }
  }
  
  // Helper function to detect if text is likely a question (client-side detection)
  function isLikelyQuestion(text) {
    // Check for question marks
    if (text.includes('?')) return true;
    
    // Check for common interrogative words/phrases at the beginning of the text
    const interrogativePatterns = [
      /^(what|who|where|when|why|how|which|could you|can you|would you|will you|do you|are you|is there|have you|tell me)/i,
      /^(explain|describe|elaborate on|discuss|share|talk about)/i,
      /^(let's talk about|i'd like to know|i'm interested in|i'd like to ask)/i
    ];
    
    // Check if text starts with interrogative patterns
    for (const pattern of interrogativePatterns) {
      if (pattern.test(text.trim())) return true;
    }
    
    return false;
  }
  
  // Helper function to create a speaker section with raw speaker labels
  function createSpeakerSection(speakerId, text, role) {
    const speakerSection = document.createElement('div');
    speakerSection.className = 'speaker-section';
    speakerSection.setAttribute('data-speaker-id', speakerId);
    
    const speakerLabel = document.createElement('span');
    speakerLabel.className = 'speaker-label';
    
    // Handle the new role system with 'me' and 'interviewer'
    if (role === 'me') {
      speakerLabel.textContent = 'Me:';
      speakerSection.setAttribute('data-role', 'me');
    } else if (role === 'interviewer') {
      speakerLabel.textContent = 'Interviewer:';
      speakerSection.setAttribute('data-role', 'interviewer');
    } else if (role && role.startsWith('Speaker ')) {
      // Fallback for old speaker format - handle Speaker 0 as Me
      if (role === 'Speaker 0') {
        speakerLabel.textContent = 'Me:';
        speakerSection.setAttribute('data-role', 'me');
      } else {
        speakerLabel.textContent = `${role}:`;
        speakerSection.setAttribute('data-role', role);
      }
    } else {
      // Generic fallback - handle speakerId 0 as Me
      if (speakerId === '0' || speakerId === 0) {
        speakerLabel.textContent = 'Me:';
        speakerSection.setAttribute('data-role', 'me');
      } else {
        speakerLabel.textContent = `Speaker ${speakerId}:`;
        speakerSection.setAttribute('data-role', `Speaker ${speakerId}`);
      }
    }
    
    const speakerText = document.createElement('span');
    speakerText.textContent = text;
    
    speakerSection.appendChild(speakerLabel);
    speakerSection.appendChild(speakerText);
    
    return speakerSection;
  }
  
  // Add a human message with speaker information
  function addHumanMessageWithSpeakers(text, speakerInfo) {
    // Function is now empty to prevent displaying human messages
    console.log('[DEBUG] Human message with speakers suppressed:', text);
    // No UI updates - human messages are not displayed
  }
  
  // Add a human message to the conversation
  function addHumanMessage(text) {
    // Function is now empty to prevent displaying human messages
    console.log('[DEBUG] Human message suppressed:', text);
    // No UI updates - human messages are not displayed
  }
  
  // Handle incoming suggestion data
  window.electron.onSuggestion((data) => {
    console.log('[DEBUG] Received suggestion:', data);
    if (data.text && data.text.trim()) {
      // Check if this is a code solution from screenshot processing
      // Look for code blocks with triple backticks
      const text = data.text;
      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
      const hasCodeBlock = codeBlockRegex.test(text);
      
      // Reset regex state
      codeBlockRegex.lastIndex = 0;
      
      // If there's a code block and it's not at the beginning, prioritize it
      if (hasCodeBlock) {
        let match;
        let firstCodeBlockIndex = -1;
        
        // Find the position of the first code block
        while ((match = codeBlockRegex.exec(text)) !== null) {
          firstCodeBlockIndex = match.index;
          break; // Only need the first match
        }
        
        if (firstCodeBlockIndex > 0) {
          // There's text before the code block, check if it's from screenshot processing
          const textBeforeCode = text.substring(0, firstCodeBlockIndex).trim();
          const isScreenshotResponse = textBeforeCode.includes('analyze') || 
                                      textBeforeCode.includes('code') || 
                                      textBeforeCode.includes('error') || 
                                      textBeforeCode.includes('bug');
          
          if (isScreenshotResponse) {
            // Extract all code blocks
            const codeBlocks = [];
            codeBlockRegex.lastIndex = 0; // Reset regex state
            
            while ((match = codeBlockRegex.exec(text)) !== null) {
              const language = match[1] || 'plaintext';
              const code = match[2];
              codeBlocks.push(`\`\`\`${language}\n${code}\`\`\``);
            }
            
            // Join code blocks with minimal explanation between them if there are multiple
            const modifiedText = codeBlocks.join('\n\n');
            
            // Use the modified text instead
            addAIMessage(modifiedText);
            return;
          }
        }
      }
      
      // For regular messages or code blocks already at the beginning
      addAIMessage(data.text);
    }
  });
  
  // Handle streaming suggestion chunks
  let currentStreamingMessage = null;
  let streamingMessageContent = '';
  
  // Refresh control variables
  let lastRefreshTime = 0;
  let pendingChunks = [];
  let refreshPaused = false;
  
  // Batching variables for accumulating larger chunks
  let minChunkSize = 5000; // Minimum characters before processing (configurable)
let maxWaitTime = 30000; // Maximum time to wait before processing chunks (ms)
 const refreshRateDelay = 250; // Minimum delay between UI refreshes (ms)
  let accumulatedChunkSize = 0; // Track total size of accumulated chunks
  let firstChunkTime = 0; // Track when we received the first chunk in a batch
  
  window.electron.onSuggestionChunk((data) => {
    console.log('[DEBUG] Received suggestion chunk:', data);
    if (data.text) {
      // Add the chunk to pending chunks
      pendingChunks.push(data);
      
      // Track accumulated chunk size
      accumulatedChunkSize += data.text.length;
      
      // Record time of first chunk in a batch if this is the first one
      if (pendingChunks.length === 1) {
        firstChunkTime = Date.now();
      }
      
      // Process chunks based on batching and refresh rate settings
      processChunks();
    }
  });
  
  // Process pending chunks based on batching and refresh rate settings
  function processChunks() {
    // If paused, don't process chunks
    if (refreshPaused && !pendingChunks.some(chunk => chunk.isFinal)) {
      // Add notification indicator if there are pending chunks
      if (pendingChunks.length > 0 && currentStreamingMessage) {
        const notificationIndicator = document.getElementById('refresh-notification');
        if (!notificationIndicator) {
          const indicator = document.createElement('div');
          indicator.id = 'refresh-notification';
          indicator.className = 'refresh-notification';
          indicator.innerHTML = `<i class="fas fa-bell"></i> ${pendingChunks.length} new AI updates`;
          indicator.addEventListener('click', () => {
            refreshPaused = false;
            processChunks();
            // Refresh pause button code removed
            indicator.remove();
          });
          currentStreamingMessage.appendChild(indicator);
        } else {
          notificationIndicator.innerHTML = `<i class="fas fa-bell"></i> ${pendingChunks.length} new AI updates`;
        }
      }
      return;
    }
    
    // Add a visual indicator to show when new content is coming
    if (pendingChunks.length > 0 && currentStreamingMessage) {
      // Check if a processing indicator already exists
      let processingIndicator = currentStreamingMessage.querySelector('.processing-indicator');
      
      // Only create a new indicator if one doesn't already exist
      if (!processingIndicator) {
        processingIndicator = document.createElement('div');
        processingIndicator.className = 'processing-indicator';
        processingIndicator.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> Processing new content...`;
        currentStreamingMessage.appendChild(processingIndicator);
        
        // Remove the indicator after processing is complete
        setTimeout(() => {
          if (processingIndicator && processingIndicator.parentNode) {
            processingIndicator.parentNode.removeChild(processingIndicator);
          }
        }, 1500);
      }
    }
    
    const now = Date.now();
    const hasFinalChunk = pendingChunks.some(chunk => chunk.isFinal);
    const timeElapsed = now - firstChunkTime;
    
    // Process chunks if any of these conditions are met:
    // 1. There's a final chunk (always process these immediately)
    // 2. We've accumulated enough text to make a meaningful update
    // 3. Maximum wait time has elapsed since the first chunk
    // 4. Enough time has passed since last refresh AND we have some content
    
    if (!hasFinalChunk && 
        accumulatedChunkSize < minChunkSize && 
        timeElapsed < maxWaitTime && 
        (now - lastRefreshTime < refreshRateDelay || pendingChunks.length === 0)) {
      // Not enough content yet or not enough time has passed
      // Schedule next check
      setTimeout(processChunks, 100);
      return;
    }
    
    // Process all pending chunks
    if (pendingChunks.length > 0) {
      // Update last refresh time
      lastRefreshTime = now;
      
      // Process all pending chunks at once
      let hasFinalChunk = false;
      let combinedText = '';
      
      pendingChunks.forEach(chunk => {
        combinedText += chunk.text;
        if (chunk.isFinal) {
          hasFinalChunk = true;
        }
      });
      
      // Clear pending chunks
      pendingChunks = [];
      
      // If this is the first chunk, create a new message
      if (!currentStreamingMessage) {
        // Remove any existing AI messages
        const aiMessages = document.querySelectorAll('.welcome-message');
        if (aiMessages) {
          aiMessages.forEach(msg => {
            if (msg && msg.parentNode) {
              msg.parentNode.removeChild(msg);
            }
          });
        }
        
        // Create a new message for streaming content
        currentStreamingMessage = document.createElement('div');
        currentStreamingMessage.className = 'message welcome-message';
        currentStreamingMessage.setAttribute('data-last-ai', 'true');
        
        // Add message label
        const messageLabel = document.createElement('div');
        messageLabel.className = 'message-label';
        messageLabel.textContent = 'AI';
        currentStreamingMessage.appendChild(messageLabel);
        
        // Add message text container
        const messageText = document.createElement('div');
        messageText.className = 'formatted-content';
        currentStreamingMessage.appendChild(messageText);
        
        // Add to conversation if conversationArea exists
        const conversationArea = document.querySelector('.conversation-area');
        if (conversationArea) {
          conversationArea.appendChild(currentStreamingMessage);
          streamingMessageContent = '';
        }
      }
      
      // Update the message content with formatting
      const contentDiv = currentStreamingMessage.querySelector('.formatted-content');
      if (contentDiv) {
        streamingMessageContent += combinedText;
        
        // Show a single loading indicator if not the final chunk, otherwise show the full content
        if (!hasFinalChunk) {
          contentDiv.innerHTML = '<div class="loading-indicator"><i class="fas fa-circle-notch fa-spin"></i> Generating response...</div>';
        } else {
          contentDiv.innerHTML = formatStructuredContent(streamingMessageContent);
        }
        
        // Scroll to the bottom if container exists
        const container = document.querySelector('.container');
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      }
      
      // If this includes the final chunk, reset the streaming message reference
      if (hasFinalChunk) {
        currentStreamingMessage = null;
        // Remove any notification indicator
        const notificationIndicator = document.getElementById('refresh-notification');
        if (notificationIndicator) {
          notificationIndicator.remove();
        }
      }
    }
  }
  
  // Add a human message to the conversation
  function addHumanMessage(text) {
    // Remove previous human messages, preserve AI messages
    const humanMessages = Array.from(conversationArea.querySelectorAll('.message:not(.welcome-message)'));
    
    // Remove human messages only, preserve AI messages
    humanMessages.forEach(msg => conversationArea.removeChild(msg));
    
    // Create message container
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message human-message';
    
    // Add message label
    const messageLabel = document.createElement('div');
    messageLabel.className = 'message-label';
    messageLabel.textContent = 'You';
    messageDiv.appendChild(messageLabel);
    
    // Add message text
    const messageText = document.createElement('div');
    messageText.textContent = text;
    messageDiv.appendChild(messageText);
    
    // Add to conversation
    conversationArea.appendChild(messageDiv);
    
    // Always scroll to the new message
    container.scrollTop = container.scrollHeight;
    messageDiv.scrollIntoView({ behavior: 'smooth' });
  }
  
  // Function to update the interviewer question box with immediate display (no typing effect)
  // Added isPreliminary parameter to indicate if this is before role detection
  function updateInterviewerQuestionBox(newText, isPreliminary = false) {
    // First, remove any default placeholder interviewer question boxes
    const defaultQuestionBoxes = conversationArea.querySelectorAll('.interviewer-question:not(#permanent-interviewer-question)');  
    defaultQuestionBoxes.forEach(element => {
      element.remove();
    });
    
    // No need to check if it's a question anymore since we're using raw speaker labels
    // Just display the text as it comes in
    
    // Check if this text is identical to what's currently displayed in the answer section
    // This prevents showing the same content in both interviewer question and answer sections
    const aiSuggestionElement = conversationArea.querySelector('#permanent-ai-suggestion .formatted-content');
    if (aiSuggestionElement) {
      const aiText = aiSuggestionElement.textContent.trim();
      if (aiText && newText.trim() === aiText) {
        console.log('[DEBUG] Skipping interviewer question update - identical to answer result');
        return;
      }
    }
    
    // Log that we're updating the interviewer question box
    console.log('[DEBUG] Updating interviewer question box with text:', newText);
    
    // Cache DOM queries to improve performance
    let questionSection = document.getElementById('permanent-interviewer-question');
    
    // If no question box exists yet, create one
    if (!questionSection) {
      // Create elements once and cache them
      questionSection = document.createElement('div');
      questionSection.className = 'interviewer-question';
      questionSection.id = 'permanent-interviewer-question';
      
      // Create DOM structure efficiently
      const fragment = document.createDocumentFragment();
      
      // Add question text with 'Speaker 1:' prefix (assuming Speaker 1 is typically the interviewer)
      const questionText = document.createElement('div');
      questionText.className = 'question-text';
      questionText.innerHTML = '<strong>Interviewer:</strong> <span class="streaming-question"></span>';
      fragment.appendChild(questionText);
      
      // Create a container for the buttons
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'question-buttons';
      
      // Add Answer button
      const answerButton = document.createElement('button');
      answerButton.className = 'answer-button';
      answerButton.textContent = 'Answer';
      answerButton.addEventListener('click', function() {
        // Get the current question text
        const currentQuestion = latestInterviewerQuestion;
        console.log('[DEBUG] Answer button clicked, question:', currentQuestion);
        
        // Get all transcript content from the transcript section
        const transcriptContent = document.getElementById('transcript-content');
        const transcriptMessages = transcriptContent.querySelectorAll('.message');
        
        let transcriptText = '';
        const currentTime = Date.now();
        
        // Clear the interviewer question box with version-specific logic
        if (currentInterviewerQuestionElement) {
          // For macOS 15+: Only clear if AI answer exists
          // For older macOS: Always clear (previous behavior)
          if (!isMacOS15Plus || hasAIAnswerGenerated) {
            currentInterviewerQuestionElement.textContent = '';
          }
        }
        
        // If this is the first click, collect all transcript content
        if (!window.lastAnswerClickTime) {
          console.log('[DEBUG] First Answer click, collecting all transcript content');
          transcriptMessages.forEach(message => {
            const speakerSections = message.querySelectorAll('.speaker-section');
            speakerSections.forEach(section => {
              const role = section.getAttribute('data-role') || 'SPEAKER';
              const speakerLabel = section.querySelector('.speaker-label').textContent;
              const text = section.querySelector('span:last-child').textContent;
              transcriptText += `${role}: ${text}\n`;
            });
          });
        } else {
          // For subsequent clicks, only collect transcript content since the last click
          console.log('[DEBUG] Subsequent Answer click, collecting new transcript content');
          transcriptMessages.forEach(message => {
            // Check if this message was added after the last click
            // Since we don't have timestamps, we'll use the recent-message class as a heuristic
            if (message.classList.contains('recent-message')) {
              const speakerSections = message.querySelectorAll('.speaker-section');
              speakerSections.forEach(section => {
                const role = section.getAttribute('data-role') || 'SPEAKER';
                const speakerLabel = section.querySelector('.speaker-label').textContent;
                const text = section.querySelector('span:last-child').textContent;
                transcriptText += `${role}: ${text}\n`;
              });
            }
          });
        }
        
        // Update the last click time
        window.lastAnswerClickTime = currentTime;

        // Always collect all transcript content
        transcriptText = ''; // Reset transcriptText to rebuild
        transcriptMessages.forEach(message => {
          const speakerSections = message.querySelectorAll('.speaker-section');
          speakerSections.forEach(section => {
            const role = section.getAttribute('data-role') || 'SPEAKER';
            // const speakerLabel = section.querySelector('.speaker-label').textContent;
            const text = section.querySelector('span:last-child').textContent;
            transcriptText += `${role}: ${text}\n`;
          });
        });
        
        // Use the latestInterviewerQuestion directly since interviewer questions aren't in the transcript
        const mostRecentQuestion = latestInterviewerQuestion || currentQuestion || '';
        
        console.log('[DEBUG] Using latestInterviewerQuestion:', latestInterviewerQuestion);
        console.log('[DEBUG] Using currentQuestion:', currentQuestion);
        console.log('[DEBUG] Final mostRecentQuestion:', mostRecentQuestion);
        console.log('[DEBUG] Full transcript text being sent:', transcriptText);
        console.log('[DEBUG] macOS version detection - isMacOS15Plus:', isMacOS15Plus);
        
        // Enhanced prompt construction based on macOS version and audio source capabilities
        let aiPrompt;
        if (isMacOS15Plus) {
          // For macOS 15+: System audio captures interviewer questions, microphone captures candidate responses
          aiPrompt = `${transcriptText}\n\nContext: This interview uses macOS 15+ with separate audio capture - system audio captures the INTERVIEWER's questions, microphone captures the CANDIDATE's responses.\n\nPlease answer the following most recent question from the INTERVIEWER (captured via system audio): "${mostRecentQuestion}"`;
        } else {
          // For older macOS: Mixed audio stream, use previous logic
          aiPrompt = `${transcriptText}\n\nPlease answer the following most recent question from the INTERVIEWER: "${mostRecentQuestion}"`;
        }
        
        console.log('[DEBUG] Complete AI prompt being sent:');
        console.log('=== AI PROMPT START ===');
        console.log(aiPrompt);
        console.log('=== AI PROMPT END ===');
        
        // Send the transcript and question to the server to get AI suggestions
        if (currentQuestion && currentQuestion.trim()) {
  
          window.electron.getSuggestion(aiPrompt);
          
          // Clear the question box visually but keep latestInterviewerQuestion for AI processing
          // This allows new questions to appear as they come in from the transcript
          if (currentInterviewerQuestionElement) {
            // For macOS 15+: Only clear if AI answer exists
            // For older macOS: Always clear (previous behavior)
            if (!isMacOS15Plus || hasAIAnswerGenerated) {
              currentInterviewerQuestionElement.textContent = '';
            }
          }
        } else {
          console.log('[DEBUG] No question text to send, request aborted');
        }
      });
      buttonContainer.appendChild(answerButton);
      
      // Next button removed as requested
      
      fragment.appendChild(buttonContainer);
      questionSection.appendChild(fragment);
      
      // Add to the conversation area at the top using insertAdjacentElement for better performance
      if (conversationArea.firstChild) {
        conversationArea.insertBefore(questionSection, conversationArea.firstChild);
      } else {
        conversationArea.appendChild(questionSection);
      }
      
      // Store reference to the streaming question element
      currentInterviewerQuestionElement = questionText.querySelector('.streaming-question');
    } else if (!currentInterviewerQuestionElement) {
      // Find the streaming question span
      currentInterviewerQuestionElement = questionSection.querySelector('.streaming-question');
      
      if (!currentInterviewerQuestionElement) {
        // If no streaming span exists, create one
        const questionText = questionSection.querySelector('.question-text');
        if (questionText) {
          // Replace existing content with streaming format
          questionText.innerHTML = '<strong>Interviewer:</strong> <span class="streaming-question"></span>';
          currentInterviewerQuestionElement = questionText.querySelector('.streaming-question');
        }
      }
      
      // Check if Answer button exists, if not add it
      if (!questionSection.querySelector('.answer-button')) {
        // Create a container for the buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'question-buttons';
        questionSection.appendChild(buttonContainer);
        
        // Create Answer button
        const answerButton = document.createElement('button');
        answerButton.className = 'answer-button';
        answerButton.textContent = 'Answer';
        answerButton.addEventListener('click', function() {
          // Get the current question text
          const currentQuestion = latestInterviewerQuestion;
          console.log('[DEBUG] Answer button clicked, question:', currentQuestion);
          
          // Get all transcript content from the transcript section
          const transcriptContent = document.getElementById('transcript-content');
          const transcriptMessages = transcriptContent.querySelectorAll('.message');
          
          let transcriptText = '';
          const currentTime = Date.now();
          
          // Clear the interviewer question box with version-specific logic
          if (currentInterviewerQuestionElement) {
            // For macOS 15+: Only clear if AI answer exists
            // For older macOS: Always clear (previous behavior)
            if (!isMacOS15Plus || hasAIAnswerGenerated) {
              currentInterviewerQuestionElement.textContent = '';
            }
          }
          
          // Always collect all transcript content
          console.log('[DEBUG] Answer click, collecting all transcript content');
          transcriptMessages.forEach(message => {
            const speakerSections = message.querySelectorAll('.speaker-section');
            speakerSections.forEach(section => {
              const role = section.getAttribute('data-role') || 'SPEAKER';
              // const speakerLabel = section.querySelector('.speaker-label').textContent;
              const text = section.querySelector('span:last-child').textContent;
              transcriptText += `${role}: ${text}\n`;
            });
          });
          
          // Update the last click time
          window.lastAnswerClickTime = currentTime;
          
          // Use the latestInterviewerQuestion directly since interviewer questions aren't in the transcript
          const mostRecentQuestion = latestInterviewerQuestion || currentQuestion || '';
          
          console.log('[DEBUG] Using latestInterviewerQuestion:', latestInterviewerQuestion);
          console.log('[DEBUG] Using currentQuestion:', currentQuestion);
          console.log('[DEBUG] Final mostRecentQuestion:', mostRecentQuestion);
          console.log('[DEBUG] Full transcript text being sent:', transcriptText);
          console.log('[DEBUG] macOS version detection - isMacOS15Plus:', isMacOS15Plus);

          // Enhanced prompt construction based on macOS version and audio source capabilities
          let aiPrompt;
          if (isMacOS15Plus) {
            // For macOS 15+: System audio captures interviewer questions, microphone captures candidate responses
            aiPrompt = `${transcriptText}\n\nContext: This interview uses macOS 15+ with separate audio capture - system audio captures the INTERVIEWER's questions, microphone captures the CANDIDATE's responses.\n\nPlease answer the following most recent question from the INTERVIEWER (captured via system audio): "${mostRecentQuestion}"`;
          } else {
            // For older macOS: Mixed audio stream, use previous logic
            aiPrompt = `${transcriptText}\n\nPlease answer the following most recent question from the INTERVIEWER: "${mostRecentQuestion}"`;
          }
          
          console.log('[DEBUG] Complete AI prompt being sent:');
          console.log('=== AI PROMPT START ===');
          console.log(aiPrompt);
          console.log('=== AI PROMPT END ===');
          
          // Send the transcript and question to the server to get AI suggestions
          if (currentQuestion && currentQuestion.trim()) {
            // Try using getSuggestion instead of sendToServer

            window.electron.getSuggestion(aiPrompt);
            
            // Clear the question box visually but keep latestInterviewerQuestion for AI processing
            // This allows new questions to appear as they come in from the transcript
            if (currentInterviewerQuestionElement) {
              // For macOS 15+: Only clear if AI answer exists
              // For older macOS: Always clear (previous behavior)
              if (!isMacOS15Plus || hasAIAnswerGenerated) {
                currentInterviewerQuestionElement.textContent = '';
              }
            }
          }
        });
        buttonContainer.appendChild(answerButton);
        
        // Next button removed as requested
      }
    }
    
    // If we have a question element, update it immediately without typing effect
    if (currentInterviewerQuestionElement) {
      // Set the text content directly without any typing effect
      currentInterviewerQuestionElement.textContent = newText;
      
      // Update the latest interviewer question variable
      latestInterviewerQuestion = newText;
    }
  }
  
  // Removed typing effect function as requested
  
  // Add an AI message to the conversation
  function addAIMessage(text) {
    // First, remove any duplicate AI suggestion boxes that aren't the permanent one
    const allAISuggestions = conversationArea.querySelectorAll('.message[data-last-ai="true"]:not(#permanent-ai-suggestion), .ai-suggestion:not(.formatted-content)');
    allAISuggestions.forEach(element => {
      element.remove();
    });
    
    // Also remove any default placeholder AI suggestion boxes
    const defaultAISuggestions = conversationArea.querySelectorAll('.ai-suggestion:not(.formatted-content)');
    defaultAISuggestions.forEach(element => {
      element.remove();
    });
    
    // Check if we already have a permanent AI suggestion box
    let messageDiv = conversationArea.querySelector('#permanent-ai-suggestion');
    let messageText;
    
    // If no permanent AI suggestion box exists, create one
    if (!messageDiv) {
      // Create message container
      messageDiv = document.createElement('div');
      messageDiv.className = 'message welcome-message';
      messageDiv.id = 'permanent-ai-suggestion';
      messageDiv.setAttribute('data-last-ai', 'true'); // Mark as the last AI message
      
      // Add message label
      const messageLabel = document.createElement('div');
      messageLabel.className = 'message-label';
      messageLabel.textContent = 'AI';
      messageDiv.appendChild(messageLabel);
      
      // Add message text with formatting
      messageText = document.createElement('div');
      messageText.className = 'formatted-content ai-suggestion';
      messageDiv.appendChild(messageText);
      
      // Add to conversation after the interviewer question box
      conversationArea.appendChild(messageDiv);
    } else {
      // Get the existing message text element
      messageText = messageDiv.querySelector('.formatted-content');
    }
    
    // Only update content if text is provided (when Answer button is clicked)
    if (text && text.trim()) {
    
    // Mark that an AI answer has been generated
    hasAIAnswerGenerated = true;
    
    // Format the text for structured content
    // Remove any quotation marks that might be surrounding the text
    let cleanText = text;
    // Remove any 'INTERVIEWEE:' prefix and surrounding quotation marks
    cleanText = cleanText.replace(/^"?INTERVIEWEE:\s*/i, '');
    if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
      cleanText = cleanText.substring(1, cleanText.length - 1);
    }
    
    const formattedText = formatStructuredContent(cleanText);
    
    // Update the message content
    messageDiv.setAttribute('data-full-text', formattedText);
    messageText.innerHTML = formattedText;
    
    // Remove any existing elaborate button
    const existingButton = messageText.querySelector('.elaborate-button');
    if (existingButton) {
      existingButton.remove();
    }
    
    // Add elaborate button to AI suggestion box
    const elaborateButton = document.createElement('button');
    elaborateButton.className = 'elaborate-button';
    elaborateButton.textContent = 'Elaborate';
    elaborateButton.addEventListener('click', function() {
      // Get the original message text first
      const originalText = messageDiv.getAttribute('data-full-text');
      console.log('[DEBUG] Elaborate button clicked, original text:', originalText);
      // Disable the button and show loading state
      elaborateButton.disabled = true;
      elaborateButton.textContent = 'Processing...';

      // Send the message to be elaborated
      console.log('[DEBUG] Sending elaborate request to backend');
      window.electron.elaborate(originalText);
      
      // Listen for the elaboration response
      window.electron.onElaboration((data) => {
        console.log('[DEBUG] Received elaboration response:', data);
        // Get the elaborated text
        const elaboratedText = data.text;
        
        // Create a combined text with original and elaborated content
        const combinedText = `<div class="original-text">${formatStructuredContent(originalText)}</div><div class="elaborated-text">${formatStructuredContent(elaboratedText)}</div>`;
        
        // Update the full text attribute with the combined content
        messageDiv.setAttribute('data-full-text', combinedText);
        
        // Update the displayed content
        messageText.innerHTML = combinedText;
        
        // Reset the button state
        elaborateButton.disabled = false;
        elaborateButton.textContent = 'Elaborate';
      });
    });
    
    // Add the elaborate button to the AI suggestion box
    messageText.appendChild(elaborateButton);
    
    // Always scroll to bottom
    container.scrollTop = container.scrollHeight;
    }
    // If no text is provided, just ensure the AI suggestion box exists but is empty
  }
    
  
  
  // Function to update message content based on pagination
  function updateMessageContent(messageDiv, page) {
    const fullText = messageDiv.getAttribute('data-full-text');
    const totalPages = parseInt(messageDiv.getAttribute('data-total-pages'));
    const charsPerPage = 1000; // Updated to match the value in addAIMessage
    
    const startChar = (page - 1) * charsPerPage;
    const endChar = Math.min(startChar + charsPerPage, fullText.length);
    
    // Update content
    const contentDiv = messageDiv.querySelector('.formatted-content');
    contentDiv.innerHTML = fullText.substring(startChar, endChar);
    
    // Update pagination info
    const pageInfo = messageDiv.querySelector('.pagination-info');
    if (pageInfo) {
      pageInfo.textContent = `Page ${page} of ${totalPages}`;
    }
    
    // Update button states
    const prevButton = messageDiv.querySelector('.pagination-button:first-child');
    const nextButton = messageDiv.querySelector('.pagination-button:last-child');
    
    if (prevButton) prevButton.disabled = page <= 1;
    if (nextButton) nextButton.disabled = page >= totalPages;
  }
  
  // Format text to handle structured content like lists and code blocks
  function formatStructuredContent(text) {
    // First, handle multi-line code blocks with language specification
    // Example: ```javascript
    //          code here
    //          ```
    let formatted = text;
    
    // Find all code blocks with triple backticks
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    const codeBlocks = [];
    let match;
    let index = 0;
    
    // Replace code blocks with placeholders and store them
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const language = match[1] || 'plaintext';
      const code = match[2];
      const placeholder = `__CODE_BLOCK_${index}__`;
      
      codeBlocks.push({
        placeholder,
        language,
        code
      });
      
      formatted = formatted.replace(match[0], placeholder);
      index++;
    }
    
    // Replace line breaks with <br> tags (outside of code blocks)
    formatted = formatted.replace(/\n/g, '<br>');
    
    // Format bullet lists
    formatted = formatted.replace(/- ([^\n<]+)/g, '• $1');
    
    // Format numbered lists
    formatted = formatted.replace(/(\d+)\. ([^\n<]+)/g, '$1. $2');
    
    // Format inline code blocks
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Restore code blocks with syntax highlighting
    for (const block of codeBlocks) {
      let highlightedCode = block.code;
      
      try {
        // Apply syntax highlighting if language is specified
        if (block.language && block.language !== 'plaintext') {
          highlightedCode = hljs.highlight(block.code, { language: block.language }).value;
        } else {
          // Auto-detect language if not specified
          highlightedCode = hljs.highlightAuto(block.code).value;
        }
        
        // Create a temporary div to properly escape HTML entities
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = highlightedCode;
        // Get the properly escaped HTML content
        highlightedCode = tempDiv.textContent;
      } catch (e) {
        console.error('Error applying syntax highlighting:', e);
      }
      
      const codeHtml = `<pre><code class="hljs language-${block.language}">${highlightedCode}</code></pre>`;
      formatted = formatted.replace(block.placeholder, codeHtml);
    }
    
    return formatted;
  }
  
  // Update the recording UI based on the current state
  function updateRecordingUI() {
    if (isRecording) {
      toggleRecordingButton.innerHTML = 'Stop Interview <i class="fas fa-stop"></i>';
      toggleRecordingButton.title = 'Stop Recording';
      toggleRecordingButton.classList.add('active');
      statusIndicator.classList.add('recording');
      contextArea.style.display = 'none';
    } else {
      toggleRecordingButton.innerHTML = 'Start Interview';
      toggleRecordingButton.title = 'Start Recording';
      toggleRecordingButton.classList.remove('active');
      statusIndicator.classList.remove('recording');
      
      // Preserve the last AI message when recording stops
      const lastAIMessage = conversationArea.querySelector('.welcome-message[data-last-ai="true"]');
      if (lastAIMessage) {
        // Ensure the last AI message remains visible
        lastAIMessage.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  
  // Handle file upload button click
  // uploadFileButton.addEventListener('click', () => {
  //   // Use Electron's dialog API to select files
  //   window.electron.getCurrentWindowSize().then(() => {
  //     window.electron.openFileDialog().then(result => {
  //       if (!result.canceled && result.filePaths.length > 0) {
  //         const filePath = result.filePaths[0];
  //         window.electron.setContextFile(filePath);
  //       }
  //     }).catch(err => {
  //       console.error('Error selecting file:', err);
  //     });
  //   });
  // });
  
  // Handle file selection
  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      // In Electron's renderer process, the path property is not directly accessible
      // We need to use the file object itself
      const reader = new FileReader();
      reader.onload = (e) => {
        // For demonstration, we'll just use the file name
        // The actual file content is in e.target.result
        const fileName = file.name;
        console.log(`Selected file: ${fileName}`);
        
        // Update only the saved-context-display element
        const savedContextDisplay = document.getElementById('saved-context-display');
        if (savedContextDisplay) {
          savedContextDisplay.textContent = `File: ${fileName}`;
        }
        
        // Keep contextContent empty but not in empty state
        contextContent.textContent = '';
        contextContent.classList.remove('empty');
        
        // Make sure the context area is visible when adding new context
        contextArea.classList.remove('hidden');
        
        // Pass the file path to the main process using the unified approach
// Create a temporary file and use setContextFile API
const reader = new FileReader();
reader.onload = async (e) => {
    const fileContent = e.target.result;
    
    // Create a temporary file and use setContextFile API for unified handling
    const tempFilePath = await window.electron.createTempFile({
        fileName: file.name,
        fileContent: Array.from(new Uint8Array(fileContent)),
        fileType: file.type
    });
    
    // Use the unified setContextFile API
    window.electron.setContextFile(tempFilePath);
    

};
reader.readAsArrayBuffer(file);
        
        // Show success notification using the utility function
        showNotification('File uploaded successfully!', 'file-success');
      };
      reader.readAsDataURL(file);
    }
  });
  
  // Add visual indicator for context importance before interview
  toggleRecordingButton.addEventListener('mouseenter', () => {
    if (!isRecording && contextContent.classList.contains('empty')) {
      const contextReminder = document.createElement('div');
      contextReminder.className = 'context-reminder';
      contextReminder.innerHTML = '<i class="fas fa-info-circle"></i> Adding context before starting will improve AI suggestions';
      document.body.appendChild(contextReminder);
      
      // Position the reminder near the recording button
      const buttonRect = toggleRecordingButton.getBoundingClientRect();
      contextReminder.style.top = `${buttonRect.top - 40}px`;
      contextReminder.style.left = `${buttonRect.left + (buttonRect.width/2) - 150}px`;
      
      // Remove the reminder when mouse leaves
      toggleRecordingButton.addEventListener('mouseleave', () => {
        contextReminder.remove();
      }, { once: true });
    }
  });
  
  // Handle set text context button click
  setTextContextButton.addEventListener('click', () => {
    const text = contextText.value.trim();
    if (text) {
      window.electron.setContextText(text);
      // Save the context to the database
      window.electron.saveContext(text);

      
      // Update only the saved-context-display element
      const savedContextDisplay = document.getElementById('saved-context-display');
      if (savedContextDisplay) {
        savedContextDisplay.textContent = text;
      }
      
      // Keep contextContent empty but not in empty state
      contextContent.textContent = '';
      contextContent.classList.remove('empty');
      contextText.value = '';
      
      // Make sure the context area is visible when adding new context
      contextArea.classList.remove('hidden');
      
      // Show success notification using the utility function
      showNotification('Context successfully set!', 'text-success');
    }
  });
  
  // Add Enter key support for context input
  contextText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setTextContextButton.click();
    }
  });
  
  // Timer variables for tracking interview duration
  let interviewStartTime = null;
  let interviewDuration = 0;
  let timerInterval = null;
  
  // Function to format time in HH:MM:SS format
  function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0')
    ].join(':');
  }
  
  // Function to update timer display
  function updateTimerDisplay() {
    if (!interviewStartTime) return;
    
    const currentTime = new Date();
    const elapsedTime = currentTime - interviewStartTime;
    const formattedTime = formatTime(elapsedTime);
    
    // Create or update timer display
    let timerDisplay = document.getElementById('interview-timer');
    
    if (!timerDisplay) {
      timerDisplay = document.createElement('div');
      timerDisplay.id = 'interview-timer';
      timerDisplay.className = 'interview-timer';
      
      // Add timer to the recording controls section
      const recordingControls = document.querySelector('.recording-controls');
      if (recordingControls) {
        recordingControls.appendChild(timerDisplay);
      }
    }
    
    timerDisplay.textContent = formattedTime;
  }
  
  // Handle toggle recording button click with debounce to prevent multiple rapid clicks
  let recordingButtonDebounce = false;
  toggleRecordingButton.addEventListener('click', () => {
    if (recordingButtonDebounce) return;
    recordingButtonDebounce = true;
    
    if (isRecording) {
      // Stop recording and calculate interview duration
      window.electron.stopRecording();
      
      if (interviewStartTime) {
        const endTime = new Date();
        interviewDuration = endTime - interviewStartTime;
        const formattedDuration = formatTime(interviewDuration);
        
        console.log(`Interview session ended. Duration: ${formattedDuration}`);
        
        // Send interview timing data to server
        window.electron.sendToServer({
          type: 'interview-session',
          data: {
            startTime: interviewStartTime.toISOString(),
            endTime: endTime.toISOString(),
            durationMs: interviewDuration,
            formattedDuration: formattedDuration
          }
        });
        
        // Reset timer
        interviewStartTime = null;
        
        // Clear timer interval
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        
        // Remove timer display
        const timerDisplay = document.getElementById('interview-timer');
        if (timerDisplay && timerDisplay.parentNode) {
          timerDisplay.parentNode.removeChild(timerDisplay);
        }
      }
    } else {
      // Start recording and initialize timer
      window.electron.startRecording();
      interviewStartTime = new Date();
      // console.log(`Interview session started at: ${interviewStartTime.toISOString()}`);
      
      // Start timer interval to update display every second
      updateTimerDisplay(); // Show immediately
      timerInterval = setInterval(updateTimerDisplay, 1000);
    }
    
    // Reset debounce after short delay
    setTimeout(() => {
      recordingButtonDebounce = false;
    }, 300);
  });
  
  
  // Handle window controls
  minimizeButton.addEventListener('click', () => {
    window.electron.minimize();
  });
  
  closeButton.addEventListener('click', () => {
    window.electron.close();
  });
  
  // Transcript section toggle functionality
  const toggleTranscriptButton = document.getElementById('toggle-transcript');
  const hideTranscriptButton = document.getElementById('hide-transcript');
  const transcriptSection = document.getElementById('transcript-section');
  const transcriptContent = document.getElementById('transcript-content');
  const scrollUpTranscriptButton = document.getElementById('scroll-up-transcript');
  
  toggleTranscriptButton.addEventListener('click', () => {
    transcriptSection.classList.add('expanded');
    toggleTranscriptButton.style.display = 'none';
  });
  
  hideTranscriptButton.addEventListener('click', () => {
    transcriptSection.classList.remove('expanded');
    toggleTranscriptButton.style.display = 'block';
  });
  
  // Add scroll up functionality for transcript
  scrollUpTranscriptButton.addEventListener('click', () => {
    // Scroll up by a significant amount (about 3-4 messages)
    const scrollAmount = 200;
    transcriptContent.scrollBy({
      top: -scrollAmount,
      behavior: 'smooth'
    });
  });
  
  // Setup resize handlers
  const resizeHandleE = document.getElementById('resize-e');
  const resizeHandleS = document.getElementById('resize-s');
  const resizeHandleSE = document.getElementById('resize-se');
  
  // Variables to track resize state
  let isResizing = false;
  let resizeType = null;
  let initialWidth = 0;
  let initialHeight = 0;
  let initialX = 0;
  let initialY = 0;
  
  // Get initial window size
  window.electron.getCurrentWindowSize().then(([width, height]) => {
    initialWidth = width;
    initialHeight = height;
  });
  
  // East resize (right edge)
  resizeHandleE.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeType = 'e';
    initialX = e.clientX;
    window.electron.getCurrentWindowSize().then(([width, height]) => {
      initialWidth = width;
      initialHeight = height;
    });
    e.preventDefault();
    e.stopPropagation();
  });
  
  // South resize (bottom edge)
  resizeHandleS.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeType = 's';
    initialY = e.clientY;
    window.electron.getCurrentWindowSize().then(([width, height]) => {
      initialWidth = width;
      initialHeight = height;
    });
    e.preventDefault();
    e.stopPropagation();
  });
  
  // Southeast resize (bottom-right corner)
  resizeHandleSE.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeType = 'se';
    initialX = e.clientX;
    initialY = e.clientY;
    window.electron.getCurrentWindowSize().then(([width, height]) => {
      initialWidth = width;
      initialHeight = height;
    });
    e.preventDefault();
    e.stopPropagation();
  });
  
  // Handle mouse move for resizing
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    let newWidth = initialWidth;
    let newHeight = initialHeight;
    
    if (resizeType === 'e' || resizeType === 'se') {
      const deltaX = e.clientX - initialX;
      newWidth = Math.max(400, initialWidth + deltaX); // Minimum width of 400px
    }
    
    if (resizeType === 's' || resizeType === 'se') {
      const deltaY = e.clientY - initialY;
      newHeight = Math.max(200, initialHeight + deltaY); // Minimum height of 200px
    }
    
    window.electron.resizeWindow(newWidth, newHeight);
  });
  
  // Handle mouse up to stop resizing
  document.addEventListener('mouseup', () => {
    isResizing = false;
    resizeType = null;
  });
  
  // Handle window dragging with mouse
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  
  document.addEventListener('mousedown', (e) => {
    // Only start dragging if clicking on a draggable area (not a control or resize handle)
    if (e.target.closest('.controls, .window-controls, .resize-handle, button, input')) {
      return;
    }
    
    // Prevent default behavior to ensure proper dragging
    e.preventDefault();
    
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    if (deltaX !== 0 || deltaY !== 0) {
      window.electron.moveWindow(deltaX, deltaY);
      // Reset drag start coordinates after moving the window
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    }
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
  
  // Listen for screenshot taken events
  window.electron.onScreenshotTaken((data) => {
    // Only show notification if not from keyboard shortcut
    if (!data.isShortcut) {
      const conversationArea = document.getElementById('conversation-area');
      const container = document.querySelector('.conversation-container');

      if (conversationArea && container) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ai-message screenshot-notification';
        messageDiv.textContent = `Screenshot saved to: ${data.path}`;
        conversationArea.appendChild(messageDiv);

        // Auto-scroll to the bottom
        container.scrollTop = container.scrollHeight;

        // Remove the notification after 5 seconds
        setTimeout(() => {
          messageDiv.style.opacity = '0';
          setTimeout(() => {
            if (messageDiv.parentNode === conversationArea) { // Check parent before removing
              conversationArea.removeChild(messageDiv);
            }
          }, 500);
        }, 5000);
      } else {
        console.error('[UI Error] Could not find conversationArea or container for screenshot notification.');
      }
    }
  });
  
  // Remove screenshot notifications when receiving AI responses
  window.electron.onSuggestion((data) => {
    document.querySelectorAll('.screenshot-notification').forEach(notification => {
      notification.remove();
    });
  });
  
  // Custom context menu functionality removed as text selection is disabled
  const customContextMenu = document.getElementById('custom-context-menu');
  const askAiOption = document.getElementById('ask-ai-option');
  
  // Hide context menu when clicking anywhere
  document.addEventListener('click', function() {
    customContextMenu.style.display = 'none';
  });
  
  // Toggle context area visibility
  const toggleContextBtn = document.getElementById('toggle-context');
  
  if (toggleContextBtn) {
    toggleContextBtn.addEventListener('click', function() {
      // If the context area is already hidden, don't do anything with the collapsed class
      if (contextArea.classList.contains('hidden')) {
        return;
      }
      
      // Toggle the collapsed class
      const wasCollapsed = contextArea.classList.toggle('collapsed');
      
      // If the context area is now collapsed, hide it completely and show the reopen button
      if (wasCollapsed) {
        // Add a small delay to allow the collapse animation to complete
        setTimeout(() => {
          contextArea.classList.add('hidden');
          createReopenContextButton();
        }, 300);
      }
    });
  }
  });
  
  // Disable context menu for right-click
  document.addEventListener('contextmenu', function(e) {
    customContextMenu.style.display = 'none';
  });
