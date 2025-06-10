document.addEventListener('DOMContentLoaded', () => {
    const linksList = document.getElementById('links-list');
    const emptyMessage = document.getElementById('empty-message');
    const generateButton = document.getElementById('generate-button');

    loadRecentLinks();
    generateButton.addEventListener('click', handleGenerateClick);
    
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'linksUpdated') {
            loadRecentLinks();
        }
    });

    function handleGenerateClick() {
        generateButton.disabled = true;
        generateButton.textContent = 'Generating...';

        chrome.runtime.sendMessage({ type: 'generateLinkFromPopup' }, (response) => {
            if (response && response.success) {
                generateButton.textContent = 'Copied!';
                generateButton.classList.add('success');
            } else {
                generateButton.textContent = 'Error!';
                generateButton.classList.add('error');
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
                linksList.innerHTML = '';
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
        links.forEach(linkData => {
            const listItem = document.createElement('li');
            listItem.className = 'link-item';

            const infoDiv = document.createElement('div');
            infoDiv.className = 'link-info';
            
            const titleSpan = document.createElement('span');
            titleSpan.className = 'link-title';
            titleSpan.textContent = linkData.title;

            const urlSpan = document.createElement('span');
            urlSpan.className = 'link-url';
            urlSpan.textContent = linkData.url;

            const metaSpan = document.createElement('span');
            metaSpan.className = 'link-meta';
            metaSpan.textContent = `Generated: ${new Date(linkData.timestamp).toLocaleString()}`;
            
            infoDiv.appendChild(titleSpan);
            infoDiv.appendChild(urlSpan);
            infoDiv.appendChild(metaSpan);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'link-actions';

            const copyButton = document.createElement('button');
            copyButton.className = 'copy-button';
            copyButton.textContent = 'Copy';
            copyButton.addEventListener('click', (e) => {
                navigator.clipboard.writeText(linkData.url).then(() => {
                    e.target.textContent = 'Copied!';
                    e.target.classList.add('copied');
                    setTimeout(() => {
                        e.target.textContent = 'Copy';
                        e.target.classList.remove('copied');
                    }, 2000);
                });
            });

            const removeButton = document.createElement('button');
            removeButton.className = 'remove-button';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => {
                listItem.style.opacity = '0.5';
                chrome.runtime.sendMessage({ type: 'removeLink', urlToRemove: linkData.url });
            });
            
            actionsDiv.appendChild(copyButton);
            actionsDiv.appendChild(removeButton);

            listItem.appendChild(infoDiv);
            listItem.appendChild(actionsDiv);
            linksList.appendChild(listItem);
        });
    }
});