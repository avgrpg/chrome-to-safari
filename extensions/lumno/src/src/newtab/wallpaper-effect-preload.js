(function() {
  const root = document.documentElement;
  const body = document.body;
  const preloadState = globalThis.LumnoNewtabWallpaperPreload;
  const effects = globalThis.LumnoNewtabWallpaperEffects;
  if (!root ||
      !body ||
      root.getAttribute('data-nt-focus-route') !== 'true' ||
      !preloadState ||
      !preloadState.wallpaper ||
      !preloadState.imageUrl ||
      !preloadState.effectPrefsReady ||
      !effects ||
      typeof effects.createWallpaperEffects !== 'function') {
    return;
  }

  const liveState = {
    onRender() {},
    shouldAnimateTransition: () => false
  };
  const preloadRuntime = {
    claimed: false,
    controller: null,
    attach(options) {
      const config = options || {};
      if (typeof config.onRender === 'function') {
        liveState.onRender = config.onRender;
      }
      if (typeof config.shouldAnimateTransition === 'function') {
        liveState.shouldAnimateTransition = config.shouldAnimateTransition;
      }
    },
    updateSource(wallpaper, imageUrl) {
      preloadState.wallpaper = wallpaper || null;
      preloadState.imageUrl = String(imageUrl || '');
    }
  };
  globalThis.LumnoNewtabWallpaperEffectPreload = preloadRuntime;

  preloadState.effectPrefsReady.then((prefs) => {
    if (preloadRuntime.claimed) {
      return;
    }
    const normalized = typeof effects.normalizePrefs === 'function'
      ? effects.normalizePrefs(prefs)
      : prefs;
    if (!normalized || normalized.type === 'none') {
      body.setAttribute('data-wallpaper-effect', 'none');
      body.setAttribute('data-nt-wallpaper-ready', '1');
      return;
    }

    body.setAttribute('data-wallpaper-active', 'true');
    body.setAttribute('data-wallpaper-effect', normalized.type);
    const controller = effects.createWallpaperEffects({
      documentObj: document,
      windowObj: window,
      getCurrentWallpaper: () => preloadState.wallpaper,
      getWallpaperImageUrl: () => preloadState.imageUrl,
      shouldAnimateTransition: () => liveState.shouldAnimateTransition(),
      onRender: () => liveState.onRender()
    });
    preloadRuntime.controller = controller;
    controller.apply(normalized);
    controller.refresh({ immediate: true }).then(() => {
      if (document.body) {
        document.body.setAttribute('data-nt-wallpaper-ready', '1');
      }
    });
  }).catch(() => {
    if (document.body) {
      document.body.setAttribute('data-nt-wallpaper-ready', '1');
    }
  });
})();
