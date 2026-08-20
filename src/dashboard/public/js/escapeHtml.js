/**
 * Shared HTML escaping helper. Universal module: defines the global
 * `escapeHtml` in browsers and exports it for CommonJS tests.
 */
(function (global) {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml };
  }
  if (global) {
    global.escapeHtml = escapeHtml;
  }
})(typeof window !== 'undefined' ? window : globalThis);
