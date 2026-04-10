(function initLoginPortal() {
  "use strict";

  const els = {
    message: document.getElementById("login-message"),
    userInput: document.getElementById("login-username"),
    passwordInput: document.getElementById("login-password"),
    loginButton: document.getElementById("login-button"),
    error: document.getElementById("login-error")
  };

  const query = new URLSearchParams(window.location.search);
  const reason = (query.get("reason") || "").trim().toLowerCase();
  const requestedPath = (query.get("next") || "").trim();

  function setMessage() {
    if (reason === "denied") {
      els.message.textContent = "That page is not available for this account. Sign in to continue.";
      return;
    }
    if (reason === "remote_logout") {
      els.message.textContent = "You were logged off remotely. Sign in again to continue.";
      return;
    }
    if (reason === "signed_out") {
      els.message.textContent = "Your operator session ended. Sign in again to continue.";
      return;
    }
    els.message.textContent = "Sign in once, then open the views allowed for your account.";
  }

  function setError(message) {
    if (els.error) els.error.textContent = message || "";
  }

  function updatePortal(session) {
    window.AppAuth.applyAccessState(document, session?.user || null);
  }

  function getResolvedLandingPath(user) {
    return window.AppAuth.resolveLandingPath(user, requestedPath);
  }

  async function restoreSession() {
    const session = await window.AppAuth.refreshSession();
    updatePortal(session);
    if (session?.user) {
      window.location.replace(getResolvedLandingPath(session.user));
    }
  }

  async function login() {
    const username = (els.userInput?.value || "").trim();
    const password = els.passwordInput?.value || "";

    if (!username || !password) {
      setError("Username and password are required.");
      return;
    }

    setError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Login failed");
      }

      const session = window.AppAuth.saveSharedSession(data);
      localStorage.setItem("currencySymbol", data.currency || "£");
      updatePortal(session);
      const landingPath = getResolvedLandingPath(session.user);
      window.location.replace(landingPath);
    } catch (error) {
      setError(error.message || "Login failed");
    } finally {
      if (els.passwordInput) els.passwordInput.value = "";
    }
  }

  els.loginButton?.addEventListener("click", login);
  [els.userInput, els.passwordInput].forEach((input) => {
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") login();
    });
  });

  setMessage();
  updatePortal(null);
  void restoreSession();
})();
