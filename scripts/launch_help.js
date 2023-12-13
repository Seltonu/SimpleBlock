document.addEventListener('DOMContentLoaded', function () {
    // Function to check if the 'help' parameter is present and has a value of '1',
    // then we launch the help modal on page load.
    const showHelpModal = window.location.search.includes('help=1');

    if (showHelpModal) {
        const modal = new bootstrap.Modal(document.getElementById('help_modal'));
        modal.show();
    }
});
