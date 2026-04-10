(function initSessionAuth(global) {
  "use strict";

  const API = "/api";
  const STORAGE_KEY = "operatorSession";
  const LAST_VIEW_KEY = "operatorLastView";
  const LOGOUT_KEY = "operatorLogoutEvent";
  const KIOSK_KEY = "slideshowKioskSession";
  const SESSION_EVENT = "appauth:session";
  const SESSION_REFRESH_MS = 60000;
  const LEGACY_TOKEN_KEYS = ["token", "cashierToken", "maintenanceToken"];
  const ACCESS_LABELS = Object.freeze({
    admin: "Manage Items",
    cashier: "Manage Payments",
    maintenance: "Manage Auctions",
    live_feed: "Manage Collections",
    admin_bidding: "Manage Bids",
    slideshow: "Slideshow",
    manage_users: "Manage Users"
  });
  const ACCESS_ORDER = Object.freeze([
    "admin",
    "cashier",
    "maintenance",
    "live_feed",
    "admin_bidding",
    "manage_users",
    "slideshow"
  ]);
  const VIEWS = Object.freeze([
    { key: "admin", path: "/admin/index.html", role: "admin" },
    { key: "cashier", path: "/cashier/index.html", role: "cashier" },
    { key: "maintenance", path: "/maint/index.html", role: "maintenance" },
    { key: "live_feed", path: "/cashier/live-feed.html", permission: "live_feed" },
    { key: "slideshow", path: "/slideshow/index.html", role: "slideshow" }
  ]);

  function safeParse(value) {
    if (!value || typeof value !== "string") return null;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function normaliseStringList(values) {
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  function normaliseUser(user) {
    const roles = normaliseStringList(user?.roles);
    const permissions = normaliseStringList(user?.permissions);
    return {
      username: user?.username || null,
      role: user?.role || roles[0] || null,
      roles,
      permissions,
      is_root: Number(user?.is_root) === 1 ? 1 : 0
    };
  }

  function getDefaultLandingPath(user) {
    const view = VIEWS.find((candidate) => hasViewAccess(user, candidate));
    return view?.path || "/login.html";
  }

  function normaliseSession(payload) {
    if (!payload || typeof payload.token !== "string" || !payload.token.trim()) return null;
    const user = normaliseUser(payload.user || payload);
    return {
      token: payload.token,
      user,
      versions: payload.versions || null,
      landing_path: payload.landing_path || getDefaultLandingPath(user)
    };
  }

  function setLegacyTokenMirrors(token) {
    LEGACY_TOKEN_KEYS.forEach((key) => {
      if (token) {
        localStorage.setItem(key, token);
      } else {
        localStorage.removeItem(key);
      }
    });
  }

  function getSharedSession() {
    return normaliseSession(safeParse(localStorage.getItem(STORAGE_KEY)));
  }

  function getKioskSession() {
    return normaliseSession(safeParse(sessionStorage.getItem(KIOSK_KEY)));
  }

  function saveSharedSession(payload) {
    const session = normaliseSession(payload);
    if (!session) return null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    setLegacyTokenMirrors(session.token);
    global.__APP_SESSION__ = session;
    return session;
  }

  function saveKioskSession(payload) {
    const session = normaliseSession(payload);
    if (!session) return null;
    sessionStorage.setItem(KIOSK_KEY, JSON.stringify(session));
    global.__APP_KIOSK_SESSION__ = session;
    return session;
  }

  function clearKioskSession() {
    sessionStorage.removeItem(KIOSK_KEY);
    delete global.__APP_KIOSK_SESSION__;
  }

  function clearSharedSession({ broadcast = true } = {}) {
    localStorage.removeItem(STORAGE_KEY);
    setLegacyTokenMirrors(null);
    delete global.__APP_SESSION__;
    if (broadcast) {
      localStorage.setItem(LOGOUT_KEY, String(Date.now()));
    }
  }

  function clearAllSessions({ broadcast = true } = {}) {
    clearKioskSession();
    clearSharedSession({ broadcast });
  }

  function getLegacyTokenSession() {
    for (const key of LEGACY_TOKEN_KEYS) {
      const token = localStorage.getItem(key);
      if (token) return { token };
    }
    return null;
  }

  async function validateToken(token) {
    const response = await fetch(`${API}/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || "Session expired");
      error.reason = data?.reason || "";
      throw error;
    }
    return data;
  }

  async function refreshSession({ allowKiosk = false, propagateError = false } = {}) {
    const shared = getSharedSession() || getLegacyTokenSession();
    if (shared?.token) {
      try {
        const validated = await validateToken(shared.token);
        const session = saveSharedSession(validated);
        return session ? { ...session, scope: "shared" } : null;
      } catch (error) {
        clearSharedSession({ broadcast: false });
        if (propagateError) throw error;
      }
    }

    if (!allowKiosk) return null;

    const kiosk = getKioskSession();
    if (!kiosk?.token) return null;

    try {
      const validated = await validateToken(kiosk.token);
      const session = saveKioskSession(validated);
      return session ? { ...session, scope: "kiosk" } : null;
    } catch (error) {
      clearKioskSession();
      if (propagateError) throw error;
      return null;
    }
  }

  function hasRole(user, role) {
    return normaliseUser(user).roles.includes(String(role || "").trim().toLowerCase());
  }

  function hasPermission(user, permission) {
    return normaliseUser(user).permissions.includes(String(permission || "").trim().toLowerCase());
  }

  function getAccessKeys(user) {
    const normalized = normaliseUser(user);
    const combined = [...normalized.roles, ...normalized.permissions];
    const seen = new Set();
    return ACCESS_ORDER.filter((key) => {
      if (!combined.includes(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getAccessLabels(user) {
    const keys = getAccessKeys(user);
    return keys.map((key) => ACCESS_LABELS[key] || key);
  }

  function hasViewAccess(user, view) {
    if (!user || !view) return false;
    if (view.role) return hasRole(user, view.role);
    if (view.permission) return hasPermission(user, view.permission);
    return false;
  }

  function canAccess(user, access = {}) {
    if (access.viewKey) {
      const mappedView = VIEWS.find((candidate) => candidate.key === access.viewKey);
      return hasViewAccess(user, mappedView);
    }
    if (access.role && !hasRole(user, access.role)) return false;
    if (access.permission && !hasPermission(user, access.permission)) return false;
    return true;
  }

  function describeAccess(user) {
    const labels = getAccessLabels(user);
    return labels.length ? labels.join(", ") : "No assigned access";
  }

  function rememberView(viewKey) {
    if (!viewKey) return;
    if (viewKey === "slideshow") {
      localStorage.removeItem(LAST_VIEW_KEY);
      return;
    }
    localStorage.setItem(LAST_VIEW_KEY, viewKey);
  }

  function getStoredView() {
    const viewKey = (localStorage.getItem(LAST_VIEW_KEY) || "").trim();
    if (!viewKey || viewKey === "slideshow") {
      if (viewKey === "slideshow") {
        localStorage.removeItem(LAST_VIEW_KEY);
      }
      return null;
    }
    return VIEWS.find((view) => view.key === viewKey) || null;
  }

  function getPathView(pathname) {
    const cleanedPath = String(pathname || "").replace(/\/+$/, "") || "/";
    return VIEWS.find((view) => view.path.replace(/\/+$/, "") === cleanedPath) || null;
  }

  function resolveLandingPath(user, preferredPath = "") {
    const preferredView = getPathView(preferredPath);
    if (preferredView && hasViewAccess(user, preferredView)) return preferredView.path;

    const storedView = getStoredView();
    if (storedView && hasViewAccess(user, storedView)) return storedView.path;

    return getDefaultLandingPath(user);
  }

  function disableAnchor(anchor) {
    if (!anchor.dataset.disabledHref && anchor.hasAttribute("href")) {
      anchor.dataset.disabledHref = anchor.getAttribute("href");
    }
    anchor.removeAttribute("href");
    anchor.setAttribute("aria-disabled", "true");
    anchor.classList.add("is-disabled-access");
    if (!anchor.dataset.accessBound) {
      anchor.addEventListener("click", (event) => {
        if (anchor.getAttribute("aria-disabled") === "true") {
          event.preventDefault();
        }
      });
      anchor.dataset.accessBound = "1";
    }
  }

  function enableAnchor(anchor) {
    if (anchor.dataset.disabledHref) {
      anchor.setAttribute("href", anchor.dataset.disabledHref);
    }
    anchor.setAttribute("aria-disabled", "false");
    anchor.classList.remove("is-disabled-access");
  }

  function applyAccessState(root, user) {
    if (!root) return;
    root.querySelectorAll("[data-access-role], [data-access-permission]").forEach((element) => {
      const access = {
        role: element.dataset.accessRole || "",
        permission: element.dataset.accessPermission || ""
      };
      const allowed = canAccess(user, access);

      if (element.tagName === "A") {
        if (allowed) {
          enableAnchor(element);
        } else {
          disableAnchor(element);
        }
        return;
      }

      if ("disabled" in element) {
        element.disabled = !allowed;
      }
      element.classList.toggle("is-disabled-access", !allowed);
      if (!allowed) {
        element.setAttribute("aria-disabled", "true");
      } else {
        element.removeAttribute("aria-disabled");
      }
    });
  }

  function redirectToLogin({ reason = "", next = "" } = {}) {
    const url = new URL("/login.html", global.location.origin);
    const redirectTarget = next || `${global.location.pathname}${global.location.search}`;
    if (reason) url.searchParams.set("reason", reason);
    if (redirectTarget) url.searchParams.set("next", redirectTarget);
    global.location.replace(`${url.pathname}${url.search}`);
  }

  function getCurrentScope() {
    return global.__APP_AUTH_BOOTSTRAP__?.scope
      || (getKioskSession() ? "kiosk" : null)
      || (getSharedSession() ? "shared" : null);
  }

  function installLogoutSync() {
    if (global.__APP_LOGOUT_SYNC_BOUND__) return;
    global.__APP_LOGOUT_SYNC_BOUND__ = true;

    global.addEventListener("storage", (event) => {
      if (getCurrentScope() === "kiosk") return;

      if (event.key === LOGOUT_KEY) {
        redirectToLogin({ reason: "signed_out" });
        return;
      }

      if (event.key === STORAGE_KEY && !event.newValue) {
        redirectToLogin({ reason: "signed_out" });
      }
    });
  }

  function publishSession(session, config = {}) {
    if (!session) return null;
    global.__APP_AUTH_BOOTSTRAP__ = { ...session, config: config || {} };
    global.dispatchEvent(new CustomEvent(SESSION_EVENT, {
      detail: global.__APP_AUTH_BOOTSTRAP__
    }));
    return global.__APP_AUTH_BOOTSTRAP__;
  }

  function stopSessionRefresh() {
    if (!global.__APP_SESSION_REFRESH_TIMER__) return;
    global.clearInterval(global.__APP_SESSION_REFRESH_TIMER__);
    delete global.__APP_SESSION_REFRESH_TIMER__;
  }

  function expireProtectedSession(scope, reason = "signed_out") {
    stopSessionRefresh();
    if (scope === "kiosk") {
      clearKioskSession();
    } else {
      clearSharedSession({ broadcast: true });
    }
    redirectToLogin({ reason });
  }

  async function refreshProtectedPage(config) {
    let session = null;
    try {
      session = await refreshSession({ allowKiosk: Boolean(config?.allowKiosk), propagateError: true });
    } catch (error) {
      const redirectReason = error?.reason === "remote_logout" ? "remote_logout" : "signed_out";
      expireProtectedSession(global.__APP_AUTH_BOOTSTRAP__?.scope || "shared", redirectReason);
      return null;
    }
    if (!session) {
      expireProtectedSession(global.__APP_AUTH_BOOTSTRAP__?.scope || "shared");
      return null;
    }

    if (!canAccess(session.user, config?.access || { viewKey: config?.viewKey })) {
      if (session.scope === "kiosk") {
        clearKioskSession();
      } else {
        clearSharedSession({ broadcast: true });
      }
      stopSessionRefresh();
      redirectToLogin({ reason: "signed_out" });
      return null;
    }

    if (config?.viewKey) rememberView(config.viewKey);
    applyAccessState(global.document, session.user);
    return publishSession(session, config);
  }

  function startSessionRefresh(config) {
    stopSessionRefresh();
    global.__APP_SESSION_REFRESH_TIMER__ = global.setInterval(() => {
      refreshProtectedPage(config).catch((error) => {
        expireProtectedSession(
          global.__APP_AUTH_BOOTSTRAP__?.scope || "shared",
          error?.reason === "remote_logout" ? "remote_logout" : "signed_out"
        );
      });
    }, SESSION_REFRESH_MS);
  }

  async function protectPage(config) {
    const session = await refreshProtectedPage(config);
    if (!session) return null;
    installLogoutSync();
    startSessionRefresh(config);
    return session;
  }

  function startSlideshowKiosk() {
    const shared = getSharedSession();
    if (!shared || !canAccess(shared.user, { role: "slideshow" })) return null;
    const kiosk = saveKioskSession(shared);
    clearSharedSession({ broadcast: true });
    return publishSession({ ...kiosk, scope: "kiosk" }, global.__APP_AUTH_BOOTSTRAP__?.config || {});
  }

  function getToken() {
    return global.__APP_AUTH_BOOTSTRAP__?.token
      || getSharedSession()?.token
      || getKioskSession()?.token
      || null;
  }

  global.AppAuth = {
    API,
    STORAGE_KEY,
    LAST_VIEW_KEY,
    LOGOUT_KEY,
    KIOSK_KEY,
    SESSION_EVENT,
    SESSION_REFRESH_MS,
    VIEWS,
    ACCESS_LABELS,
    normaliseUser,
    getSharedSession,
    getKioskSession,
    saveSharedSession,
    saveKioskSession,
    clearSharedSession,
    clearAllSessions,
    clearKioskSession,
    refreshSession,
    validateToken,
    hasRole,
    hasPermission,
    canAccess,
    hasViewAccess,
    getAccessLabels,
    describeAccess,
    rememberView,
    resolveLandingPath,
    applyAccessState,
    redirectToLogin,
    protectPage,
    startSlideshowKiosk,
    getToken
  };
})(window);
