/**
 * background.js — X Article Markdown Publisher service worker
 * Opens the local dashboard when extension icon is clicked.
 */
chrome.action?.onClicked?.addListener(() => {
  chrome.tabs.create({ url: 'http://localhost:8765' });
});

console.log('[X Article Markdown Publisher] Service worker ready');
