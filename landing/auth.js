// Supabase Authentication Handling

// Initialize Supabase client
const SUPABASE_URL = 'https://aqhcipqqdtchivmbxrap.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxaGNpcHFxZHRjaGl2bWJ4cmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3NzE0NDUsImV4cCI6MjA1NzM0NzQ0NX0.ABSLZyrZ-8LojAriQKlJALmsgChKagrPLXzVabf559Q';

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM Elements
const authModal = document.getElementById('auth-modal');
const authModalTitle = document.getElementById('auth-modal-title');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const resetPasswordForm = document.getElementById('reset-password-form');
const authMessage = document.getElementById('auth-message');
const loginButton = document.getElementById('login-button');
const signupButton = document.getElementById('signup-button');
const logoutButton = document.getElementById('logout-button');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const backToLoginLink = document.getElementById('back-to-login-link');
const userEmailSpan = document.getElementById('user-email');
const authSectionLoggedOut = document.getElementById('auth-section-logged-out');
const authSectionLoggedIn = document.getElementById('auth-section-logged-in');
const getStartedButton = document.getElementById('get-started-button');

// Bootstrap Modal instance
let modalInstance;

// Initialize auth functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Bootstrap modal
    modalInstance = new bootstrap.Modal(authModal);
    
    // Add event listeners
    loginButton.addEventListener('click', showLoginForm);
    signupButton.addEventListener('click', showSignupForm);
    logoutButton.addEventListener('click', handleLogout);
    forgotPasswordLink.addEventListener('click', showResetPasswordForm);
    backToLoginLink.addEventListener('click', showLoginForm);
    getStartedButton.addEventListener('click', showLoginForm);
    
    // Form submissions
    loginForm.addEventListener('submit', handleLogin);
    signupForm.addEventListener('submit', handleSignup);
    resetPasswordForm.addEventListener('submit', handlePasswordReset);
    
    // Check if user is already logged in
    checkAuthState();
});

// Check current authentication state
async function checkAuthState() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
        // User is logged in
        const { user } = session;
        userEmailSpan.textContent = user.email;
        authSectionLoggedOut.style.display = 'none';
        authSectionLoggedIn.style.display = 'block';
    } else {
        // User is not logged in
        authSectionLoggedOut.style.display = 'block';
        authSectionLoggedIn.style.display = 'none';
    }
}

// Show login form
function showLoginForm(e) {
    if (e) e.preventDefault();
    
    authModalTitle.textContent = 'Login';
    loginForm.style.display = 'block';
    signupForm.style.display = 'none';
    resetPasswordForm.style.display = 'none';
    authMessage.style.display = 'none';
    
    modalInstance.show();
}

// Show signup form
function showSignupForm(e) {
    if (e) e.preventDefault();
    
    authModalTitle.textContent = 'Sign Up';
    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    resetPasswordForm.style.display = 'none';
    authMessage.style.display = 'none';
    
    modalInstance.show();
}

// Show reset password form
function showResetPasswordForm(e) {
    if (e) e.preventDefault();
    
    authModalTitle.textContent = 'Reset Password';
    loginForm.style.display = 'none';
    signupForm.style.display = 'none';
    resetPasswordForm.style.display = 'block';
    authMessage.style.display = 'none';
}

// Handle login form submission
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        showMessage('Logging in...', 'info');
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        showMessage('Login successful!', 'success');
        setTimeout(() => {
            modalInstance.hide();
            checkAuthState();
        }, 1000);
    } catch (error) {
        showMessage(`Login failed: ${error.message}`, 'danger');
    }
}

// Handle signup form submission
async function handleSignup(e) {
    e.preventDefault();
    
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-password-confirm').value;
    
    // Validate passwords match
    if (password !== confirmPassword) {
        showMessage('Passwords do not match', 'danger');
        return;
    }
    
    try {
        showMessage('Creating account...', 'info');
        
        const { data, error } = await supabase.auth.signUp({
            email,
            password
        });
        
        if (error) throw error;
        
        showMessage('Account created! Please check your email for verification.', 'success');
        setTimeout(() => {
            showLoginForm();
        }, 3000);
    } catch (error) {
        showMessage(`Signup failed: ${error.message}`, 'danger');
    }
}

// Handle password reset form submission
async function handlePasswordReset(e) {
    e.preventDefault();
    
    const email = document.getElementById('reset-email').value;
    
    try {
        showMessage('Sending password reset email...', 'info');
        
        const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/landing/index.html'
        });
        
        if (error) throw error;
        
        showMessage('Password reset email sent! Please check your inbox.', 'success');
    } catch (error) {
        showMessage(`Failed to send reset email: ${error.message}`, 'danger');
    }
}

// Handle logout
async function handleLogout() {
    try {
        const { error } = await supabase.auth.signOut();
        
        if (error) throw error;
        
        checkAuthState();
    } catch (error) {
        console.error('Error logging out:', error.message);
    }
}

// Show message in auth modal
function showMessage(message, type) {
    authMessage.textContent = message;
    authMessage.className = `alert mt-3 alert-${type}`;
    authMessage.style.display = 'block';
}