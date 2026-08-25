/*
 * history-capture.js — feeds LumnoHistory (Safari's chrome.history replacement).
 *
 * Runs on every http(s) page. Reports the visit (url + title + favicon) to the
 * background script, which writes it into the self-tracked IndexedDB store.
 *
 * Guard: when the native chrome.history API exists (Chrome/Firefox), we skip —
 * the self-tracked store is only a Safari fallback, so we must not double-count.
 */
(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    return;
  }
  // Skip on browsers that already have a native history API (Chrome/Firefox).
  if (typeof chrome !== 'undefined' && chrome.history) {
    return;
  }

  function canRecord() {
    const u = location.href;
    if (!/^https?:\/\//i.test(u)) return false;
    return true;
  }

  function resolveFavicon() {
    try {
      const link = document.querySelector('link[rel~="icon"]');
      if (link && link.href) {
        return new URL(link.href, location.href).toString();
      }
    } catch (e) {
      /* ignore */
    }
    try {
      return new URL('/favicon.ico', location.origin).toString();
    } catch (e) {
      return '';
    }
  }

  function report() {
    if (!canRecord()) return;
    try {
      chrome.runtime.sendMessage({
        action: 'lumnoHistoryVisit',
        payload: {
          url: location.href,
          title: document.title || '',
          faviconUrl: resolveFavicon()
        }
      });
    } catch (e) {
      /* ignore */
    }
  }

  function onReady() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      report();
    } else {
      window.addEventListener('DOMContentLoaded', report, { once: true });
      window.addEventListener('load', report, { once: true });
    }
  }

  onReady();

  // Cover SPA / in-page navigations (pushState/replaceState/popstate).
  try {
    const push = history.pushState;
    const replace = history.replaceState;
    history.pushState = function () {
      const r = push.apply(this, arguments);
      report();
      return r;
    };
    history.replaceState = function () {
      const r = replace.apply(this, arguments);
      report();
      return r;
    };
    window.addEventListener('popstate', report);
  } catch (e) {
    /* ignore */
  }

  // Allow the background to request a re-report (e.g. after a missed load).
  if (chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === 'function') {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.action === 'lumnoReportVisit') {
        report();
      }
    });
  }
})();
