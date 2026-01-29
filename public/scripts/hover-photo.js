// hover-photo.js - delayed hover preview helper
(function () {
  function initPhotoHoverPopup(options) {
    const container = options?.container;
    const getUrl = options?.getUrl;
    if (!container || typeof getUrl !== 'function') return null;

    const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 1000;
    const maxSize = Number.isFinite(options.maxSize) ? options.maxSize : 180;

    let activeRow = null;
    let hoverTimer = null;
    let lastUrl = '';
    let popupVisible = false;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    const popup = document.createElement('div');
    popup.style.cssText = [
      'position:fixed',
      'z-index:9999',
      'display:none',
      'pointer-events:none',
      'padding:6px',
      'background:#fff',
      'border:1px solid rgba(0,0,0,0.2)',
      'border-radius:6px',
      'box-shadow:0 6px 18px rgba(0,0,0,0.2)'
    ].join(';');

    const img = document.createElement('img');
    img.style.cssText = `display:block;max-width:${maxSize}px;max-height:${maxSize}px;object-fit:contain`;
    popup.appendChild(img);
    document.body.appendChild(popup);

    const clearHoverTimer = () => {
      if (!hoverTimer) return;
      clearTimeout(hoverTimer);
      hoverTimer = null;
    };

    const positionPopup = (x, y) => {
      const pad = 12;
      let left = x + pad;
      let top = y + pad;
      const rect = popup.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width - 8;
      const maxTop = window.innerHeight - rect.height - 8;
      if (left > maxLeft) left = x - rect.width - pad;
      if (top > maxTop) top = y - rect.height - pad;
      popup.style.left = `${Math.max(8, left)}px`;
      popup.style.top = `${Math.max(8, top)}px`;
    };

    const hidePhoto = () => {
      clearHoverTimer();
      popup.style.display = 'none';
      popupVisible = false;
      activeRow = null;
    };

    const showPhoto = (url, x, y) => {
      if (url !== lastUrl) {
        img.src = url;
        lastUrl = url;
      }
      popup.style.display = 'block';
      popupVisible = true;
      positionPopup(x, y);
    };

    container.addEventListener('mouseover', e => {
      const tr = e.target.closest('tr');
      if (!tr || !container.contains(tr)) return;
      if (activeRow === tr) return;

      if (isTouchDevice && e.sourceCapabilities?.firesTouchEvents) return;

      clearHoverTimer();
      activeRow = tr;
      const url = getUrl(tr);
      if (!url) {
        activeRow = null;
        return;
      }

      const x = e.clientX;
      const y = e.clientY;
      hoverTimer = setTimeout(() => {
        if (activeRow === tr) showPhoto(url, x, y);
      }, delayMs);
    });

    container.addEventListener('mousemove', e => {
      if (!popupVisible) return;
      positionPopup(e.clientX, e.clientY);
    });

    container.addEventListener('mouseout', e => {
      if (!activeRow) return;
      const related = e.relatedTarget;
      if (related && activeRow.contains(related)) return;
      hidePhoto();
    });

    container.addEventListener(
      'touchstart',
      e => {
        const touch = e.touches && e.touches[0];
        if (!touch) return;
        const tr = e.target.closest('tr');
        if (!tr || !container.contains(tr)) return;

        if (popupVisible && activeRow === tr) {
          hidePhoto();
          return;
        }

        const url = getUrl(tr);
        if (!url) {
          hidePhoto();
          return;
        }

        clearHoverTimer();
        activeRow = tr;
        lastUrl = '';
        const x = touch.clientX;
        const y = touch.clientY;
        hoverTimer = setTimeout(() => {
          if (activeRow === tr) showPhoto(url, x, y);
        }, delayMs);
      },
      { passive: true }
    );

    container.addEventListener(
      'touchend',
      () => {
        if (hoverTimer && !popupVisible) clearHoverTimer();
      },
      { passive: true }
    );

    container.addEventListener(
      'touchcancel',
      () => {
        if (hoverTimer && !popupVisible) clearHoverTimer();
      },
      { passive: true }
    );

    return { hide: hidePhoto };
  }

  window.initPhotoHoverPopup = initPhotoHoverPopup;
})();
