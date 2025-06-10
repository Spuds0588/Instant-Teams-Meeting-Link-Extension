chrome.runtime.onMessage.addListener((message) => {
  if (message.target === 'offscreen' && message.type === 'copy-to-clipboard') {
    handleCopyToClipboard(message.text);
  }
});

/**
 * Copies text and sends a response message indicating success or failure.
 * @param {string} text - The text to copy.
 */
function handleCopyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => {
      chrome.runtime.sendMessage({ type: 'copyToClipboardResponse', success: true });
    })
    .catch(err => {
      console.error("Offscreen script failed to copy text:", err);
      chrome.runtime.sendMessage({ type: 'copyToClipboardResponse', success: false });
    });
}