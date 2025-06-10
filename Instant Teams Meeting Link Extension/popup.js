document.addEventListener('DOMContentLoaded', () => {
    const linksList = document.getElementById('links-list');
    const emptyMessage = document.getElementById('empty-message');

    // Request the recent links from the background script
    chrome.runtime.sendMessage({ type: 'getRecentLinks' }, (response) => {
        if (chrome.runtime.lastError) {
            console.error('Error getting recent links:', chrome.runtime.lastError);
            emptyMessage.textContent = 'Error loading links.';
            emptyMessage.classList.remove('hidden');
            return;
        }
        
        const links = response.links;
        if (links && links.length > 0) {
            renderLinks(links);
            emptyMessage.classList.add('hidden');
        } else {
            linksList.innerHTML = ''; // Clear any existing list items
            emptyMessage.classList.remove('hidden');
        }
    });

    /**
     * Renders the list of links in the popup.
     * @param {string[]} links - An array of meeting URL strings.
     */
    function renderLinks(links) {
        linksList.innerHTML = ''; // Clear the list before rendering
        links.forEach(link => {
            const listItem = document.createElement('li');
            listItem.className = 'link-item';

            const linkText = document.createElement('span');
            linkText.className = 'link-text';
            linkText.textContent = link;

            const copyButton = document.createElement('button');
            copyButton.className = 'copy-button';
            copyButton.textContent = 'Copy';

            copyButton.addEventListener('click', (event) => {
                // Use the modern clipboard API, which works in popups
                navigator.clipboard.writeText(link).then(() => {
                    // Provide feedback to the user
                    event.target.textContent = 'Copied!';
                    event.target.classList.add('copied');
                    setTimeout(() => {
                        event.target.textContent = 'Copy';
                        event.target.classList.remove('copied');
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy link from popup:', err);
                    // Optionally show an error state on the button
                    event.target.textContent = 'Error';
                });
            });

            listItem.appendChild(linkText);
            listItem.appendChild(copyButton);
            linksList.appendChild(listItem);
        });
    }
});