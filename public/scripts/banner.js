    const messageBanner = document.createElement("div");
        const API = "/api"

    messageBanner.id = "message-banner";
    document.body.appendChild(messageBanner);

    // Function to show messages with different types
    function showMessage(message, type = "info") { // success, error, info
        messageBanner.textContent = message;
        messageBanner.className = `message-banner ${type}`;
        messageBanner.style.display = "block";
        messageBanner.style.opacity = "1";

        setTimeout(() => {
            messageBanner.style.transition = "opacity 1s";
            messageBanner.style.opacity = "0";
        }, 3000);

        setTimeout(() => {
            messageBanner.style.display = "none";
        }, 3000);
    }

    // Helper function to attach build version info
    
        (async function attachBuildVersion() {
        const el = document.getElementById('build-version');
        if (!el) return; // nothing to do

        try {
            const res = await fetch(`${API}/version`, { cache: 'no-store' });
            const data = await res.json();
            el.textContent = `Server connected (v${data.backend}, db schema ${data.schema})`;
        } catch (e) {
            el.textContent = `Error connecting to server`;
        }
    })();