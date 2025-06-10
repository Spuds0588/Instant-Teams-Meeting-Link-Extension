// This script runs in the offscreen document.
chrome.runtime.onMessage.addListener(handleMessages);

function handleMessages(message) {
  if (message.target !== 'offscreen' || message.type !== 'copy-to-clipboard') {
    return;
  }
  
  const input = document.createElement('textarea');
  document.body.appendChild(input);
  input.value = message.text;
  input.focus();
  input.select();
  
  const success = document.execCommand('copy');
  
  document.body.removeChild(input);

  chrome.runtime.sendMessage({ type: 'copyToClipboardResponse', success: success });

  // Wait a moment before closing to ensure the message is sent.
  setTimeout(() => window.close(), 100);
}