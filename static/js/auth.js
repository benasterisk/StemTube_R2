/**
 * Authentication utilities for StemTube Web
 * Handles API authentication errors and redirects
 */

// Global AJAX error handler for authentication errors
$(document).ajaxError(function(event, jqXHR, ajaxSettings, thrownError) {
    // Check if the error is an authentication error (401 Unauthorized)
    if (jqXHR.status === 401) {
        try {
            const response = JSON.parse(jqXHR.responseText);
            
            // If there's a redirect URL in the response, redirect to it
            if (response.redirect) {
                // Store the current URL to redirect back after login
                localStorage.setItem('redirectAfterLogin', window.location.href);
                
                // Show a message to the user
                alert('Your session has expired. Please log in again.');
                
                // Redirect to the login page
                window.location.href = response.redirect;
            }
        } catch (e) {
            // If the response is not valid JSON, just redirect to the login page
            window.location.href = '/login';
        }
    }
});

// Socket.IO authentication error handler
function setupSocketAuthHandling(socket) {
    socket.on('auth_error', function(data) {
        // Store the current URL to redirect back after login
        localStorage.setItem('redirectAfterLogin', window.location.href);
        
        // Show a message to the user
        alert('Your session has expired. Please log in again.');
        
        // Redirect to the login page
        if (data.redirect) {
            window.location.href = data.redirect;
        } else {
            window.location.href = '/login';
        }
    });
}

// Check for redirect after login
document.addEventListener('DOMContentLoaded', function() {
    // If we have a stored redirect URL, navigate to it
    const redirectUrl = localStorage.getItem('redirectAfterLogin');
    if (redirectUrl) {
        // Clear the stored URL
        localStorage.removeItem('redirectAfterLogin');
        
        // Check if we're already on the login page
        if (window.location.pathname !== '/login') {
            // Redirect to the stored URL
            window.location.href = redirectUrl;
        }
    }
});

// Export the setup function for use in other scripts
window.setupSocketAuthHandling = setupSocketAuthHandling;
