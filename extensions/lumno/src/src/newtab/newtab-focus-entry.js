(function() {
  const locationUrl = new URL(window.location.href);
  if (locationUrl.searchParams.get('focus') === '1') {
    const documentElement = document.documentElement;
    if (documentElement) {
      documentElement.setAttribute('data-nt-focus-route', 'true');
    }
    return;
  }

  const documentElement = document.documentElement;
  if (documentElement) {
    documentElement.setAttribute('data-nt-focus-route-pending', 'true');
  }

  const settings = globalThis.LumnoSettings || {};
  const storageKey = settings.NEWTAB_INPUT_AUTO_FOCUS_ENABLED_STORAGE_KEY ||
    '_x_extension_newtab_input_auto_focus_enabled_2026_unique_';
  const normalizeEnabled = typeof settings.normalizeNewtabInputAutoFocusEnabled === 'function'
    ? settings.normalizeNewtabInputAutoFocusEnabled
    : function(value) { return value === true; };

  function settle(enabled) {
    if (!normalizeEnabled(enabled)) {
      if (documentElement) {
        documentElement.removeAttribute('data-nt-focus-route-pending');
      }
      return;
    }
    locationUrl.searchParams.set('focus', '1');
    window.location.replace(locationUrl.href);
  }

  const chromeApi = window.chrome || (typeof chrome !== 'undefined' ? chrome : null);
  const storage = chromeApi && chromeApi.storage
    ? (chromeApi.storage.sync || chromeApi.storage.local)
    : null;
  if (!storage || typeof storage.get !== 'function') {
    settle(false);
    return;
  }

  try {
    storage.get([storageKey], (result) => {
      settle(result && result[storageKey]);
    });
  } catch (_error) {
    settle(false);
  }
})();
