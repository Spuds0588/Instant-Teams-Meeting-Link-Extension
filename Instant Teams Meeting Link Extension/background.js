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

// =================================================================================
//                            EXTENSION SETUP
// =================================================================================

// Create the context menu item upon installation.
chrome.runtime.onInstalled.addListener(() => {
  // Check if the required Client ID has been set.
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
    // Acknowledge the click and start the process
    console.log('Context menu clicked. Starting process.');
    generateMeetingLink(tab.id);
  }
});

// =================================================================================
//                             MAIN LOGIC FLOW
// =================================================================================

async function generateMeetingLink(tabId) {
  try {
    // 1. Check for network connectivity
    if (!navigator.onLine) {
        console.error('Network offline.');
        throw new Error('Network connection unavailable. Please check your connection and try again.');
    }
    
    // 2. Provide instant feedback by inserting a placeholder
    console.log('Injecting placeholder text...');
    await injectScript(tabId, insertTextAtCursor, [PLACEHOLDER_TEXT]);

    // 3. Get a valid auth token (handles login, refresh, etc.)
    console.log('Attempting to get auth token...');
    const token = await getAuthToken(true); // true = interactive login allowed
    if (!token) {
        console.error('Failed to get auth token.');
        throw new Error('Authentication failed. Could not retrieve a valid token.');
    }
    console.log('Successfully retrieved auth token.');

    // 4. Get user's display name from Microsoft Graph
    console.log("Fetching user's display name...");
    const userDisplayName = await getUserDisplayName(token);
    console.log(`User display name: ${userDisplayName}`);

    // 5. Create the Teams meeting via Microsoft Graph API
    console.log('Creating Teams meeting...');
    const meetingDetails = await createTeamsMeeting(token, userDisplayName);
    console.log('Meeting created successfully.');

    // 6. Copy the meeting URL to the clipboard
    console.log('Copying link to clipboard...');
    await copyToClipboard(meetingDetails.joinUrl);
    console.log('Link copied to clipboard.');

    // 7. Replace the placeholder text with the actual meeting URL
    console.log('Replacing placeholder with final URL...');
    await injectScript(tabId, replacePlaceholder, [PLACEHOLDER_TEXT, meetingDetails.joinUrl]);
    console.log('Process complete.');

  } catch (error) {
    console.error('Error in generateMeetingLink flow:', error.message || error);
    // On any failure, remove the placeholder text from the page
    await injectScript(tabId, removePlaceholder, [PLACEHOLDER_TEXT]).catch(err => 
        console.error('Failed to remove placeholder after an error:', err)
    );
    
    // And show a user-friendly notification
    let userMessage = error.userMessage || 'An unexpected error occurred. Please try again.';
    showNotification('error-notification', 'Error', userMessage);
  }
}

// =================================================================================
//                         AUTHENTICATION (OAuth 2.0 with PKCE)
// =================================================================================

/**
 * Gets a valid access token, handling interactive login and token refresh.
 * @param {boolean} interactive - If true, will prompt user to log in if needed.
 * @returns {Promise<string|null>} The access token or null if it fails.
 */
async function getAuthToken(interactive) {
  try {
    const tokenInfo = await chrome.storage.local.get(['accessToken', 'refreshToken', 'tokenExpires']);
    
    // If a valid, unexpired token exists, return it.
    if (tokenInfo.accessToken && tokenInfo.tokenExpires && new Date(tokenInfo.tokenExpires) > new Date()) {
      console.log('Found valid access token in storage.');
      return tokenInfo.accessToken;
    }

    // If token is expired but we have a refresh token, use it.
    if (tokenInfo.refreshToken) {
      console.log('Access token expired. Attempting to refresh...');
      return await refreshAccessToken(tokenInfo.refreshToken);
    }
    
    // If no tokens exist and interactive mode is on, start the login flow.
    if (interactive) {
      console.log('No valid tokens. Starting interactive login.');
      return await performInteractiveLogin();
    }

    // If not interactive, and no valid token, we can't proceed.
    console.log('No valid token and not in interactive mode.');
    return null;

  } catch (error) {
    console.error('Error in getAuthToken:', error);
    const customError = new Error('Authentication process failed.');
    customError.userMessage = 'Could not authenticate with Microsoft. Please try again.';
    throw customError;
  }
}


/**
 * Initiates the full user-interactive OAuth 2.0 PKCE flow.
 * @returns {Promise<string>} The new access token.
 */
async function performInteractiveLogin() {
    // PKCE: Generate code verifier and challenge
    const { verifier, challenge } = await generatePkceChallenge();
    const redirectUri = chrome.identity.getRedirectURL();
    
    // Construct the authorization URL
    const authUrl = new URL(MS_AUTH_ENDPOINT);
    authUrl.searchParams.append('client_id', AZURE_APP_CLIENT_ID);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', MS_GRAPH_SCOPES.join(' '));
    authUrl.searchParams.append('code_challenge', challenge);
    authUrl.searchParams.append('code_challenge_method', 'S256');
    authUrl.searchParams.append('prompt', 'select_account'); // Force user to select account

    // Launch the web auth flow
    const resultUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.href,
        interactive: true,
    });
    
    if (chrome.runtime.lastError || !resultUrl) {
      throw new Error(`Login failed or was cancelled by user. ${chrome.runtime.lastError?.message || ''}`);
    }

    // Exchange authorization code for tokens
    const authCode = new URL(resultUrl).searchParams.get('code');
    if (!authCode) {
      throw new Error('Could not extract authorization code from redirect.');
    }
    
    return await exchangeCodeForTokens(authCode, verifier, redirectUri);
}

/**
 * Exchanges an authorization code for access and refresh tokens.
 * @param {string} authCode - The authorization code.
 * @param {string} codeVerifier - The PKCE code verifier.
 * @param {string} redirectUri - The redirect URI used in the initial request.
 * @returns {Promise<string>} The new access token.
 */
async function exchangeCodeForTokens(authCode, codeVerifier, redirectUri) {
    const tokenRequestBody = new URLSearchParams({
        client_id: AZURE_APP_CLIENT_ID,
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
    });

    const response = await fetch(MS_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenRequestBody,
    });

    const tokenData = await response.json();
    if (!response.ok) {
        throw new Error(`Token exchange failed: ${tokenData.error_description || response.statusText}`);
    }

    // Store the new tokens securely
    await storeTokens(tokenData);
    return tokenData.access_token;
}

/**
 * Uses a refresh token to get a new access token.
 * @param {string} refreshToken - The refresh token.
 * @returns {Promise<string>} The new access token.
 */
async function refreshAccessToken(refreshToken) {
    const tokenRequestBody = new URLSearchParams({
        client_id: AZURE_APP_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: MS_GRAPH_SCOPES.join(' '),
    });

    try {
        const response = await fetch(MS_TOKEN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenRequestBody,
        });

        const tokenData = await response.json();
        if (!response.ok) {
            console.error('Refresh token failed. User must log in again.', tokenData);
            // Clear invalid tokens
            await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenExpires']);
            const authError = new Error('Session expired.');
            authError.userMessage = "Your session has expired. Please try again to log back in to your Microsoft account.";
            throw authError;
        }
        
        console.log('Successfully refreshed access token.');
        await storeTokens(tokenData);
        return tokenData.access_token;
    } catch (error) {
        console.error('Error refreshing token:', error);
        throw error; // Re-throw to be caught by the main handler
    }
}


/**
 * Stores tokens and expiry time in local storage.
 * @param {object} tokenData - The token data from the API response.
 */
async function storeTokens(tokenData) {
    const expiryTime = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    await chrome.storage.local.set({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpires: expiryTime,
    });
    console.log('Tokens stored successfully.');
}


// --- PKCE Helper Functions ---

async function generatePkceChallenge() {
    const verifier = generateRandomString(128);
    const challenge = await sha256(verifier);
    const base64UrlChallenge = base64UrlEncode(challenge);
    return { verifier, challenge: base64UrlChallenge };
}

function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let text = '';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(buffer) {
    // Regular base64 encode
    let base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    // Make it URL-safe
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}


// =================================================================================
//                            MICROSOFT GRAPH API CALLS
// =================================================================================

/**
 * Fetches the user's display name from Graph API.
 * @param {string} token - The access token.
 * @returns {Promise<string>} The user's display name.
 */
async function getUserDisplayName(token) {
  try {
    const response = await apiFetchWithRetry(MS_GRAPH_ME_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.displayName;
  } catch (error) {
    console.error('Failed to fetch user display name:', error);
    error.userMessage = `Failed to get user profile. (Details: ${error.message})`;
    throw error;
  }
}

/**
 * Creates an instant Teams meeting.
 * @param {string} token - The access token.
 * @param {string} displayName - The user's display name for the meeting subject.
 * @returns {Promise<object>} The meeting details object from the API.
 */
async function createTeamsMeeting(token, displayName) {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  const meetingData = {
    startDateTime: now.toISOString(),
    endDateTime: oneHourFromNow.toISOString(),
    subject: `Meeting with ${displayName}`
  };
  
  try {
    return await apiFetchWithRetry(MS_GRAPH_ONLINE_MEETINGS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(meetingData)
    });
  } catch (error) {
    console.error('Failed to create Teams meeting:', error);
    error.userMessage = `Failed to create meeting. (Details: ${error.message})`;
    throw error;
  }
}

/**
 * A wrapper for fetch that includes authorization and retry logic.
 * @param {string} url - The API endpoint URL.
 * @param {object} options - The options for the fetch call.
 * @param {number} retries - Number of retries remaining.
 * @returns {Promise<object>} The JSON response.
 */
async function apiFetchWithRetry(url, options, retries = 3, delay = 1000) {
    try {
        const response = await fetch(url, options);

        if (response.status >= 500 && retries > 0) {
            console.warn(`API call failed with status ${response.status}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return apiFetchWithRetry(url, options, retries - 1, delay * 2);
        }

        const responseData = await response.json();
        
        if (!response.ok) {
            const errorMessage = responseData.error?.message || `HTTP error! status: ${response.status}`;
            const error = new Error(errorMessage);
            
            // Handle specific auth/permission errors
            if (response.status === 401 || response.status === 403) {
                 error.userMessage = `Permission denied. Please ensure the extension has the required permissions in Azure. (Details: ${errorMessage})`;
            } else {
                 error.userMessage = `A service error occurred. (Details: ${errorMessage})`;
            }
            throw error;
        }

        return responseData;

    } catch (error) {
        // Re-throw network errors or previously constructed errors
        if (!error.userMessage) {
            error.userMessage = `A network error occurred while contacting Microsoft services: ${error.message}`;
        }
        throw error;
    }
}

// =================================================================================
//                           PAGE & UTILITY FUNCTIONS
// =================================================================================

/**
 * Injects and executes a function in the context of the active page.
 * @param {number} tabId - The ID of the target tab.
 * @param {Function} func - The function to execute.
 * @param {Array} args - Arguments to pass to the function.
 */
async function injectScript(tabId, func, args) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: func,
      args: args
    });
  } catch(e) {
    console.error(`Failed to inject script into tab ${tabId}:`, e);
    // This can happen if the page is a protected chrome:// page, etc.
    const error = new Error('Script injection failed.');
    error.userMessage = 'Could not access the page to insert the link. This may be a protected browser page.';
    throw error;
  }
}

/**
 * Displays a system notification to the user.
 * @param {string} id - A unique ID for the notification.
 * @param {string} title - The title of the notification.
 * @param {string} message - The body text of the notification.
 */
function showNotification(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message,
    priority: 2
  });
}

/**
 * Manages an offscreen document to perform clipboard operations.
 * @param {string} text - The text to copy to the clipboard.
 */
async function copyToClipboard(text) {
    // Check if an offscreen document already exists
    const hasDocument = await chrome.offscreen.hasDocument();
    if (!hasDocument) {
        await chrome.offscreen.createDocument({
            url: OFFSCREEN_DOCUMENT_PATH,
            reasons: ['CLIPBOARD'],
            justification: 'Required to write to the system clipboard.',
        });
    }
    // Send the text to the offscreen document to be copied
    chrome.runtime.sendMessage({
        type: 'copy-to-clipboard',
        target: 'offscreen',
        text: text
    });
}


// =================================================================================
//                        INJECTABLE CONTENT SCRIPT FUNCTIONS
//
// These functions are NOT called directly. They are passed to executeScript
// to run in the context of the webpage. They must be self-contained.
// =================================================================================

/**
 * Injects text at the current cursor position in an editable element.
 * @param {string} textToInsert - The text to be inserted.
 */
function insertTextAtCursor(textToInsert) {
  const el = document.activeElement;
  if (!el || !textToInsert) return;

  const isContentEditable = el.isContentEditable;
  const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';

  if (isInput) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = el.value.substring(0, start) + textToInsert + el.value.substring(end);
    el.selectionStart = el.selectionEnd = start + textToInsert.length;
  } else if (isContentEditable) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(textToInsert));
    }
  }
}


/**
 * Finds and replaces placeholder text within the active element.
 * @param {string} placeholder - The placeholder text to find.
 * @param {string} finalUrl - The final URL to replace it with.
 */
function replacePlaceholder(placeholder, finalUrl) {
    const el = document.activeElement;
    if (!el) return;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.value.includes(placeholder)) {
            el.value = el.value.replace(placeholder, finalUrl);
        }
    } else if (el.isContentEditable) {
        // A more robust way for contenteditable might be needed, but this is simple and effective.
        const elText = el.textContent || "";
        if (elText.includes(placeholder)) {
            // This is a simple replacement. For complex HTML structures, this could be fragile.
            el.innerHTML = el.innerHTML.replace(placeholder, `<a href="${finalUrl}">${finalUrl}</a>`);
        }
    }
}

/**
 * Finds and removes placeholder text within the active element.
 * @param {string} placeholder - The placeholder text to remove.
 */
function removePlaceholder(placeholder) {
    const el = document.activeElement;
    if (!el) return;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.value.includes(placeholder)) {
            el.value = el.value.replace(placeholder, '');
        }
    } else if (el.isContentEditable) {
        const elText = el.textContent || "";
        if (elText.includes(placeholder)) {
            el.innerHTML = el.innerHTML.replace(placeholder, '');
        }
    }
}