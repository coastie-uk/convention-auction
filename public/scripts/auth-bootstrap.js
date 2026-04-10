(function bootstrapProtectedPage(global) {
  "use strict";

  const config = global.__APP_PAGE_AUTH__;
  if (!config || !global.AppAuth) return;

  global.__APP_AUTH_READY__ = global.AppAuth.protectPage(config)
    .catch(() => {
      global.AppAuth.redirectToLogin({ reason: "signed_out" });
      return null;
    });
})(window);
