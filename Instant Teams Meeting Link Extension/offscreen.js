// This script runs in the offscreen document.

chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message) {
  // Return early if this message isn't meant for us.
  if (message.target !== 'offscreen') {
    return;
  }

  if (message.type === 'copy-to-clipboard') {
    handleCopyToClipboard(message.text);
  }
}

/**
 * Copies the provided text to the system clipboard.
 * @param {string} text - The text to copy.
 */
async function handleCopyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    console.log('Offscreen: Text successfully copied to clipboard.');
  } catch (error) {
    console.error('Offscreen: Failed to copy text to clipboard.', error);
  } finally {
    // We can close the offscreen document after the operation to conserve resources.
    // However, for rapid successive calls, keeping it open might be better.
    // For this use case, closing it is fine.
    window.close();
  }
}