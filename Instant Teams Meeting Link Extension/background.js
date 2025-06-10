// =================================================================================
//                            CONFIGURATION
// =================================================================================

const AZURE_APP_CLIENT_ID = 'YOUR_AZURE_APPLICATION_CLIENT_ID_GOES_HERE';
const MS_GRAPH_SCOPES = ['OnlineMeetings.ReadWrite', 'User.Read', 'offline_access'];
const MS_GRAPH_ME_ENDPOINT = 'https://graph.microsoft.com/v1.0/me?$select=displayName';
const MS_GRAPH_ONLINE_MEETINGS_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/onlineMeetings';
const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const CONTEXT_MENU_ID = 'generateTeamsMeetingLink';
const RECENT_LINKS_STORAGE_KEY = 'recentMeetingLinks';
const MAX_RECENT_LINKS = 3;

// =================================================================================
//                            EXTENSION SETUP & LISTENERS
// =================================================================================

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Generate Teams Meeting Join Link',
    contexts: ['editable'],
  });

  if (AZURE_APP_CLIENT_ID === 'YOUR_AZURE_APPLICATION_CLIENT_ID_GOES_HERE') {
    console.warn("CRITICAL: Azure Client ID is not set in background.js.");
    showNotification('setup-error', 'Extension Setup Error', 'The Azure Client ID is missing. The extension will not work until it is configured.');
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    handleGenerateRequest({ from: 'contextMenu', tab: tab });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getRecentLinks') {
    chrome.storage.local.get([RECENT_LINKS_STORAGE_KEY])
      .then(result => sendResponse({ links: result[RECENT_LINKS_STORAGE_KEY] || [] }));
    return true; // async
  }
  if (message.type === 'generateLinkFromPopup') {
    handleGenerateRequest({ from: 'popup' })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, message: err.userMessage || 'Error' }));
    return true; // async
  }
  if (message.type === 'removeLink') {
    removeMeetingLink(message.urlToRemove).then(() => sendResponse({success: true}));
    return true; // async
  }
});

// =================================================================================
//                                  MAIN LOGIC
// =================================================================================

async function handleGenerateRequest(request) {
  try {
    if (AZURE_APP_CLIENT_ID === 'YOUR_AZURE_APPLICATION_CLIENT_ID_GOES_HERE') {
        throw new Error("Azure Client ID is not configured.");
    }
    const meetingUrl = await performLinkGeneration();

    // The auto-clipboard step is completely removed.

    const linkData = {
      url: meetingUrl,
      title: request.tab?.title || 'Generated from Popup',
      timestamp: Date.now()
    };
    await storeMeetingLink(linkData);

    if (request.from === 'contextMenu') {
      await attemptPageInjection(request.tab.id, meetingUrl);
    } else {
      // If generated from popup, the link is now in history. Let the user copy it from there.
      showNotification('popup-success', 'Link Created!', 'A new meeting link has been added to your history.');
    }
    return { success: true, url: meetingUrl };
  } catch (error) {
    console.error("Error in generation flow:", error);
    const userMessage = error.userMessage || error.message || 'An unexpected error occurred.';
    showNotification('error-notification', 'Error', userMessage);
    return { success: false, message: userMessage };
  }
}

async function performLinkGeneration() {
  if (!navigator.onLine) {
    const err = new Error('Network offline.');
    err.userMessage = 'Network connection unavailable.';
    throw err;
  }
  const token = await getAuthToken(true);
  const userDisplayName = await getUserDisplayName(token);
  const meetingDetails = await createTeamsMeeting(token, userDisplayName);
  return meetingDetails.joinUrl;
}

async function attemptPageInjection(tabId, url) {
  try {
    await injectScript(tabId, insertAndReplaceText, [url]);
    // Updated notification text
    showNotification('injection-success', 'Success!', 'Teams meeting link has been inserted.');
  } catch (injectionError) {
    // Updated notification text to guide the user to the popup
    showNotification('injection-failed', 'Insertion Failed', 'Could not insert link. It is available in the popup.');
  }
}

// =================================================================================
//                           STORAGE & UTILITY FUNCTIONS
// =================================================================================

async function storeMeetingLink(newLinkData) {
  const result = await chrome.storage.local.get([RECENT_LINKS_STORAGE_KEY]);
  const links = result[RECENT_LINKS_STORAGE_KEY] || [];
  links.unshift(newLinkData);
  const trimmedLinks = links.slice(0, MAX_RECENT_LINKS);
  await chrome.storage.local.set({ [RECENT_LINKS_STORAGE_KEY]: trimmedLinks });
  chrome.runtime.sendMessage({ type: 'linksUpdated' }).catch(e => {});
}

async function removeMeetingLink(urlToRemove) {
  const result = await chrome.storage.local.get([RECENT_LINKS_STORAGE_KEY]);
  let links = result[RECENT_LINKS_STORAGE_KEY] || [];
  links = links.filter(link => link.url !== urlToRemove);
  await chrome.storage.local.set({ [RECENT_LINKS_STORAGE_KEY]: links });
  chrome.runtime.sendMessage({ type: 'linksUpdated' }).catch(e => {});
}

function showNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic', iconUrl: 'icons/icon128.png', title: title, message: message, priority: 2
  });
}

// ...The rest of the file is unchanged but included for completeness...
async function injectScript(tabId, func, args) {
  await chrome.scripting.executeScript({ target: { tabId }, func, args });
}
function insertAndReplaceText(finalUrl) {
  const placeholder = '*Generating meeting link...*';
  const el = document.activeElement; if (!el) return;
  function insertText(text) {
    if (el.isContentEditable) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0); range.deleteContents();
        range.insertNode(document.createTextNode(text));
      }
    } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const start = el.selectionStart, end = el.selectionEnd;
      el.value = el.value.substring(0, start) + text + el.value.substring(end);
      el.selectionStart = el.selectionEnd = start + text.length;
    }
  }
  insertText(placeholder);
  if (el.value?.includes(placeholder)) {
    el.value = el.value.replace(placeholder, finalUrl);
  } else if (el.isContentEditable) {
    el.innerHTML = el.innerHTML.replace(placeholder, `<a href="${finalUrl}">${finalUrl}</a>`);
  }
}
async function getAuthToken(interactive) {try {const tokenInfo = await chrome.storage.local.get(['accessToken', 'refreshToken', 'tokenExpires']);if (tokenInfo.accessToken && tokenInfo.tokenExpires && new Date(tokenInfo.tokenExpires) > new Date()) {return tokenInfo.accessToken;}if (tokenInfo.refreshToken) {return await refreshAccessToken(tokenInfo.refreshToken);}if (interactive) {return await performInteractiveLogin();} const err=new Error("No valid token and non-interactive."); err.userMessage = "Please log in to Microsoft Teams first."; throw err;} catch (error) { const customError = new Error('Authentication process failed.'); customError.userMessage = error.userMessage || 'Could not authenticate with Microsoft.'; throw customError;}}
async function performInteractiveLogin() {const { verifier, challenge } = await generatePkceChallenge();const redirectUri = chrome.identity.getRedirectURL();const authUrl = new URL(MS_AUTH_ENDPOINT);authUrl.searchParams.append('client_id', AZURE_APP_CLIENT_ID);authUrl.searchParams.append('response_type', 'code');authUrl.searchParams.append('redirect_uri', redirectUri);authUrl.searchParams.append('scope', MS_GRAPH_SCOPES.join(' '));authUrl.searchParams.append('code_challenge', challenge);authUrl.searchParams.append('code_challenge_method', 'S256');authUrl.searchParams.append('prompt', 'select_account');const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.href, interactive: true });if (chrome.runtime.lastError || !resultUrl) {throw new Error(`Login failed or was cancelled.`);}const authCode = new URL(resultUrl).searchParams.get('code');if (!authCode) { throw new Error('Could not extract authorization code.'); }return await exchangeCodeForTokens(authCode, verifier, redirectUri);}
async function exchangeCodeForTokens(authCode, codeVerifier, redirectUri) {const tokenRequestBody = new URLSearchParams({client_id: AZURE_APP_CLIENT_ID, grant_type: 'authorization_code',code: authCode, redirect_uri: redirectUri, code_verifier: codeVerifier,});const response = await fetch(MS_TOKEN_ENDPOINT, {method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenRequestBody,});const tokenData = await response.json();if (!response.ok) { throw new Error(`Token exchange failed: ${tokenData.error_description || response.statusText}`); }await storeTokens(tokenData);return tokenData.access_token;}
async function refreshAccessToken(refreshToken) {const tokenRequestBody = new URLSearchParams({client_id: AZURE_APP_CLIENT_ID, grant_type: 'refresh_token',refresh_token: refreshToken, scope: MS_GRAPH_SCOPES.join(' '),});try {const response = await fetch(MS_TOKEN_ENDPOINT, {method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenRequestBody,});const tokenData = await response.json();if (!response.ok) {await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenExpires']);const authError = new Error('Session expired.');authError.userMessage = "Your session has expired. Please log back in.";throw authError;}await storeTokens(tokenData);return tokenData.access_token;} catch (error) { throw error; }}
async function storeTokens(tokenData) {const expiryTime = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();await chrome.storage.local.set({accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token, tokenExpires: expiryTime,});}
async function generatePkceChallenge() {const verifier = generateRandomString(128);const challenge = await sha256(verifier);return { verifier, challenge: base64UrlEncode(challenge) };}
function generateRandomString(length) {const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';let t = ''; for (let i = 0; i < length; i++) { t += p.charAt(Math.floor(Math.random() * p.length)); } return t;}
async function sha256(plain) {return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));}
function base64UrlEncode(buffer) {return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');}
async function getUserDisplayName(token) {try {const r = await apiFetchWithRetry(MS_GRAPH_ME_ENDPOINT, {headers: { 'Authorization': `Bearer ${token}` }});return r.displayName;} catch (e) {e.userMessage = `Failed to get user profile: ${e.message}`;throw e;}}
async function createTeamsMeeting(token, displayName) {const n = new Date(), o = new Date(n.getTime() + 36e5);const d = {startDateTime: n.toISOString(), endDateTime: o.toISOString(), subject: `Meeting with ${displayName}`};try {return await apiFetchWithRetry(MS_GRAPH_ONLINE_MEETINGS_ENDPOINT, {method: 'POST',headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },body: JSON.stringify(d)});} catch (e) {e.userMessage = `Failed to create meeting: ${e.message}`;throw e;}}
async function apiFetchWithRetry(url, options, retries = 3, delay = 1000) {try {const response = await fetch(url, options);if (response.status >= 500 && retries > 0) {await new Promise(r => setTimeout(r, delay));return apiFetchWithRetry(url, options, retries - 1, delay * 2);}const d = await response.json();if (!response.ok) {const m = d.error?.message || `HTTP error! status: ${response.status}`, e = new Error(m);if (response.status === 401 || response.status === 403) {e.userMessage = `Permission denied: ${m}`;} else {e.userMessage = `A service error occurred: ${m}`;}throw e;}return d;} catch (e) {if (!e.userMessage) {e.userMessage = `A network error occurred: ${e.message}`;}throw e;}}