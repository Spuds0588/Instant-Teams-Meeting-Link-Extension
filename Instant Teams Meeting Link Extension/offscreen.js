// This script runs in the offscreen document.
chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message) {
  if (message.target !== 'offscreen' || message.type !== 'copy-to-clipboard') {
    return;
  }
  
  // Use a temporary textarea element to reliably copy text.
  const input = document.createElement('textarea');
  document.body.appendChild(input);
  input.value = message.text;
  input.focus();
  input.select();
  
  const success = document.execCommand('copy');
  
  document.body.removeChild(input);

  // Send a response back to the background script indicating the outcome.
  chrome.runtime.sendMessage({ type: 'copyToClipboardResponse', success: success });

  // ** THE FIX IS HERE: Close the offscreen document now that its job is complete. **
  window.close();
}