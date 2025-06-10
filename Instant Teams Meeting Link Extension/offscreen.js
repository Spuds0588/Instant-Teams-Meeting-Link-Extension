// This script runs in the offscreen document.
chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message, sender, sendResponse) {
  // Return early if this message isn't meant for us.
  if (message.target !== 'offscreen' || message.type !== 'copy-to-clipboard') {
    return;
  }

  handleCopyToClipboard(message.text);
}

/**
 * Copies text and sends a response message indicating success or failure.
 * @param {string} text - The text to copy.
 */
function handleCopyToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => {
      console.log("Offscreen: Text copied successfully.");
      chrome.runtime.sendMessage({ type: 'copyToClipboardResponse', success: true });
    })
    .catch(err => {
      console.error("Offscreen: Failed to copy text.", err);
      chrome.runtime.sendMessage({ type: 'copyToClipboardResponse', success: false });
    });
}