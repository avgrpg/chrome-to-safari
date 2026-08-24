(function() {
  const STORAGE_KEY = '_x_extension_motion_effects_enabled_2026_unique_';
  const root = document.documentElement;
  const storage = chrome && chrome.storage ? chrome.storage : null;
  const storageArea = storage && storage.sync
    ? storage.sync
    : (storage && storage.local ? storage.local : null);
  const storageAreaName = storageArea && storageArea === storage.sync ? 'sync' : 'local';
  let resolveInitialPreference = null;
  let initialPreferenceResolved = false;
  const initialPreferenceReady = new Promise((resolve) => {
    resolveInitialPreference = resolve;
  });

  globalThis.LumnoMotionPreferenceReady = initialPreferenceReady;

  function applyMotionEffectsPreference(value) {
    const enabled = value !== false;
    root.setAttribute('data-lumno-motion-effects', enabled ? 'on' : 'off');
    if (!initialPreferenceResolved) {
      initialPreferenceResolved = true;
      resolveInitialPreference(enabled);
    }
  }

  if (!storageArea || typeof storageArea.get !== 'function') {
    applyMotionEffectsPreference(true);
    return;
  }

  storageArea.get([STORAGE_KEY], (result) => {
    const rawValue = result ? result[STORAGE_KEY] : undefined;
    const enabled = rawValue !== false;
    applyMotionEffectsPreference(enabled);
    if (rawValue !== enabled && typeof storageArea.set === 'function') {
      storageArea.set({ [STORAGE_KEY]: enabled });
    }
  });

  if (storage.onChanged && typeof storage.onChanged.addListener === 'function') {
    storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== storageAreaName || !changes || !changes[STORAGE_KEY]) {
        return;
      }
      applyMotionEffectsPreference(changes[STORAGE_KEY].newValue);
    });
  }
})();
