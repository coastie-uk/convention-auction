    const messageBanner = document.createElement("div");
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