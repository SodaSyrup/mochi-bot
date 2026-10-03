(() => {
  'use strict';

  const error = new URLSearchParams(window.location.search).get('error');
  const messages = {
    oauth_not_configured: 'Discord sign-in is not configured. Contact the site administrator.',
    auth_denied: 'Discord sign-in was cancelled. Sign in again to continue.',
    no_code: 'Discord did not return a sign-in code. Please try again.',
    invalid_state: 'Your sign-in session expired. Please sign in again.',
    auth_failed: 'Sign-in failed. Please try again.',
  };
  if (error) {
    const notice = document.getElementById('auth-notice');
    if (notice) {
      notice.textContent = messages[error] || 'Sign-in failed. Please try again.';
      notice.hidden = false;
    }
  }

  fetch('/auth/user', { credentials: 'same-origin' })
    .then((response) => response.ok ? response.json() : null)
    .then((session) => {
      if (!session?.authenticated) return;
      for (const link of document.querySelectorAll('a[data-login]')) {
        link.setAttribute('href', '/dashboard');
        link.textContent = 'Open dashboard';
      }
    })
    .catch(() => {});
})();
