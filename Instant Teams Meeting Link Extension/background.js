// =================================================================================
//                            CONFIGURATION
// =================================================================================

// IMPORTANT: PASTE YOUR AZURE APPLICATION (CLIENT) ID HERE
const AZURE_APP_CLIENT_ID = 'YOUR_AZURE_APPLICATION_CLIENT_ID_GOES_HERE';

// Microsoft Graph API Scopes and Endpoints
const MS_GRAPH_SCOPES = ['OnlineMeetings.ReadWrite', 'User.Read', 'offline_access'];
const MS_GRAPH_ME_ENDPOINT = 'https://graph.microsoft.com/v1.0/me?$select=displayName';
const MS_GRAPH_ONLINE_MEETINGS_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/onlineMeetings';
const MS_AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

// Extension-specific constants
const CONTEXT_MENU_ID = 'generateTeamsMeetingLink';
const PLACEHOLDER_TEXT = '*Generating meeting link...*';
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const RECENT_LINKS_STORAGE_KEY = 'recentMeetingLinks';
const MAX_RECENT_LINKS = 3;


// =================================================================================
//                            EXTENSION SETUP & LISTENERS
// =================================================================================

// Create the context menu item upon installation.
chrome.runtime.onInstalled.addListener(() => {
  if (AZURE_APP_CLIENT_ID === 'YOUR_AZURE_APPLICATION_CLIENT_ID_GOES_HERE') {
    console.error("CRITICAL: Azure Application (Client) ID is not set in background.js. The extension will not work.");
    showNotification(
        'setup-error',
        'Extension Setup Error',
        'The Azure Client ID is missing. Please configure it in the extension files.'
    );
    return;
  }
  
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Generate Teams Meeting Join Link',
    contexts: ['editable'],
  });
  console.log('Context menu created.');
});

// Listen for clicks on the context menu item.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    console.log('Context menu clicked. Starting process.');
    generateMeetingLink(tab.id);
  }
});

// Listen for messages from the popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getRecentLinks') {
    chrome.storage.local.get([RECENT_LINKS_STORAGE_KEY]).then(result => {
      sendResponse({ links: result[RECENT_LINKS_STORAGE_KEY] || [] });
    });
    return true; // Indicates that the response is sent asynchronously
  }
});


// =================================================================================
//                             MAIN LOGIC FLOW
// =================================================================================

async function generateMeetingLink(tabId) {
  let placeholderInjected = false;
  try {
    // 1. Check for network connectivity
    if (!navigator.onLine) {
        console.error('Network offline.');
        throw new Error('Network connection unavailable. Please check your connection and try again.');
    }
    
    // 2. Provide instant feedback by inserting a placeholder
    console.log('Injecting placeholder text...');
    await injectScript(tabId, insertTextAtCursor, [PLACEHOLDER_TEXT]);
    placeholderInjected = true;

    // 3. Get a valid auth token
    console.log('Attempting to get auth token...');
    const token = await getAuthToken(true);
    if (!token) {
        throw new Error('Authentication failed. Could not retrieve a valid token.');
    }
    console.log('Successfully retrieved auth token.');

    // 4. Get user's display name
    console.log("Fetching user's display name...");
    const userDisplayName = await getUserDisplayName(token);

    // 5. Create the Teams meeting
    console.log('Creating Teams meeting...');
    const meetingDetails = await createTeamsMeeting(token, userDisplayName);
    console.log('Meeting created successfully.');

    // 6. Copy the meeting URL to the clipboard
    console.log('Copying link to clipboard...');
    await copyToClipboard(meetingDetails.joinUrl);
    console.log('Link copied to clipboard.');

    // 7. Store the link for the popup history
    console.log('Storing link in history...');
    await storeMeetingLink(meetingDetails.joinUrl);

    // 8. Replace placeholder with the final URL
    try {
        console.log('Replacing placeholder with final URL...');
        await injectScript(tabId, replacePlaceholder, [PLACEHOLDER_TEXT, meetingDetails.joinUrl]);
        console.log('Process complete.');
    } catch (injectionError) {
        // *** GRACEFUL FALLBACK ***
        // This is the key change: if the final injection fails, we notify the user
        // that the link is on their clipboard instead of showing a generic error.
        console.warn('Failed to inject final URL into the page. The page may be protected.');
        await injectScript(tabId, removePlaceholder, [PLACEHOLDER_TEXT]); // Still try to clean up
        showNotification(
            'insertion-failed',
            'Link Copied!',
            'Could not insert the link on the page, but it has been copied to your clipboard.'
        );
        placeholderInjected = false; // Prevents the outer catch from also trying to remove it.
    }

  } catch (error) {
    console.error('Error in generateMeetingLink flow:', error.message || error);
    // On any failure, remove the placeholder text from the page if it was injected
    if (placeholderInjected) {
        await injectScript(tabId, removePlaceholder, [PLACEHOLDER_TEXT]).catch(err => 
            console.error('Failed to remove placeholder after an error:', err)
        );
    }
    
    // And show a user-friendly notification
    let userMessage = error.userMessage || 'An unexpected error occurred. Please try again.';
    showNotification('error-notification', 'Error', userMessage);
  }
}

// =================================================================================
//                                  STORAGE
// =================================================================================

/**
 * Stores the newly generated meeting link in an array for the popup.
 * @param {string} joinUrl - The URL of the meeting to store.
 */
async function storeMeetingLink(joinUrl) {
    try {
        const result = await chrome.storage.local.get([RECENT_LINKS_STORAGE_KEY]);
        const links = result[RECENT_LINKS_STORAGE_KEY] || [];
        
        // Add the new link to the beginning of the array
        links.unshift(joinUrl);
        
        // Ensure the array does not exceed the maximum size
        const trimmedLinks = links.slice(0, MAX_RECENT_LINKS);
        
        await chrome.storage.local.set({ [RECENT_LINKS_STORAGE_KEY]: trimmedLinks });
        console.log('Recent links updated in storage.');
    } catch (e) {
        console.error("Failed to store recent meeting link:", e);
    }
}


// =================================================================================
//                         AUTHENTICATION (OAuth 2.0 with PKCE)
// =================================================================================

// THIS SECTION IS UNCHANGED FROM THE PREVIOUS VERSION.
// (It is included here so you have the full file to copy.)

/**
 * Gets a valid access token, handling interactive login and token refresh.
 * @param {boolean} interactive - If true, will prompt user to log in if needed.
 * @returns {Promise<string|null>} The access token or null if it fails.
 */
async function getAuthToken(interactive) {
  try {
    const tokenInfo = await chrome.storage.local.get(['accessToken', 'refreshToken', 'tokenExpires']);
    if (tokenInfo.accessToken && tokenInfo.tokenExpires && new Date(tokenInfo.tokenExpires) > new Date()) {
      return tokenInfo.accessToken;
    }
    if (tokenInfo.refreshToken) {
      return await refreshAccessToken(tokenInfo.refreshToken);
    }
    if (interactive) {
      return await performInteractiveLogin();
    }
    return null;
  } catch (error) {
    console.error('Error in getAuthToken:', error);
    const customError = new Error('Authentication process failed.');
    customError.userMessage = 'Could not authenticate with Microsoft. Please try again.';
    throw customError;
  }
}
async function performInteractiveLogin() {
    const { verifier, challenge } = await generatePkceChallenge();
    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = new URL(MS_AUTH_ENDPOINT);
    authUrl.searchParams.append('client_id', AZURE_APP_CLIENT_ID);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', MS_GRAPH_SCOPES.join(' '));
    authUrl.searchParams.append('code_challenge', challenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    authUrl.search_params.append('prompt', 'select_account');
    const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.href, interactive: true });
    if (chrome.runtime.lastError || !resultUrl) {
      throw new Error(`Login failed or was cancelled by user. ${chrome.runtime.lastError?.message || ''}`);
    }
    const authCode = new URL(resultUrl).searchParams.get('code');
    if (!authCode) { throw new Error('Could not extract authorization code from redirect.'); }
    return await exchangeCodeForTokens(authCode, verifier, redirectUri);
}
async function exchangeCodeForTokens(authCode, codeVerifier, redirectUri) {
    const tokenRequestBody = new URLSearchParams({
        client_id: AZURE_APP_CLIENT_ID, grant_type: 'authorization_code',
        code: authCode, redirect_uri: redirectUri, code_verifier: codeVerifier,
    });
    const response = await fetch(MS_TOKEN_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenRequestBody,
    });
    const tokenData = await response.json();
    if (!response.ok) { throw new Error(`Token exchange failed: ${tokenData.error_description || response.statusText}`); }
    await storeTokens(tokenData);
    return tokenData.access_token;
}
async function refreshAccessToken(refreshToken) {
    const tokenRequestBody = new URLSearchParams({
        client_id: AZURE_APP_CLIENT_ID, grant_type: 'refresh_token',
        refresh_token: refreshToken, scope: MS_GRAPH_SCOPES.join(' '),
    });
    try {
        const response = await fetch(MS_TOKEN_ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenRequestBody,
        });
        const tokenData = await response.json();
        if (!response.ok) {
            await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenExpires']);
            const authError = new Error('Session expired.');
            authError.userMessage = "Your session has expired. Please try again to log back in.";
            throw authError;
        }
        await storeTokens(tokenData);
        return tokenData.access_token;
    } catch (error) { throw error; }
}
async function storeTokens(tokenData) {
    const expiryTime = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await chrome.storage.local.set({
        accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token, tokenExpires: expiryTime,
    });
}
async function generatePkceChallenge() {
    const verifier = generateRandomString(128);
    const challenge = await sha256(verifier);
    return { verifier, challenge: base64UrlEncode(challenge) };
}
function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let text = ''; for (let i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
    return text;
}
async function sha256(plain) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
}
function base64UrlEncode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// =================================================================================
//                            MICROSOFT GRAPH API CALLS
// =================================================================================

// THIS SECTION IS UNCHANGED FROM THE PREVIOUS VERSION.

async function getUserDisplayName(token) {
  try {
    const response = await apiFetchWithRetry(MS_GRAPH_ME_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.displayName;
  } catch (error) {
    error.userMessage = `Failed to get user profile. (Details: ${error.message})`;
    throw error;
  }
}
async function createTeamsMeeting(token, displayName) {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  const meetingData = {
    startDateTime: now.toISOString(), endDateTime: oneHourFromNow.toISOString(),
    subject: `Meeting with ${displayName}`
  };
  try {
    return await apiFetchWithRetry(MS_GRAPH_ONLINE_MEETINGS_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(meetingData)
    });
  } catch (error) {
    error.userMessage = `Failed to create meeting. (Details: ${error.message})`;
    throw error;
  }
}
async function apiFetchWithRetry(url, options, retries = 3, delay = 1000) {
    try {
        const response = await fetch(url, options);
        if (response.status >= 500 && retries > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
            return apiFetchWithRetry(url, options, retries - 1, delay * 2);
        }
        const responseData = await response.json();
        if (!response.ok) {
            const errorMessage = responseData.error?.message || `HTTP error! status: ${response.status}`;
            const error = new Error(errorMessage);
            if (response.status === 401 || response.status === 403) {
                 error.userMessage = `Permission denied. (Details: ${errorMessage})`;
            } else {
                 error.userMessage = `A service error occurred. (Details: ${errorMessage})`;
            }
            throw error;
        }
        return responseData;
    } catch (error) {
        if (!error.userMessage) {
            error.userMessage = `A network error occurred: ${error.message}`;
        }
        throw error;
    }
}


// =================================================================================
//                           PAGE & UTILITY FUNCTIONS
// =================================================================================

// THIS SECTION IS UNCHANGED FROM THE PREVIOUS VERSION.

async function injectScript(tabId, func, args) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, func: func, args: args });
  } catch(e) {
    const error = new Error('Script injection failed.');
    error.userMessage = 'Could not access the page to insert the link. This may be a protected browser page.';
    throw error;
  }
}
function showNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic', iconUrl: 'icons/icon128.png', title: title, message: message, priority: 2
  });
}
async function copyToClipboard(text) {
    if (!await chrome.offscreen.hasDocument()) {
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH, reasons: ['CLIPBOARD'],
            justification: 'Required to write to the system clipboard.',
        });
    }
    chrome.runtime.sendMessage({ type: 'copy-to-clipboard', target: 'offscreen', text: text });
}
function insertTextAtCursor(textToInsert) {
  const el = document.activeElement;
  if (!el || !textToInsert) return;
  if (el.isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(textToInsert));
    }
  } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const start = el.selectionStart, end = el.selectionEnd;
    el.value = el.value.substring(0, start) + textToInsert + el.value.substring(end);
    el.selectionStart = el.selectionEnd = start + textToInsert.length;
  }
}
function replacePlaceholder(placeholder, finalUrl) {
    const el = document.activeElement; if (!el) return;
    if (el.value?.includes(placeholder)) {
        el.value = el.value.replace(placeholder, finalUrl);
    } else if (el.isContentEditable && (el.textContent || "").includes(placeholder)) {
        el.innerHTML = el.innerHTML.replace(placeholder, `<a href="${finalUrl}">${finalUrl}</a>`);
    }
}
function removePlaceholder(placeholder) {
    const el = document.activeElement; if (!el) return;
    if (el.value?.includes(placeholder)) {
        el.value = el.value.replace(placeholder, '');
    } else if (el.isContentEditable && (el.textContent || "").includes(placeholder)) {
        el.innerHTML = el.innerHTML.replace(placeholder, '');
    }
}