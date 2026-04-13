(function initAppTheme(global) {
  "use strict";

  const OPERATOR_SESSION_KEY = "operatorSession";
  const PUBLIC_THEME_KEY = "publicEntryTheme";
  const SESSION_EVENT = "appauth:session";

  function parseThemeMode(mode) {
    const normalisedMode = String(mode || "").trim().toLowerCase();
    return normalisedMode === "dark" || normalisedMode === "light" || normalisedMode === "system"
      ? normalisedMode
      : null;
  }

  function parseDisplayTheme(mode) {
    const parsedMode = parseThemeMode(mode);
    return parsedMode === "dark" || parsedMode === "light" ? parsedMode : null;
  }

  function getBrowserPreferredTheme() {
    try {
      return global.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
    } catch (_error) {
      return "light";
    }
  }

  function normaliseTheme(mode) {
    return parseDisplayTheme(mode) || "light";
  }

  function normaliseOperatorTheme(mode) {
    return parseThemeMode(mode) || "system";
  }

  function resolveTheme(mode) {
    const selectedMode = normaliseOperatorTheme(mode);
    return selectedMode === "system" ? getBrowserPreferredTheme() : selectedMode;
  }

  function applyTheme(mode) {
    const resolvedMode = resolveTheme(mode);
    const root = global.document?.documentElement;
    if (!root) return resolvedMode;
    root.dataset.theme = resolvedMode;
    root.style.colorScheme = resolvedMode;
    return resolvedMode;
  }

  function readOperatorSession() {
    try {
      const raw = global.localStorage?.getItem(OPERATOR_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function getOperatorThemePreference(session = readOperatorSession(), preferences = getAppliedOperatorPreferences()) {
    return (
      parseThemeMode(preferences?.theme?.mode)
      || parseThemeMode(session?.user?.preferences?.theme?.mode)
      || "system"
    );
  }

  function resolveOperatorTheme(session = readOperatorSession(), preferences = getAppliedOperatorPreferences()) {
    return resolveTheme(getOperatorThemePreference(session, preferences));
  }

  function getOperatorThemeFromStorage() {
    return getOperatorThemePreference(readOperatorSession(), {});
  }

  function updateOperatorSessionTheme(mode) {
    const session = readOperatorSession();
    if (!session || typeof session !== "object") return;

    const nextSession = {
      ...session,
      user: {
        ...(session.user || {}),
        preferences: {
          ...(session.user?.preferences || {}),
          theme: { mode }
        }
      }
    };

    try {
      global.localStorage.setItem(OPERATOR_SESSION_KEY, JSON.stringify(nextSession));
    } catch (_error) {
      // Ignore storage failures and keep the in-memory/app preference in sync.
    }
  }

  function getAppliedOperatorPreferences() {
    return global.AppAuth?.getAppliedPreferences?.() || {};
  }

  async function persistOperatorTheme(mode) {
    const selectedMode = normaliseOperatorTheme(mode);
    const nextPreferences = {
      ...getAppliedOperatorPreferences(),
      theme: { mode: selectedMode }
    };

    global.AppAuth?.setAppliedPreferences?.(nextPreferences);
    updateOperatorSessionTheme(selectedMode);

    const token = global.AppAuth?.getToken?.();
    if (!token) return false;

    try {
      const response = await fetch(global.AppAuth?.PREFERENCES_API || "/api/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token
        },
        body: JSON.stringify({ preferences: nextPreferences }),
        keepalive: true
      });
      return response.ok;
    } catch (_error) {
      return false;
    }
  }

  function closeContainingMenu(node) {
    const group = node?.closest(".menu-group");
    if (group) group.open = false;
  }

  function renderOperatorThemeMenus() {
    const selectedTheme = getOperatorThemePreference();

    global.document.querySelectorAll("[data-theme-menu-root='operator']").forEach((container) => {
      container.querySelectorAll("[data-theme-option]").forEach((button) => {
        const isSelected = normaliseOperatorTheme(button.dataset.themeOption) === selectedTheme;
        button.classList.toggle("is-selected", isSelected);
        button.setAttribute("aria-pressed", isSelected ? "true" : "false");
        const check = button.querySelector(".menu-choice-check");
        if (check) check.textContent = isSelected ? "✓" : "";
      });
    });
  }

  function buildOperatorThemeMenu() {
    const wrapper = global.document.createElement("div");
    wrapper.className = "theme-menu-block";
    wrapper.dataset.themeMenuRoot = "operator";
    wrapper.innerHTML = `
      <div class="menu-field">
        <span class="menu-label">Theme</span>
        <div class="menu-choice-list" role="group" aria-label="Theme">
          <button type="button" class="menu-choice-button" data-theme-option="system" aria-pressed="false">
            <span class="menu-choice-check" aria-hidden="true"></span>
            <span>System</span>
          </button>
          <button type="button" class="menu-choice-button" data-theme-option="light" aria-pressed="false">
            <span class="menu-choice-check" aria-hidden="true"></span>
            <span>Light</span>
          </button>
          <button type="button" class="menu-choice-button" data-theme-option="dark" aria-pressed="false">
            <span class="menu-choice-check" aria-hidden="true"></span>
            <span>Dark</span>
          </button>
        </div>
      </div>
    `;

    wrapper.addEventListener("click", (event) => {
      const button = event.target.closest("[data-theme-option]");
      if (!button) return;

      const nextTheme = normaliseOperatorTheme(button.dataset.themeOption);
      applyTheme(nextTheme);
      renderOperatorThemeMenus();
      closeContainingMenu(wrapper);
      void persistOperatorTheme(nextTheme);
    });

    return wrapper;
  }

  function mountOperatorThemeMenus() {
    global.document.querySelectorAll(".user-menu-content").forEach((menuContent) => {
      if (menuContent.querySelector("[data-theme-menu-root='operator']")) return;

      const themeMenu = buildOperatorThemeMenu();
      const existingDivider = menuContent.querySelector(".menu-divider");
      const firstActionButton = menuContent.querySelector(".menu-item-button, .menu-item-link");
      if (existingDivider) {
        menuContent.insertBefore(themeMenu, existingDivider);
      } else if (firstActionButton) {
        menuContent.insertBefore(themeMenu, firstActionButton);
      } else {
        menuContent.appendChild(themeMenu);
      }
    });

    renderOperatorThemeMenus();
  }

  function getPublicTheme() {
    try {
      return normaliseTheme(global.sessionStorage?.getItem(PUBLIC_THEME_KEY));
    } catch (_error) {
      return "light";
    }
  }

  function setPublicTheme(mode) {
    const resolvedMode = applyTheme(mode);
    try {
      global.sessionStorage?.setItem(PUBLIC_THEME_KEY, resolvedMode);
    } catch (_error) {
      // Ignore session storage failures.
    }
    updatePublicThemeToggle();
    return resolvedMode;
  }

  function updatePublicThemeToggle() {
    const toggle = global.document.querySelector("[data-public-theme-toggle]");
    if (!toggle) return;

    const currentTheme = normaliseTheme(global.document.documentElement.dataset.theme || getPublicTheme());
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    toggle.dataset.themeNext = nextTheme;
    toggle.setAttribute("aria-label", `Switch to ${nextTheme} theme`);
    toggle.textContent = `Theme: ${currentTheme === "dark" ? "Dark" : "Light"}`;
  }

  function bindPublicThemeToggle() {
    const toggle = global.document.querySelector("[data-public-theme-toggle]");
    if (!toggle || toggle.dataset.themeBound === "1") return;

    toggle.dataset.themeBound = "1";
    updatePublicThemeToggle();
    toggle.addEventListener("click", () => {
      const nextTheme = normaliseTheme(toggle.dataset.themeNext);
      setPublicTheme(nextTheme);
    });
  }

  function syncOperatorThemeFromSession(session) {
    const nextTheme = resolveOperatorTheme(session);
    applyTheme(nextTheme);
    renderOperatorThemeMenus();
  }

  function init() {
    if (global.document.querySelector(".user-menu-content")) {
      mountOperatorThemeMenus();
      syncOperatorThemeFromSession(global.__APP_AUTH_BOOTSTRAP__ || null);
    }

    if (global.document.querySelector("[data-public-theme-toggle]")) {
      setPublicTheme(getPublicTheme());
      bindPublicThemeToggle();
    }
  }

  global.addEventListener(SESSION_EVENT, (event) => {
    syncOperatorThemeFromSession(event.detail || null);
  });

  global.addEventListener("storage", (event) => {
    if (event.key !== OPERATOR_SESSION_KEY) return;
    syncOperatorThemeFromSession(readOperatorSession());
  });

  try {
    const systemThemeMedia = global.matchMedia?.("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (getOperatorThemePreference() !== "system") return;
      applyTheme("system");
      renderOperatorThemeMenus();
    };

    systemThemeMedia?.addEventListener?.("change", handleSystemThemeChange);
    systemThemeMedia?.addListener?.(handleSystemThemeChange);
  } catch (_error) {
    // Ignore matchMedia listener failures.
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  global.AppTheme = {
    applyTheme,
    setPublicTheme,
    persistOperatorTheme,
    mountOperatorThemeMenus,
    normaliseTheme
  };
})(window);
