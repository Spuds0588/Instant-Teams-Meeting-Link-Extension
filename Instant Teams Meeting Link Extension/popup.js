document.addEventListener('DOMContentLoaded', () => {
    const linksList = document.getElementById('links-list');
    const emptyMessage = document.getElementById('empty-message');
    const generateButton = document.getElementById('generate-button');

    // Initial load of recent links
    loadRecentLinks();

    // Event listener for the generate button
    generateButton.addEventListener('click', () => {
        generateButton.disabled = true;
        generateButton.textContent = 'Generating...';

        chrome.runtime.sendMessage({ type: 'generateLinkFromPopup' }, (response) => {
            if (response.success) {
                generateButton.textContent = 'Copied!';
                generateButton.classList.add('success');
                // Refresh the list to show the new link
                loadRecentLinks();
            } else {
                generateButton.textContent = 'Error!';
                generateButton.classList.add('error');
                console.error('Popup received error:', response.message);
            }
            
            // Reset button state after a delay
            setTimeout(() => {
                generateButton.disabled = false;
                generateButton.textContent = 'Generate New Link';
                generateButton.classList.remove('success', 'error');
            }, 2500);
        });
    });

    /**
     * Fetches and renders the list of recent links.
     */
    function loadRecentLinks() {
        chrome.runtime.sendMessage({ type: 'getRecentLinks' }, (response) => {
            if (chrome.runtime.lastError) {
                emptyMessage.textContent = 'Error loading links.';
                emptyMessage.classList.remove('hidden');
                return;
            }
            
            const links = response.links;
            if (links && links.length > 0) {
                renderLinks(links);
                emptyMessage.classList.add('hidden');
            } else {
                linksList.innerHTML = '';
                emptyMessage.classList.remove('hidden');
            }
        });
    }

    /**
     * Renders the list items in the popup.
     * @param {string[]} links - Array of URL strings.
     */
    function renderLinks(links) {
        linksList.innerHTML = '';
        links.forEach(link => {
            const listItem = document.createElement('li');
            listItem.className = 'link-item';

            const linkText = document.createElement('span');
            linkText.className = 'link-text';
            linkText.textContent = link;

            const copyButton = document.createElement('button');
            copyButton.className = 'copy-button';
            copyButton.textContent = 'Copy';

            copyButton.addEventListener('click', (e) => {
                navigator.clipboard.writeText(link).then(() => {
                    e.target.textContent = 'Copied!';
                    e.target.classList.add('copied');
                    setTimeout(() => {
                        e.target.textContent = 'Copy';
                        e.target.classList.remove('copied');
                    }, 2000);
                });
            });

            listItem.appendChild(linkText);
            listItem.appendChild(copyButton);
            linksList.appendChild(listItem);
        });
    }
});