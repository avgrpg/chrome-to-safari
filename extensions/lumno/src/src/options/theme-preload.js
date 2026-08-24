(function() {
  const THEME_STORAGE_KEY = '_x_extension_theme_mode_2024_unique_';
  const THEME_CACHE_KEY = '_x_extension_options_theme_preload_2026_unique_';
  const PRELOAD_THEME_ATTRIBUTE = 'data-options-preload-theme';
  const PRELOAD_THEME_MODE_ATTRIBUTE = 'data-options-theme-mode';
  const BACKGROUND_PRELOAD_ID = '_x_extension_options_background_preload_2026_unique_';
  const PANEL_ID = '_x_extension_settings_panel_2024_unique_';
  const SETTINGS_TAB_KEYS = ['general', 'account', 'appearance', 'shortcuts', 'blacklist', 'labs'];
  const root = document.documentElement;
  if (!root) {
    return;
  }

  let resolvedTheme = 'light';
  let currentThemeMode = 'system';
  let bodyObserver = null;
  let routeObserver = null;

  function getInitialTabKey() {
    try {
      const rawHash = String(globalThis.location && globalThis.location.hash || '')
        .replace(/^#/, '')
        .trim();
      const tabKey = rawHash.split(':')[0] || '';
      return SETTINGS_TAB_KEYS.includes(tabKey) ? tabKey : 'general';
    } catch (e) {
      return 'general';
    }
  }

  function applyInitialTabState() {
    if (typeof document.querySelectorAll !== 'function') {
      return false;
    }
    const tabKey = getInitialTabKey();
    const tabButtons = Array.from(document.querySelectorAll(
      '._x_extension_settings_tab_button_2024_unique_[data-tab]'
    ));
    const tabContents = Array.from(document.querySelectorAll(
      '._x_extension_settings_content_2024_unique_[data-content]'
    ));
    if (tabButtons.length < SETTINGS_TAB_KEYS.length || tabContents.length < SETTINGS_TAB_KEYS.length) {
      return false;
    }
    tabButtons.forEach((button) => {
      button.setAttribute('data-active', button.getAttribute('data-tab') === tabKey ? 'true' : 'false');
    });
    tabContents.forEach((content) => {
      content.setAttribute('data-active', content.getAttribute('data-content') === tabKey ? 'true' : 'false');
    });
    root.setAttribute('data-options-initial-tab', tabKey);
    if (routeObserver) {
      routeObserver.disconnect();
      routeObserver = null;
    }
    return true;
  }

  function normalizeThemeMode(value) {
    if (value === 'dark' || value === 'light') {
      return value;
    }
    return 'system';
  }

  function getSystemTheme() {
    try {
      return globalThis.matchMedia && globalThis.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function resolveTheme(mode) {
    const normalized = normalizeThemeMode(mode);
    return normalized === 'system' ? getSystemTheme() : normalized;
  }

  function readCachedThemeMode() {
    try {
      return normalizeThemeMode(globalThis.localStorage
        ? globalThis.localStorage.getItem(THEME_CACHE_KEY)
        : 'system');
    } catch (e) {
      return 'system';
    }
  }

  function cacheThemeMode(mode) {
    try {
      if (globalThis.localStorage) {
        globalThis.localStorage.setItem(THEME_CACHE_KEY, normalizeThemeMode(mode));
      }
    } catch (e) {
      // Best effort only; chrome.storage remains the source of truth.
    }
  }

  function getRuntimeUrl(path) {
    if (globalThis.chrome && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      return chrome.runtime.getURL(path);
    }
    return `../../${path}`;
  }

  function updateBackgroundPreload(theme) {
    if (!document.head) {
      return;
    }
    const href = getRuntimeUrl(
      theme === 'dark'
        ? 'assets/images/settings-bg-dark.webp'
        : 'assets/images/settings-bg-light.webp'
    );
    let link = document.getElementById(BACKGROUND_PRELOAD_ID);
    if (!link) {
      link = document.createElement('link');
      link.id = BACKGROUND_PRELOAD_ID;
      link.rel = 'preload';
      link.as = 'image';
      link.fetchPriority = 'high';
      link.href = href;
      document.head.appendChild(link);
      return;
    }
    link.href = href;
  }

  function applyTheme(theme) {
    resolvedTheme = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute(PRELOAD_THEME_ATTRIBUTE, resolvedTheme);
    root.setAttribute(PRELOAD_THEME_MODE_ATTRIBUTE, currentThemeMode);
    root.setAttribute('data-theme-ready', 'true');
    root.style.colorScheme = resolvedTheme;
    updateBackgroundPreload(resolvedTheme);

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', resolvedTheme === 'dark' ? '#111111' : '#f1f5f9');
    }
    if (document.body) {
      document.body.setAttribute('data-theme', resolvedTheme);
    }
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.setAttribute('data-theme', resolvedTheme);
    }
    if (document.body && panel && bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
  }

  currentThemeMode = readCachedThemeMode();
  applyTheme(resolveTheme(currentThemeMode));
  const initialTabApplied = applyInitialTabState();

  if ((!document.body || !document.getElementById(PANEL_ID)) &&
      typeof globalThis.MutationObserver === 'function') {
    bodyObserver = new MutationObserver(() => applyTheme(resolvedTheme));
    bodyObserver.observe(root, { childList: true, subtree: true });
  }
  if (!initialTabApplied && typeof globalThis.MutationObserver === 'function') {
    routeObserver = new MutationObserver(applyInitialTabState);
    routeObserver.observe(root, { childList: true, subtree: true });
  }

  try {
    const storage = globalThis.chrome && chrome.storage
      ? (chrome.storage.sync || chrome.storage.local)
      : null;
    if (storage && typeof storage.get === 'function') {
      storage.get([THEME_STORAGE_KEY], (result) => {
        const storedMode = normalizeThemeMode(result && result[THEME_STORAGE_KEY]);
        currentThemeMode = storedMode;
        cacheThemeMode(storedMode);
        applyTheme(resolveTheme(storedMode));
      });
    }
  } catch (e) {
    // The cached/system theme already made the page paintable.
  }
})();
