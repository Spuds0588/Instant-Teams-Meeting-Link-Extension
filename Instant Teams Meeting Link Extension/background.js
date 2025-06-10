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
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const RECENT_LINKS_STORAGE_KEY = 'recentMeetingLinks';
const MAX_RECENT_LINKS = 3;

// =================================================================================
//                            EXTENSION SETUP & LISTENERS
// =================================================================================

chrome.runtime.onInstalled.addListener(() => {
  if (AZURE_APP_CLIENT_ID === 'YOUR_AZURE_APPLICATION_CLIENT_ID_GOES_HERE') {
    console.error("CRITICAL: Azure Client ID is not set in background.js.");
    showNotification('setup-error', 'Extension Setup Error', 'The Azure Client ID is missing. Please configure the extension.');
    return;
  }
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Generate Teams Meeting Join Link',
    contexts: ['editable'],
  });
});

// Listener for the context menu
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    handleGenerateRequest({ tabId: tab.id, from: 'contextMenu' });
  }
});

// Listener for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getRecentLinks') {
    chrome.storage.local.get([RECENT_LINKS_STORAGE_KEY]).then(result => {
      sendResponse({ links: result[RECENT_LINKS_STORAGE_KEY] || [] });
    });
    return true; // async response
  }
  
  if (message.type === 'generateLinkFromPopup') {
    handleGenerateRequest({ from: 'popup' })
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, message: err.userMessage || 'An unknown error occurred.' }));
    return true; // async response
  }
  
  // This listener is for the offscreen document to send back a result
  if (message.type === 'copyToClipboardResponse') {
      clipboardPromise?.resolve(message.success);
  }
});

// =================================================================================
//                                  MAIN LOGIC
// =================================================================================

/**
 * Main handler that routes generation requests from different sources.
 * @param {object} request - Contains details about the request source (popup/contextMenu) and tabId.
 */
async function handleGenerateRequest(request) {
    // 1. Give immediate feedback that something is happening.
    const inProgressNotificationId = `progress-${Date.now()}`;
    if (request.from === 'contextMenu') {
        showNotification(inProgressNotificationId, 'Generating Link...', 'Please wait, connecting to Microsoft Teams.');
    }

    try {
        const meetingUrl = await performLinkGeneration();
        
        // 2. Core task: Copy to clipboard
        const copySuccess = await copyToClipboard(meetingUrl);
        if (!copySuccess) {
            throw new Error('Could not copy the link to the clipboard. Please check extension permissions.');
        }

        // 3. Store the link in history
        await storeMeetingLink(meetingUrl);

        // 4. Handle source-specific follow-up actions
        if (request.from === 'contextMenu') {
            chrome.notifications.clear(inProgressNotificationId);
            await attemptPageInjection(request.tabId, meetingUrl);
        }

        // 5. Return a success status to the caller (for the popup)
        return { success: true, url: meetingUrl };

    } catch (error) {
        console.error('Error during meeting generation:', error);
        chrome.notifications.clear(inProgressNotificationId); // Clear progress notification on error
        const userMessage = error.userMessage || 'An unexpected error occurred. Please try again.';
        showNotification('error-notification', 'Error', userMessage);
        return { success: false, message: userMessage }; // Return failure status for popup
    }
}

/**
 * Performs the core logic of authenticating and creating a meeting link.
 * @returns {Promise<string>} The generated meeting URL.
 */
async function performLinkGeneration() {
  if (!navigator.onLine) {
    const err = new Error('Network connection unavailable.');
    err.userMessage = 'Network connection unavailable. Please check your connection and try again.';
    throw err;
  }
  const token = await getAuthToken(true);
  if (!token) {
    const err = new Error('Authentication failed.');
    err.userMessage = 'Authentication failed. Please try again.';
    throw err;
  }
  const userDisplayName = await getUserDisplayName(token);
  const meetingDetails = await createTeamsMeeting(token, userDisplayName);
  return meetingDetails.joinUrl;
}

/**
 * Tries to inject the generated link into the page, with clear notifications on failure.
 * @param {number} tabId - The ID of the target tab.
 * @param {string} url - The meeting URL to inject.
 */
async function attemptPageInjection(tabId, url) {
    const placeholder = `*Generating meeting link...*`; // Define placeholder locally
    try {
        await injectScript(tabId, insertTextAtCursor, [placeholder]);
        await injectScript(tabId, replacePlaceholder, [placeholder, url]);
        showNotification('injection-success', 'Success!', 'Teams meeting link has been inserted and copied to your clipboard.');
    } catch (injectionError) {
        console.warn('Script injection failed. This is expected on protected pages.');
        showNotification(
            'injection-failed',
            'Link Copied!',
            'Could not insert the link on the page, but it has been copied to your clipboard.'
        );
    }
}

// =================================================================================
//                           UTILITY & API FUNCTIONS
// =================================================================================

let clipboardPromise;
/**
 * Copies text to the clipboard using the offscreen API and waits for a response.
 * @param {string} text - The text to copy.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function copyToClipboard(text) {
    try {
        if (!await chrome.offscreen.hasDocument()) {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_DOCUMENT_PATH,
                reasons: ['CLIPBOARD'],
                justification: 'Required to write to the system clipboard.',
            });
        }
        
        let resolveFn;
        const promise = new Promise(resolve => { resolveFn = resolve; });
        clipboardPromise = { resolve: resolveFn };
        
        chrome.runtime.sendMessage({ type: 'copy-to-clipboard', target: 'offscreen', text: text });
        
        const success = await promise;
        clipboardPromise = null; // Clean up
        await chrome.offscreen.closeDocument(); // Close to conserve resources
        return success;

    } catch (e) {
        console.error("Error setting up offscreen document for clipboard:", e);
        if (e.message.includes("Only a single offscreen document may be created")) {
            // This is a transient error, we can try to recover or just fail gracefully.
        } else {
            await chrome.offscreen.closeDocument().catch(() => {}); // Attempt cleanup
        }
        return false;
    }
}


function showNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic', iconUrl: 'icons/icon128.png', title: title, message: message, priority: 2
  });
}

async function storeMeetingLink(joinUrl) {
    const result = await chrome.storage.local.get([RECENT_LINKS_STORAGE_KEY]);
    const links = result[RECENT_LINKS_STORAGE_KEY] || [];
    links.unshift(joinUrl);
    const trimmedLinks = links.slice(0, MAX_RECENT_LINKS);
    await chrome.storage.local.set({ [RECENT_LINKS_STORAGE_KEY]: trimmedLinks });
    console.log('Recent links updated.');
}

async function injectScript(tabId, func, args) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
    // Check if script injection actually worked. On some pages it returns without error but does nothing.
    if (!results || results.length === 0) {
        throw new Error("Script did not execute, possibly due to page restrictions.");
    }
  } catch(e) {
    const error = new Error(`Script injection failed: ${e.message}`);
    error.userMessage = 'Could not access the page to insert the link.';
    throw error;
  }
}

// =================================================================================
//                AUTHENTICATION & GRAPH API (UNCHANGED SECTION)
// =================================================================================
async function getAuthToken(interactive) {try {const tokenInfo = await chrome.storage.local.get(['accessToken', 'refreshToken', 'tokenExpires']);if (tokenInfo.accessToken && tokenInfo.tokenExpires && new Date(tokenInfo.tokenExpires) > new Date()) {return tokenInfo.accessToken;}if (tokenInfo.refreshToken) {return await refreshAccessToken(tokenInfo.refreshToken);}if (interactive) {return await performInteractiveLogin();}return null;} catch (error) {console.error('Error in getAuthToken:', error);const customError = new Error('Authentication process failed.');customError.userMessage = 'Could not authenticate with Microsoft. Please try again.';throw customError;}}
async function performInteractiveLogin() {const { verifier, challenge } = await generatePkceChallenge();const redirectUri = chrome.identity.getRedirectURL();const authUrl = new URL(MS_AUTH_ENDPOINT);authUrl.searchParams.append('client_id', AZURE_APP_CLIENT_ID);authUrl.searchParams.append('response_type', 'code');authUrl.searchParams.append('redirect_uri', redirectUri);authUrl.searchParams.append('scope', MS_GRAPH_SCOPES.join(' '));authUrl.searchParams.append('code_challenge', challenge);authUrl.searchParams.append('code_challenge_method', 'S256');authUrl.searchParams.append('prompt', 'select_account');const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.href, interactive: true });if (chrome.runtime.lastError || !resultUrl) {throw new Error(`Login failed or was cancelled. ${chrome.runtime.lastError?.message || ''}`);}const authCode = new URL(resultUrl).searchParams.get('code');if (!authCode) { throw new Error('Could not extract authorization code.'); }return await exchangeCodeForTokens(authCode, verifier, redirectUri);}
async function exchangeCodeForTokens(authCode, codeVerifier, redirectUri) {const tokenRequestBody = new URLSearchParams({client_id: AZURE_APP_CLIENT_ID, grant_type: 'authorization_code',code: authCode, redirect_uri: redirectUri, code_verifier: codeVerifier,});const response = await fetch(MS_TOKEN_ENDPOINT, {method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenRequestBody,});const tokenData = await response.json();if (!response.ok) { throw new Error(`Token exchange failed: ${tokenData.error_description || response.statusText}`); }await storeTokens(tokenData);return tokenData.access_token;}
async function refreshAccessToken(refreshToken) {const tokenRequestBody = new URLSearchParams({client_id: AZURE_APP_CLIENT_ID, grant_type: 'refresh_token',refresh_token: refreshToken, scope: MS_GRAPH_SCOPES.join(' '),});try {const response = await fetch(MS_TOKEN_ENDPOINT, {method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenRequestBody,});const tokenData = await response.json();if (!response.ok) {await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenExpires']);const authError = new Error('Session expired.');authError.userMessage = "Your session has expired. Please try again to log back in.";throw authError;}await storeTokens(tokenData);return tokenData.access_token;} catch (error) { throw error; }}
async function storeTokens(tokenData) {const expiryTime = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();await chrome.storage.local.set({accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token, tokenExpires: expiryTime,});}
async function generatePkceChallenge() {const verifier = generateRandomString(128);const challenge = await sha256(verifier);return { verifier, challenge: base64UrlEncode(challenge) };}
function generateRandomString(length) {const p = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';let t = ''; for (let i = 0; i < length; i++) { t += p.charAt(Math.floor(Math.random() * p.length)); } return t;}
async function sha256(plain) {return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));}
function base64UrlEncode(buffer) {return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');}
async function getUserDisplayName(token) {try {const r = await apiFetchWithRetry(MS_GRAPH_ME_ENDPOINT, {headers: { 'Authorization': `Bearer ${token}` }});return r.displayName;} catch (e) {e.userMessage = `Failed to get user profile. (Details: ${e.message})`;throw e;}}
async function createTeamsMeeting(token, displayName) {const n = new Date(), o = new Date(n.getTime() + 36e5);const d = {startDateTime: n.toISOString(), endDateTime: o.toISOString(), subject: `Meeting with ${displayName}`};try {return await apiFetchWithRetry(MS_GRAPH_ONLINE_MEETINGS_ENDPOINT, {method: 'POST',headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },body: JSON.stringify(d)});} catch (e) {e.userMessage = `Failed to create meeting. (Details: ${e.message})`;throw e;}}
async function apiFetchWithRetry(url, options, retries = 3, delay = 1000) {try {const response = await fetch(url, options);if (response.status >= 500 && retries > 0) {await new Promise(r => setTimeout(r, delay));return apiFetchWithRetry(url, options, retries - 1, delay * 2);}const d = await response.json();if (!response.ok) {const m = d.error?.message || `HTTP error! status: ${response.status}`, e = new Error(m);if (response.status === 401 || response.status === 403) {e.userMessage = `Permission denied. (Details: ${m})`;} else {e.userMessage = `A service error occurred. (Details: ${m})`;}throw e;}return d;} catch (e) {if (!e.userMessage) {e.userMessage = `A network error occurred: ${e.message}`;}throw e;}}

// =================================================================================
//                        INJECTABLE CONTENT SCRIPT FUNCTIONS
// =================================================================================
function insertTextAtCursor(textToInsert) {const el = document.activeElement;if (!el || !textToInsert) return;if (el.isContentEditable) {const selection = window.getSelection();if (selection.rangeCount > 0) {const range = selection.getRangeAt(0);range.deleteContents();range.insertNode(document.createTextNode(textToInsert));}} else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {const start = el.selectionStart, end = el.selectionEnd;el.value = el.value.substring(0, start) + textToInsert + el.value.substring(end);el.selectionStart = el.selectionEnd = start + textToInsert.length;}}
function replacePlaceholder(placeholder, finalUrl) {const el = document.activeElement; if (!el) return;const linkHtml = `<a href="${finalUrl}">${finalUrl}</a>`;if (el.value?.includes(placeholder)) {el.value = el.value.replace(placeholder, finalUrl);} else if (el.isContentEditable && (el.textContent || "").includes(placeholder)) {el.innerHTML = el.innerHTML.replace(placeholder, linkHtml);}}