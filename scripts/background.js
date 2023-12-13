browser.webNavigation.onBeforeNavigate.addListener(details => {
    // If iframed/embed, we will allow it. Only handle if main frame.
    if (details.frameId === 0) {
        checkForBlock(details);
    }
}, {
    url: [{ urlMatches: ".*" }],
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tabInfo) => {
    if (changeInfo.url) {
        checkForBlock({ tabId, url: changeInfo.url });
    }
});


function checkForBlock(details) {
    const isEnabled = localStorage.getItem("enabled");

    if (isEnabled === "false") {
        // If disabled, proceed with the original request
        return { cancel: false };
    }

    const { tabId, url } = details;

    const ruleset = localStorage.getItem("ruleset");
    if (!ruleset) {
        // If no rules have been saved, proceed with the original request
        return { cancel: false };
    }

    const rules = JSON.parse(ruleset);
    for (const rule of rules) {
        if (doesURLMatch(url, rule.block)) {
            let redirectURL = rule.redirect;

            if (!redirectURL || redirectURL.trim() === '') {
                // Set to default if no redirect provided
                redirectURL = browser.extension.getURL('/redirect.html');
            } else if (!redirectURL.startsWith('moz-extension://') && !redirectURL.startsWith('http://') && !redirectURL.startsWith('https://')) {
                // Prepend 'https://' if it's missing, and not a local extension page (i.e. redirect.html)
                redirectURL = 'https://' + redirectURL;
            }

            // Redirect the current tab to the URL
            browser.tabs.update(tabId, { url: redirectURL });

            // Match found, prevent the original request
            return { cancel: true };
        }
    }

    // No match found, proceed with the original request
    return { cancel: false };
}



function doesURLMatch(currentURL, blockRule) {
    // Sanitize currentURL and blockRule
    currentURL = sanitizeURL(currentURL);
    blockRule = sanitizeURL(blockRule);
    let blockRuleWildCard = blockRule.endsWith('*');
    let url_matched = false;

    if (blockRuleWildCard) {
        blockRule = blockRule.slice(0, -1);
    }

    // Check if the currentURL contains the blockRule
    const containsBlockRule = currentURL.includes(blockRule);
    if (!containsBlockRule) {
        url_matched = false;
        return url_matched;
    }

    const remainingURL = currentURL.substring(currentURL.indexOf(blockRule) + blockRule.length);

    if (remainingURL === "" || blockRuleWildCard) {
        url_matched = true;
    } else {
        url_matched = false;
    }

    return url_matched;
}

function sanitizeURL(url) {
    if (url.endsWith("/")) {
        url = url.slice(0, -1);
    }

    // Remove protocol header (i.e. http, https)
    url = url.includes('//') ? url.slice(url.indexOf('//') + 2) : url;

    return url;
}
