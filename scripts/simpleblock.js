document.addEventListener('DOMContentLoaded', function () {
    const addRuleButton = document.getElementById("add_rule");
    const ruleList = document.getElementById("rule_list");
    const helpButton = document.getElementById("help");
    const toggleButton = document.getElementById("toggle");
    let ruleIndex = 0;

    loadToggleState();
    loadDataFromLocalStorage();

    /*
    ---------------------------------------------
                Event Listeners
    ---------------------------------------------
    */

    window.addEventListener('blur', function () {
        /*when the user clicks away and the extension window fades, a 'blur' event
        is triggered. We use this as a hacky way to know when to autosave */
        saveDataToLocalStorage();
    });

    toggleButton.addEventListener('change', function () {
        saveDataToLocalStorage();
    });

    helpButton.addEventListener('click', function () {
        openHelpTab();
    });

    addRuleButton.addEventListener('click', function () {
        let newRuleHtml =
        `<div class="rule d-flex py-2">
            <div class="d-block me-3 w-100">
                <label for="block_${ruleIndex}">Block</label>
                <input id="block_${ruleIndex}" type="text" class="form-control" placeholder="Enter block URL">
            </div>
            <div class="d-block w-100">
                <label for="redirect_${ruleIndex}">Redirect To</label>
                <input id="redirect_${ruleIndex}" type="text" class="form-control" placeholder="Enter redirect URL or blank">
            </div>

            <button type="button" id="remove_${ruleIndex}" class="btn btn-close ms-4 align-self-center mt-3" aria-label="Remove rule"></button>
        </div>`;

        ruleList.insertAdjacentHTML('beforeend', newRuleHtml);

        ruleIndex++;
    });


    ruleList.addEventListener('click', function (event) {
        const targetId = event.target.id;
        if (targetId.startsWith("remove_")) {
            const ruleIndexToRemove = targetId.replace("remove_", "");
            removeRule(ruleIndexToRemove);
        }
    });


    /*
    ---------------------------------------------
                Functions
    ---------------------------------------------
    */


    function loadToggleState() {
        const isEnabled = localStorage.getItem("enabled");
        if (isEnabled === "false") {
            toggleButton.checked = false;
        }
    }

    function openHelpTab() {
        browser.tabs.create({
            url: browser.extension.getURL('/redirect.html?help=1')
        });
    }


    function removeRule(index) {
        const ruleToRemove = document.getElementById(`block_${index}`).closest('.rule');
        const blockInput = ruleToRemove.querySelector('input[id^="block_"]').value;

        ruleToRemove.remove();
        localStorage.removeItem(blockInput);

        saveDataToLocalStorage();
    }

    function saveDataToLocalStorage() {
        const ruleElements = document.querySelectorAll('.rule');
        const rulesArray = [];

        // Iterate through .rule elements and save input pairs to the array
        for (let i = 0; i < ruleElements.length; i++) {
            const blockInput = ruleElements[i].querySelector('input[id^="block_"]');
            const redirectInput = ruleElements[i].querySelector('input[id^="redirect_"]');

            if (!blockInput || !redirectInput) { continue; }
            
            let blockVal = blockInput.value.trim();
            let redirectVal = redirectInput.value.trim();

            if (
                blockVal !== "" &&
                blockVal !== "*" &&
                blockVal !== redirectVal
            ) {

                if (!isValidURL(redirectVal)) {
                    // If not a valid URL, set URL redirect to null (will go to redirect.html)
                    redirectVal = "";
                }

                rulesArray.push({ block: blockVal, redirect: redirectVal });
                // console.log(`Rule saved: ${blockVal} => ${redirectVal}`);
            }
        }
        //save locally
        localStorage.setItem("ruleset", JSON.stringify(rulesArray));
        localStorage.setItem("enabled", toggleButton.checked);
    }

    function isValidURL(url) {
        // this isn't a true validator, but it does a good enough job for our purposes. If the user
        // enters a bad URL such as "example.co" they will simply not connect which is fine
        const protocols = ["https://", "http://", "ftp://"];
        let hasProtocol = false;

        // Check if the URL starts with a known protocol
        for (const protocol of protocols) {
            if (url.startsWith(protocol)) {
                hasProtocol = true;
                break;
            }
        }
        // If no protocol is found, prepend "https://"
        if (!hasProtocol) {
            url = "https://" + url;
        }

        // Check if the URL contains at least one "."
        if (!url.includes('.')) { return false }

        // Now finally, attempt to create the URL as a sanity check.
        try {
            new URL(url);
            return true;
        } catch (error) {
            return false;
        }

    }

    function loadDataFromLocalStorage() {
        const isEnabled = localStorage.getItem("enabled");

        if (isEnabled === "false") {
            toggleButton.checked = false;
        }

        // Load rules array from local storage
        const rulesArrayJson = localStorage.getItem("ruleset");
        if (rulesArrayJson) {
            const rulesArray = JSON.parse(rulesArrayJson);

            // Iterate through rules array and add them to the rule_list
            rulesArray.forEach(function (rule, index) {
                let newRuleHtml =
                    `<div class="rule d-flex py-2">
                        <div class="d-block me-3 w-100">
                            <label for="block_${index}">Block</label>
                            <input id="block_${index}" type="text" class="form-control" value="${rule.block}">
                        </div>
                        <div class="d-block w-100">
                            <label for="redirect_${index}">Redirect To</label>
                            <input id="redirect_${index}" type="text" class="form-control" placeholder="SimpleBlock" value="${rule.redirect}">
                        </div>
                    
                        <button type="button" id="remove_${index}" class="btn btn-close ms-4 align-self-center mt-3" aria-label="Remove rule"></button>
                    </div>`;

                ruleList.insertAdjacentHTML('beforeend', newRuleHtml);
                ruleIndex++;
            });
        }
    }



    /*
    ---------------------------------------------
                Debug
    ---------------------------------------------
    */


    const saveButton = document.getElementById("save");

    if (saveButton) {
        saveButton.addEventListener('click', function () {
            saveDataToLocalStorage();
        });
    }

    const debugButton = document.getElementById("debug");

    if (debugButton != null) {
        debugButton.addEventListener('click', function () {
            printLocalStorage();
            // clearLocalStorage();
        });

        function printLocalStorage() {
            const localStorageKeys = Object.keys(localStorage);
            localStorageKeys.forEach(function (key) {
                const value = localStorage.getItem(key);
                console.log(`${key}: ${value}`);
            });
        }

        function clearLocalStorage() {
            localStorage.clear();
            console.log("========LOCAL STORAGE CLEARED========");
        }

    }
    

});
