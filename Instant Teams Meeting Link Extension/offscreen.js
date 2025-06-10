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

  // CRITICAL FIX: Wait a moment before closing to ensure the message is sent.
  // This prevents a race condition where the document closes before the message handler
  // in the background script can receive the response.
  setTimeout(() => window.close(), 100);
}