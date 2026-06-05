/**
 * background.js — Hermes X Publisher service worker
 * Opens the Hermes server dashboard when extension icon is clicked.
 */
chrome.action?.onClicked?.addListener(() => {
  chrome.tabs.create({ url: 'http://localhost:8765' });
});

console.log('[Hermes Publisher] Service worker ready');
