(function(root) {
  const RUNTIME_VERSION = '2026-08-19-natural-suggestions-height-v1';
  if (root.LumnoSuggestionsHeightLayout &&
      root.LumnoSuggestionsHeightLayout.runtimeVersion === RUNTIME_VERSION &&
      typeof root.LumnoSuggestionsHeightLayout.applyNaturalSuggestionsHeightLayout === 'function') {
    return;
  }

  const HEIGHT_LAYOUT_ATTRIBUTES = Object.freeze([
    'data-height-clipped',
    'data-input-height-locked',
    'data-resizing'
  ]);
  const HEIGHT_LAYOUT_PROPERTIES = Object.freeze([
    'flex',
    'height',
    'overflow',
    'overflow-x',
    'overflow-y',
    'padding-top',
    'padding-bottom',
    'transition',
    'will-change'
  ]);

  function applyNaturalSuggestionsHeightLayout(container) {
    if (!container || !container.style) {
      return false;
    }
    if (typeof container.removeAttribute === 'function') {
      HEIGHT_LAYOUT_ATTRIBUTES.forEach((attribute) => {
        container.removeAttribute(attribute);
      });
    }
    if (typeof container.style.removeProperty === 'function') {
      HEIGHT_LAYOUT_PROPERTIES.forEach((property) => {
        container.style.removeProperty(property);
      });
    }
    if (typeof container.style.setProperty === 'function') {
      container.style.setProperty('transition', 'none', 'important');
    }
    return true;
  }

  root.LumnoSuggestionsHeightLayout = Object.freeze({
    runtimeVersion: RUNTIME_VERSION,
    applyNaturalSuggestionsHeightLayout
  });
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
