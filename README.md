# Instant Teams Meeting Link - Chrome Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-2.1-brightgreen)](manifest.json)
[![Built With](https://img.shields.io/badge/Built%20With-Vanilla_JS-yellow)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

A lightweight and secure Chrome extension to instantly generate a Microsoft Teams meeting link from any text field on the web.

---

## 📖 About The Project

Frequent Microsoft Teams users often need to create impromptu meeting links while working in other web applications like email, project management tools, or CRMs. The standard workflow—switching to the Teams app, navigating menus, creating the meeting, copying the link, and switching back—is disruptive and time-consuming.

This browser extension streamlines that entire process into a single click. It provides a simple, secure, and incredibly fast way to generate a new Microsoft Teams meeting link and either insert it directly into your current workspace or access it from a clean popup UI.

### ✨ Key Features

*   **One-Click Generation:** Right-click in any editable text field (`<input>`, `<textarea>`, etc.) and select "Generate Teams Meeting Join Link".
*   **Instant Feedback:** See the text `*Generating meeting link...*` appear immediately, which is then replaced by the real meeting URL.
*   **Convenient Popup UI:**
    *   Click the extension icon to view a history of your last 3 generated meeting links.
    *   Each entry includes the page title and timestamp for easy identification.
    *   Generate new links directly from the popup.
    *   Easily copy links or remove them from your history.
*   **Secure Authentication:** Uses the official Microsoft Identity Platform (OAuth 2.0 PKCE Flow) for authentication. Your password is never seen, handled, or stored by the extension.
*   **Privacy-Focused:** No meeting data or personal information is ever sent to an external server. All generated link history is stored locally and securely on your computer.
*   **Zero Dependencies:** Built with 100% vanilla JavaScript, HTML, and CSS for maximum performance and security.

## 🚀 Installation

You can install the extension in one of two ways.

###  Chrome Web Store (For Regular Users)

> **Note:** The extension is not yet published. This section is a placeholder for when it is available on the Chrome Web Store.

1.  Navigate to the [Instant Teams Meeting Link]() page on the Chrome Web Store.
2.  Click "Add to Chrome".
3.  The first time you use it, you will be prompted to log in to your Microsoft account to grant the necessary permissions.

### 💻 Load Unpacked Extension (For Developers)

If you want to run the extension from the source code:

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/your-username/your-repo-name.git
    ```
2.  **Configure the extension:** Follow the **Configuration** steps below to set up your Azure application.
3.  **Load the extension in Chrome:**
    *   Open Google Chrome and navigate to `chrome://extensions`.
    *   Enable "Developer mode" using the toggle in the top-right corner.
    *   Click the "Load unpacked" button.
    *   Select the folder where you cloned the repository.

## 🛠️ Configuration (Required for Developers)

To use the Microsoft Graph API, you must register a free application in your Azure/Microsoft 365 tenant to get a Client ID.

1.  **Navigate to Azure Portal:** Go to [portal.azure.com](https://portal.azure.com/) and sign in.
2.  **Go to App Registrations:** Use the search bar to find and navigate to **App registrations**.
3.  **Create a New Registration:**
    *   Click **+ New registration**.
    *   **Name:** Give it a descriptive name, like `Chrome Extension Teams Link Generator`.
    *   **Supported account types:** Select **"Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**. This allows any user with a Microsoft account to use the extension.
    *   **Redirect URI:**
        *   Select **Single-page application (SPA)** from the dropdown menu.
        *   The Redirect URI must be in the format `https://<YOUR-EXTENSION-ID>.chromiumapp.org/`.
        *   To find your extension ID, first load the unpacked extension into Chrome (see developer installation steps). Then, go to `chrome://extensions`, find your extension, and copy its ID.
        *   Paste the full URI into the input box.
    *   Click **Register**.
4.  **Copy the Client ID:** On the app's overview page, copy the **Application (client) ID**.
5.  **Update `background.js`:**
    *   Open the `background.js` file in your code editor.
    *   Find the line: `const AZURE_APP_CLIENT_ID = 'YOUR_AZURE_APPLICATION_CLIENT_ID_GOES_HERE';`
    *   Replace the placeholder with the Client ID you just copied.
6.  **Set API Permissions:**
    *   In your app's page in the Azure Portal, go to the **API permissions** tab on the left menu.
    *   Click **+ Add a permission**, then select **Microsoft Graph**.
    *   Select **Delegated permissions**.
    *   Search for and add the following permissions:
        *   `OnlineMeetings.ReadWrite`
        *   `User.Read`
        *   `offline_access` (This is a standard OpenID permission)
    *   Click the **"Add permissions"** button at the bottom. Admin consent is not required for these permissions.

You are now ready to use the extension locally!

## 📂 Project Structure

The project uses Manifest V3 and is organized as follows:

*   `manifest.json`: The core configuration file for the Chrome extension. Defines permissions, scripts, and properties.
*   `background.js`: The extension's service worker. It handles all core logic, including authentication, API calls to Microsoft Graph, context menu creation, and event handling.
*   `popup.html`: The HTML structure for the popup UI that appears when you click the extension icon.
*   `popup.js`: The JavaScript that powers the popup. It fetches recent links from the background script, renders the list, and handles user interactions like copying or removing links.
*   `popup.css`: The stylesheet for the popup UI, including the custom color palette.
*   `icons/`: A directory containing the 16x16, 48x48, and 128x128 pixel icons for the extension.

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

1.  **Fork** the Project
2.  Create your Feature **Branch** (`git checkout -b feature/AmazingFeature`)
3.  **Commit** your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  **Push** to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a **Pull Request**

## 🛡️ Privacy Policy

This extension is built with privacy as a priority.

*   **Authentication:** All authentication is handled by Microsoft's official login pages. This extension **never** sees, stores, or transmits your password.
*   **Data Usage:** The extension only requests the minimum permissions required to function: creating meetings (`OnlineMeetings.ReadWrite`) and reading your name to personalize the meeting subject (`User.Read`).
*   **Data Storage:** The extension stores two types of data, both **only on your local computer**:
    1.  **OAuth Tokens:** The authentication tokens provided by Microsoft are stored securely in `chrome.storage.local` so you don't have to log in every time.
    2.  **Meeting History:** The last 3 generated meeting links (including the page title and timestamp) are stored in `chrome.storage.local` to power the popup UI. This data is never transmitted anywhere.
*   **No External Servers:** This extension communicates only with the Microsoft Graph API. There are no third-party servers involved.

## 📄 License

Distributed under the MIT License. See `LICENSE` file for more information. (You will need to create a `LICENSE` file in your repository and paste the standard MIT license text into it).
