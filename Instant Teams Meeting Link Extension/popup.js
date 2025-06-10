document.addEventListener('DOMContentLoaded', () => {
    const linksList = document.getElementById('links-list');
    const emptyMessage = document.getElementById('empty-message');
    const generateButton = document.getElementById('generate-button');

    // Initial load of recent links
    loadRecentLinks();

    // Listen for the "Generate" button click
    generateButton.addEventListener('click', handleGenerateClick);
    
    // Listen for updates from the background script
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'linksUpdated') {
            console.log('Popup received linksUpdated message, reloading list.');
            loadRecentLinks();
        }
    });

    function handleGenerateClick() {
        generateButton.disabled = true;
        generateButton.textContent = 'Generating...';

        chrome.runtime.sendMessage({ type: 'generateLinkFromPopup' }, (response) => {
            if (response.success) {
                generateButton.textContent = 'Copied!';
                generateButton.classList.add('success');
                // The list will be reloaded automatically by the 'linksUpdated' message listener
            } else {
                generateButton.textContent = 'Error!';
                generateButton.classList.add('error');
                console.error('Popup received error:', response.message);
            }
            
            setTimeout(() => {
                generateButton.disabled = false;
                generateButton.textContent = 'Generate New Link';
                generateButton.classList.remove('success', 'error');
            }, 2500);
        });
    }
    
    function loadRecentLinks() {
        chrome.runtime.sendMessage({ type: 'getRecentLinks' }, (response) => {
            if (!response || chrome.runtime.lastError) {
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