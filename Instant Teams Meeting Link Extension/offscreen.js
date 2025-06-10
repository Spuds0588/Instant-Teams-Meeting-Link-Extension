// This script runs in the offscreen document. Its sole purpose is to handle clipboard operations.
chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message) {
  // Return early if this message isn't for us.
  if (message.target !== 'offscreen' || message.type !== 'copy-to-clipboard') {
    return;
  }
  
  // Use a temporary textarea element to reliably copy text to the clipboard.
  // This is the most robust method for background extension contexts.
  const input = document.createElement('textarea');
  document.body.appendChild(input);
  
  input.value = message.text;
  input.focus();
  input.select();
  
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (err) {
    console.error('Offscreen Page: Unable to copy using execCommand.', err);
  }
  
  document.body.removeChild(input);

  if (success) {
    console.log('Offscreen Page: Text copied to clipboard successfully.');
  } else {
    console.error('Offscreen Page: Failed to copy text to clipboard.');
  }

  // Send a response back to the background script indicating the outcome.
  chrome.runtime.sendMessage({ type: 'copyToClipboardResponse', success: success });
}