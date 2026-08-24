(function() {
  if (window.__lumnoDocumentPiPPicker2026) {
    return;
  }

  const STATE_FLAG = '__lumno_document_pip_active_2026__';
  const ROOT_ID = '__lumno_document_pip_picker_root_2026__';
  const TOAST_ID = '__lumno_document_pip_toast_2026__';
  const HIGHLIGHT_ID = '__lumno_document_pip_highlight_2026__';
  const PLACEHOLDER_ATTR = 'data-lumno-document-pip-placeholder';
  const PICKER_HIGHLIGHT_PADDING = 4;
  const PIP_DOCK_CLEARANCE = 56;
  const PICKER_Z_INDEX = '2147483646';
  const DOCUMENT_PIP_BOUNDS_STORAGE_KEY = '__lumno_document_pip_bounds_2026__';
  const state = {
    active: false,
    root: null,
    highlight: null,
    currentTarget: null,
    currentStack: [],
    currentStackIndex: 0,
    currentTheme: null,
    session: null,
    teardownSelection: null,
    toastTimer: null,
    opening: false,
    ownerToken: '',
    runtimeMessageHandlerBound: false
  };

  function applyNoTranslate(element) {
    if (!element || typeof element.setAttribute !== 'function') {
      return element;
    }
    element.setAttribute('translate', 'no');
    element.setAttribute('lang', 'zxx');
    element.setAttribute('notranslate', '');
    element.setAttribute('data-no-translate', 'true');
    if (element.classList) {
      element.classList.add('notranslate');
    }
    return element;
  }

  function getStorageArea() {
    if (!chrome || !chrome.storage) {
      return null;
    }
    return chrome.storage.local || chrome.storage.sync || null;
  }

  function loadSavedDocumentPiPBounds() {
    return new Promise((resolve) => {
      const storageArea = getStorageArea();
      if (!storageArea || typeof storageArea.get !== 'function') {
        resolve(null);
        return;
      }
      storageArea.get([DOCUMENT_PIP_BOUNDS_STORAGE_KEY], (result) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const raw = result ? result[DOCUMENT_PIP_BOUNDS_STORAGE_KEY] : null;
        if (!raw || typeof raw !== 'object') {
          resolve(null);
          return;
        }
        const left = Number(raw.left);
        const top = Number(raw.top);
        resolve({
          left: Number.isFinite(left) ? Math.round(left) : null,
          top: Number.isFinite(top) ? Math.round(top) : null
        });
      });
    });
  }

  function saveDocumentPiPBounds(bounds) {
    const storageArea = getStorageArea();
    if (!storageArea || typeof storageArea.set !== 'function' || !bounds) {
      return;
    }
    const payload = {};
    payload[DOCUMENT_PIP_BOUNDS_STORAGE_KEY] = bounds;
    try {
      storageArea.set(payload, () => {
        // Ignore storage write failures.
      });
    } catch (error) {
      // Ignore storage write failures.
    }
  }

  function getWindowScreenPosition(targetWindow) {
    if (!targetWindow) {
      return null;
    }
    const leftCandidates = [targetWindow.screenX, targetWindow.screenLeft];
    const topCandidates = [targetWindow.screenY, targetWindow.screenTop];
    const left = leftCandidates.find((value) => Number.isFinite(Number(value)));
    const top = topCandidates.find((value) => Number.isFinite(Number(value)));
    if (!Number.isFinite(Number(left)) || !Number.isFinite(Number(top))) {
      return null;
    }
    return {
      left: Math.round(Number(left)),
      top: Math.round(Number(top))
    };
  }

  function persistDocumentPiPBoundsFromWindow(targetWindow) {
    const position = getWindowScreenPosition(targetWindow);
    if (!position) {
      return;
    }
    saveDocumentPiPBounds({
      left: position.left,
      top: position.top,
      updatedAt: Date.now()
    });
  }

  function getMessage(name, fallback) {
    try {
      if (chrome && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
        const value = chrome.i18n.getMessage(name);
        if (value) {
          return value;
        }
      }
    } catch (error) {
      // Ignore i18n failures in page context.
    }
    return fallback;
  }

  function getRuntimeUrl(path) {
    try {
      if (chrome && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(path);
      }
    } catch (error) {
      // Ignore runtime URL failures.
    }
    return path;
  }

  function supportsDocumentPiP() {
    return getDocumentPiPSupportState().supported;
  }

  function isPictureInPictureAllowedByPolicy() {
    const policy = document.permissionsPolicy || document.featurePolicy;
    if (!policy || typeof policy.allowsFeature !== 'function') {
      return true;
    }
    try {
      return policy.allowsFeature('picture-in-picture') !== false;
    } catch (error) {
      return true;
    }
  }

  function getDocumentPiPSupportState() {
    if (window.top !== window.self) {
      return { supported: false, reason: 'not-top-level' };
    }
    if (!window.isSecureContext) {
      return { supported: false, reason: 'not-secure-context' };
    }
    if (!window.documentPictureInPicture || typeof window.documentPictureInPicture.requestWindow !== 'function') {
      return { supported: false, reason: 'api-unavailable' };
    }
    if (!isPictureInPictureAllowedByPolicy()) {
      return { supported: false, reason: 'blocked-by-policy' };
    }
    return { supported: true, reason: 'ok' };
  }

  function getSupportFailureMessage(reason) {
    if (reason === 'blocked-by-policy') {
      return getMessage(
        'document_pip_picker_unsupported_policy',
        'This website disables Picture-in-Picture via site policy.'
      );
    }
    if (reason === 'not-top-level') {
      return getMessage(
        'document_pip_picker_unsupported_iframe',
        'Document Picture-in-Picture only works in the top-level page.'
      );
    }
    if (reason === 'not-secure-context') {
      return getMessage(
        'document_pip_picker_unsupported_insecure',
        'Document Picture-in-Picture requires HTTPS.'
      );
    }
    return getMessage(
      'document_pip_picker_unsupported',
      'This page does not support Document Picture-in-Picture.'
    );
  }

  function getOpenFailureMessage(error) {
    const name = String(error && error.name ? error.name : '');
    if (name === 'NotAllowedError') {
      return getMessage(
        'document_pip_picker_open_failed_not_allowed',
        'The website or browser blocked opening Document Picture-in-Picture.'
      );
    }
    if (name === 'NotSupportedError') {
      return getMessage(
        'document_pip_picker_open_failed_not_supported',
        'This selection cannot be opened in Document Picture-in-Picture on this page.'
      );
    }
    if (name === 'InvalidStateError') {
      return getMessage(
        'document_pip_picker_open_failed_invalid_state',
        'A floating window is already open or the page state changed. Try again.'
      );
    }
    if (name === 'SecurityError') {
      return getMessage(
        'document_pip_picker_open_failed_security',
        'The browser blocked this action for security reasons on this page.'
      );
    }
    return getMessage(
      'document_pip_picker_open_failed',
      'Failed to open the floating content window. Try a different area'
    );
  }

  function hasActiveVideoPiP() {
    return Boolean(document.pictureInPictureElement);
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        resolve({ ok: false, reason: 'no-runtime-sendMessage' });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({
              ok: false,
              reason: chrome.runtime.lastError.message || 'runtime-lastError'
            });
            return;
          }
          resolve(response && typeof response === 'object'
            ? response
            : { ok: false, reason: 'empty-response' });
        });
      } catch (error) {
        resolve({ ok: false, reason: String(error) });
      }
    });
  }

  async function requestDocumentPipOwnership() {
    const response = await sendRuntimeMessage({
      action: 'pipRequestOwnership',
      kind: 'document'
    });
    if (response && response.ok && response.granted && response.token) {
      state.ownerToken = String(response.token);
      return { ok: true, granted: true };
    }
    return {
      ok: false,
      granted: false,
      reason: response && response.reason ? String(response.reason) : 'ownership-denied'
    };
  }

  function releaseDocumentPipOwnership() {
    const token = typeof state.ownerToken === 'string' ? state.ownerToken : '';
    state.ownerToken = '';
    if (!token) {
      return;
    }
    sendRuntimeMessage({
      action: 'pipReleaseOwnership',
      token: token
    }).catch(() => {});
  }

  function showVideoPiPConflictToast() {
    ensurePickerUi();
    applyPickerTheme(getPickerTheme(null));
    showToast(
      getMessage(
        'document_pip_picker_conflict_video_pip',
        'A video PiP is already active. Close it before starting content clipping.'
      ),
      'error'
    );
  }

  function isOwnNode(node) {
    return Boolean(node && node.nodeType === 1 && node.closest && node.closest(`#${ROOT_ID}`));
  }

  function getElementFromPoint(event) {
    if (!event || typeof document.elementFromPoint !== 'function') {
      return null;
    }
    const node = document.elementFromPoint(event.clientX, event.clientY);
    if (!node || isOwnNode(node)) {
      return null;
    }
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element) || !element.isConnected) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isAllowedElement(element) {
    if (!(element instanceof Element) || !element.isConnected || isOwnNode(element)) {
      return false;
    }
    const tagName = String(element.tagName || '').toUpperCase();
    if (!tagName) {
      return false;
    }
    if ([
      'HTML',
      'BODY',
      'HEAD',
      'SCRIPT',
      'STYLE',
      'LINK',
      'META',
      'NOSCRIPT',
      'TITLE',
      'SOURCE',
      'TRACK',
      'BR',
      'IFRAME',
      'FRAME',
      'OBJECT',
      'EMBED'
    ].includes(tagName)) {
      return false;
    }
    return isVisibleElement(element);
  }

  function containsBlockedMediaContent(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const tagName = String(element.tagName || '').toUpperCase();
    if (tagName === 'VIDEO' || tagName === 'AUDIO' || tagName === 'IFRAME') {
      return true;
    }
    try {
      return Boolean(element.querySelector('video, audio, iframe'));
    } catch (error) {
      return true;
    }
  }

  function getElementStack(element) {
    const stack = [];
    let current = element;
    while (current && current instanceof Element) {
      if (isAllowedElement(current)) {
        stack.push(current);
      }
      if (current === document.body) {
        break;
      }
      current = current.parentElement;
    }
    return stack.slice(0, 8);
  }

  function getElementArea(element) {
    if (!(element instanceof Element)) {
      return 0;
    }
    const rect = element.getBoundingClientRect();
    return Math.max(0, Math.round((Number(rect.width) || 0) * (Number(rect.height) || 0)));
  }

  function hasPaintedSurface(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const backgroundColor = parseCssColor(style.backgroundColor);
    return Boolean((backgroundColor && backgroundColor[3] > 0.04) || style.backgroundImage !== 'none');
  }

  function isLikelyLeafNode(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const childElements = Array.from(element.children || []).filter((child) => isVisibleElement(child));
    return childElements.length === 0;
  }

  function isLikelyToolbarLike(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const tagName = String(element.tagName || '').toLowerCase();
    const role = String(element.getAttribute('role') || '').toLowerCase();
    const classText = String(element.className || '').toLowerCase();
    if (tagName === 'nav' || tagName === 'header' || role === 'toolbar' || role === 'menubar' || role === 'navigation') {
      return true;
    }
    return /(toolbar|topbar|navbar|nav-|actions|action-bar|menu-bar|header-actions)/.test(classText);
  }

  function isLikelyInteractiveContainer(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (isLikelyToolbarLike(element)) {
      return true;
    }
    if (element.matches('button, a, input, select, textarea, summary, label')) {
      return true;
    }
    return Boolean(element.querySelector('button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [aria-haspopup="true"]'));
  }

  function getCandidateScore(element) {
    if (!(element instanceof Element)) {
      return -1;
    }
    const area = getElementArea(element);
    const paintedBoost = hasPaintedSurface(element) ? 1400000 : 0;
    const semanticBoost = element.matches('article, section, main, aside, dialog, [role="dialog"], [role="region"], [role="article"]') ? 1200000 : 0;
    const containerBoost = !isLikelyLeafNode(element) ? 400000 : 0;
    const toolbarPenalty = isLikelyToolbarLike(element) ? -550000 : 0;
    const tinyPenalty = area < 22000 ? -700000 : 0;
    const giantPenalty = area > Math.max(window.innerWidth * window.innerHeight * 0.82, 900000) ? -350000 : 0;
    const interactivePenalty = isLikelyInteractiveContainer(element) && !hasPaintedSurface(element) ? -180000 : 0;
    return area + paintedBoost + semanticBoost + containerBoost + toolbarPenalty + tinyPenalty + giantPenalty + interactivePenalty;
  }

  function getDefaultStackIndex(stack) {
    if (!Array.isArray(stack) || stack.length === 0) {
      return 0;
    }
    let bestIndex = 0;
    let bestScore = -Infinity;
    stack.forEach((element, index) => {
      const score = getCandidateScore(element);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function getSelectionGuidance(element) {
    if (!(element instanceof Element)) {
      return getMessage('document_pip_picker_idle', 'Hover a visible area to start selecting.');
    }
    if (isLikelyToolbarLike(element)) {
      return getMessage(
        'document_pip_picker_guidance_toolbar',
        'This looks like a navigation or toolbar area. Complex menus may not fully interact in PiP; scroll to choose a larger container if needed.'
      );
    }
    if (isLikelyInteractiveContainer(element) && !hasPaintedSurface(element)) {
      return getMessage(
        'document_pip_picker_guidance_interactive',
        'This looks like a fragile interactive group. If clicks fail in PiP, scroll to select a larger painted container.'
      );
    }
    if (isLikelyLeafNode(element)) {
      return getMessage(
        'document_pip_picker_guidance_leaf',
        'This is a small leaf node. Scroll to move to its parent if you want a more stable floating view.'
      );
    }
    return getMessage(
      'document_pip_picker_guidance_default',
      'This selection should work well for content floating.'
    );
  }

  function formatElementLabel(element) {
    if (!(element instanceof Element)) {
      return '';
    }
    const rect = element.getBoundingClientRect();
    const idPart = element.id ? `#${element.id}` : '';
    const classPart = Array.from(element.classList || []).slice(0, 2).map((item) => `.${item}`).join('');
    return `${String(element.tagName || '').toLowerCase()}${idPart}${classPart} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }

  function clampChannel(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
  }

  function clampAlpha(value) {
    return Math.max(0, Math.min(1, Number(value)));
  }

  function parseCssColor(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw || raw === 'transparent' || raw === 'initial' || raw === 'inherit') {
      return null;
    }
    const rgbaMatch = raw.match(/^rgba?\(([^)]+)\)$/);
    if (rgbaMatch) {
      const parts = rgbaMatch[1].split(',').map((item) => item.trim());
      if (parts.length < 3) {
        return null;
      }
      return [
        clampChannel(parts[0]),
        clampChannel(parts[1]),
        clampChannel(parts[2]),
        parts.length > 3 ? clampAlpha(parts[3]) : 1
      ];
    }
    const hexMatch = raw.match(/^#([0-9a-f]{3,8})$/i);
    if (!hexMatch) {
      return null;
    }
    const hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      const chars = hex.split('');
      return [
        parseInt(chars[0] + chars[0], 16),
        parseInt(chars[1] + chars[1], 16),
        parseInt(chars[2] + chars[2], 16),
        hex.length === 4 ? clampAlpha(parseInt(chars[3] + chars[3], 16) / 255) : 1
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        hex.length === 8 ? clampAlpha(parseInt(hex.slice(6, 8), 16) / 255) : 1
      ];
    }
    return null;
  }

  function rgbToCss(color, alphaOverride) {
    const parsed = Array.isArray(color) ? color : null;
    if (!parsed || parsed.length < 3) {
      return '';
    }
    const alpha = alphaOverride == null ? (parsed[3] == null ? 1 : parsed[3]) : alphaOverride;
    if (alpha >= 0.999) {
      return `rgb(${clampChannel(parsed[0])}, ${clampChannel(parsed[1])}, ${clampChannel(parsed[2])})`;
    }
    return `rgba(${clampChannel(parsed[0])}, ${clampChannel(parsed[1])}, ${clampChannel(parsed[2])}, ${clampAlpha(alpha).toFixed(3).replace(/0+$/,'').replace(/\.$/,'')})`;
  }

  function getLuminance(color) {
    if (!Array.isArray(color) || color.length < 3) {
      return 1;
    }
    const normalize = (channel) => {
      const value = clampChannel(channel) / 255;
      return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * normalize(color[0]) + 0.7152 * normalize(color[1]) + 0.0722 * normalize(color[2]);
  }

  function findNearestPaintedElement(element) {
    let current = element;
    while (current && current instanceof Element) {
      const style = window.getComputedStyle(current);
      const backgroundColor = parseCssColor(style.backgroundColor);
      if ((backgroundColor && backgroundColor[3] > 0.04) || style.backgroundImage !== 'none') {
        return current;
      }
      current = current.parentElement;
    }
    return document.body || document.documentElement;
  }

  function getVisualTheme(element) {
    const surfaceElement = findNearestPaintedElement(element);
    const pageElement = document.body || document.documentElement;
    const surfaceStyle = window.getComputedStyle(surfaceElement);
    const pageStyle = window.getComputedStyle(pageElement);
    const surfaceColor = parseCssColor(surfaceStyle.backgroundColor) ||
      parseCssColor(pageStyle.backgroundColor) ||
      [255, 255, 255, 1];
    const pageColor = parseCssColor(pageStyle.backgroundColor) || surfaceColor;
    const textColor = parseCssColor(surfaceStyle.color) ||
      parseCssColor(pageStyle.color) ||
      (getLuminance(surfaceColor) < 0.45 ? [248, 250, 252, 1] : [15, 23, 42, 1]);
    const isDark = getLuminance(surfaceColor) < 0.45;
    const borderRadius = surfaceStyle.borderRadius && surfaceStyle.borderRadius !== '0px'
      ? surfaceStyle.borderRadius
      : '16px';
    return {
      pageBackground: rgbToCss(pageColor),
      surfaceBackground: rgbToCss(surfaceColor),
      textColor: rgbToCss(textColor),
      mutedTextColor: isDark ? 'rgba(226, 232, 240, 0.78)' : 'rgba(51, 65, 85, 0.78)',
      toolbarBackground: rgbToCss(surfaceColor, isDark ? 0.92 : 0.96),
      toolbarBorder: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.12)',
      buttonBackground: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.08)',
      secondaryButtonBackground: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.05)',
      buttonText: isDark ? '#f8fafc' : '#0f172a',
      badgeBackground: isDark ? 'rgba(15, 23, 42, 0.76)' : 'rgba(255, 255, 255, 0.9)',
      badgeText: isDark ? '#f8fafc' : '#0f172a',
      placeholderBorder: isDark ? 'rgba(147, 197, 253, 0.72)' : 'rgba(37, 99, 235, 0.58)',
      placeholderBackground: isDark ? 'rgba(96, 165, 250, 0.12)' : 'rgba(37, 99, 235, 0.07)',
      placeholderShadow: isDark
        ? 'inset 0 0 0 1px rgba(255,255,255,0.1)'
        : 'inset 0 0 0 1px rgba(255,255,255,0.46)',
      cardShadow: isDark ? '0 22px 60px rgba(0, 0, 0, 0.34)' : '0 22px 60px rgba(15, 23, 42, 0.14)',
      highlightBorder: isDark ? 'rgba(147, 197, 253, 0.92)' : 'rgba(37, 99, 235, 0.72)',
      highlightBackground: isDark ? 'rgba(96, 165, 250, 0.14)' : 'rgba(37, 99, 235, 0.10)',
      highlightShadow: isDark
        ? '0 0 0 1px rgba(255,255,255,0.12), 0 20px 60px rgba(0, 0, 0, 0.28)'
        : '0 0 0 1px rgba(255,255,255,0.55), 0 20px 60px rgba(15, 23, 42, 0.18)',
      toastBackground: rgbToCss(surfaceColor, isDark ? 0.96 : 0.98),
      toastText: rgbToCss(textColor),
      errorToastBackground: isDark ? 'rgba(127, 29, 29, 0.94)' : 'rgba(254, 226, 226, 0.98)',
      errorToastText: isDark ? '#fef2f2' : '#991b1b',
      borderRadius: borderRadius
    };
  }

  function getPickerTheme(element) {
    return getVisualTheme(element || document.body || document.documentElement);
  }

  function ensurePickerUi() {
    if (state.root && state.root.isConnected) {
      return;
    }
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('aria-hidden', 'true');
    applyNoTranslate(root);
    root.style.cssText = [
      'position: fixed',
      'inset: 0',
      'pointer-events: none',
      `z-index: ${PICKER_Z_INDEX}`,
      'font-family: "Open Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ].join(';');

    const highlight = document.createElement('div');
    highlight.id = HIGHLIGHT_ID;
    applyNoTranslate(highlight);
    highlight.style.cssText = [
      'position: fixed',
      'left: 0',
      'top: 0',
      'width: 0',
      'height: 0',
      'border: 3px dashed rgba(37, 99, 235, 0.72)',
      'border-radius: 10px',
      'background: rgba(37, 99, 235, 0.10)',
      'box-shadow: 0 0 0 1px rgba(255,255,255,0.55), 0 20px 60px rgba(15, 23, 42, 0.18)',
      'transform: translate3d(0, 0, 0)',
      'transition: width 80ms ease, height 80ms ease, transform 80ms ease, opacity 80ms ease',
      'opacity: 0'
    ].join(';');

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    applyNoTranslate(toast);
    toast.style.cssText = [
      'position: fixed',
      'left: 50%',
      'bottom: 24px',
      'transform: translateX(-50%)',
      'max-width: min(560px, calc(100vw - 32px))',
      'padding: 10px 14px',
      'border-radius: 999px',
      'background: rgba(255, 255, 255, 0.98)',
      'color: #0f172a',
      'font-size: 13px',
      'line-height: 1.35',
      'opacity: 0',
      'transition: opacity 120ms ease',
      'border: 1px solid rgba(15, 23, 42, 0.08)',
      'box-shadow: 0 16px 42px rgba(15, 23, 42, 0.18)'
    ].join(';');

    root.appendChild(highlight);
    root.appendChild(toast);
    document.documentElement.appendChild(root);

    state.root = root;
    state.highlight = highlight;
  }

  function applyPickerTheme(theme) {
    const resolvedTheme = theme || getPickerTheme(null);
    state.currentTheme = resolvedTheme;
    if (state.highlight) {
      state.highlight.style.borderColor = resolvedTheme.highlightBorder;
      state.highlight.style.borderStyle = 'dashed';
      state.highlight.style.background = resolvedTheme.highlightBackground;
      state.highlight.style.boxShadow = resolvedTheme.highlightShadow;
    }
    const toast = document.getElementById(TOAST_ID);
    if (toast) {
      toast.style.background = resolvedTheme.toastBackground;
      toast.style.color = resolvedTheme.toastText;
      toast.style.borderColor = resolvedTheme.toolbarBorder;
      toast.style.boxShadow = resolvedTheme.cardShadow;
    }
  }

  function setHighlight(element) {
    ensurePickerUi();
    applyPickerTheme(getPickerTheme(element));
    if (!(element instanceof Element)) {
      state.highlight.style.opacity = '0';
      return;
    }
    const rect = element.getBoundingClientRect();
    const viewportWidth = Math.max(1, Number(window.innerWidth || document.documentElement.clientWidth || 0));
    const viewportHeight = Math.max(1, Number(window.innerHeight || document.documentElement.clientHeight || 0));
    const left = Math.max(0, Math.round(rect.left) - PICKER_HIGHLIGHT_PADDING);
    const top = Math.max(0, Math.round(rect.top) - PICKER_HIGHLIGHT_PADDING);
    const right = Math.min(viewportWidth, Math.round(rect.right) + PICKER_HIGHLIGHT_PADDING);
    const bottom = Math.min(viewportHeight, Math.round(rect.bottom) + PICKER_HIGHLIGHT_PADDING);
    state.highlight.style.opacity = '1';
    state.highlight.style.width = `${Math.max(0, right - left)}px`;
    state.highlight.style.height = `${Math.max(0, bottom - top)}px`;
    state.highlight.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function hideToast() {
    const toast = document.getElementById(TOAST_ID);
    if (!toast) {
      return;
    }
    if (state.toastTimer) {
      window.clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    toast.style.opacity = '0';
  }

  function showToast(message, kind, options) {
    ensurePickerUi();
    const toast = document.getElementById(TOAST_ID);
    if (!toast) {
      return;
    }
    if (state.toastTimer) {
      window.clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    toast.textContent = message;
    const theme = state.currentTheme || getPickerTheme(state.currentTarget);
    applyPickerTheme(theme);
    toast.style.background = kind === 'error'
      ? theme.errorToastBackground
      : theme.toastBackground;
    toast.style.color = kind === 'error'
      ? theme.errorToastText
      : theme.toastText;
    toast.style.opacity = '1';
    if (options && options.persistent) {
      return;
    }
    state.toastTimer = window.setTimeout(() => {
      toast.style.opacity = '0';
      state.toastTimer = null;
    }, 2200);
  }

  function selectTargetFromStack(index) {
    const nextIndex = Math.max(0, Math.min(Number(index || 0), state.currentStack.length - 1));
    state.currentStackIndex = nextIndex;
    state.currentTarget = state.currentStack[nextIndex] || null;
    setHighlight(state.currentTarget);
  }

  function updateCurrentTargetFromPointer(event) {
    const element = getElementFromPoint(event);
    if (!element) {
      state.currentStack = [];
      state.currentStackIndex = 0;
      state.currentTarget = null;
      setHighlight(null);
      return;
    }
    const stack = getElementStack(element);
    if (!stack.length) {
      state.currentStack = [];
      state.currentStackIndex = 0;
      state.currentTarget = null;
      setHighlight(null);
      return;
    }
    const previous = state.currentTarget;
    state.currentStack = stack;
    let nextIndex = 0;
    if (previous) {
      const matchedIndex = stack.indexOf(previous);
      if (matchedIndex >= 0) {
        nextIndex = matchedIndex;
      } else {
        nextIndex = getDefaultStackIndex(stack);
      }
    } else {
      nextIndex = getDefaultStackIndex(stack);
    }
    selectTargetFromStack(nextIndex);
  }

  function copyStylesToPiP(pipWindow) {
    const pipDocument = pipWindow.document;
    ensurePiPDocumentBase(pipDocument);
    const existingNodes = Array.from(pipDocument.head.querySelectorAll('link[data-lumno-pip-link="1"], style[data-lumno-pip-style="1"]'));
    existingNodes.forEach((node) => node.remove());

    Array.from(document.styleSheets).forEach((styleSheet) => {
      const ownerNode = styleSheet && styleSheet.ownerNode;
      if (!(ownerNode instanceof Node)) {
        return;
      }
      if (ownerNode instanceof HTMLLinkElement && ownerNode.href) {
        const link = pipDocument.createElement('link');
        link.setAttribute('data-lumno-pip-link', '1');
        link.rel = 'stylesheet';
        link.href = ownerNode.href;
        if (ownerNode.media) {
          link.media = ownerNode.media;
        }
        pipDocument.head.appendChild(link);
        return;
      }
      try {
        const cssRules = styleSheet.cssRules;
        if (!cssRules) {
          throw new Error('missing-css-rules');
        }
        const style = pipDocument.createElement('style');
        style.setAttribute('data-lumno-pip-style', '1');
        style.textContent = Array.from(cssRules).map((rule) => rule.cssText).join('\n');
        pipDocument.head.appendChild(style);
      } catch (error) {
        if (ownerNode instanceof HTMLStyleElement) {
          const style = pipDocument.createElement('style');
          style.setAttribute('data-lumno-pip-style', '1');
          style.textContent = ownerNode.textContent || '';
          pipDocument.head.appendChild(style);
        }
      }
    });

    const openerDocEl = document.documentElement;
    pipDocument.documentElement.className = openerDocEl.className;
    Array.from(openerDocEl.attributes).forEach((attr) => {
      if (attr && /^data-/.test(attr.name)) {
        pipDocument.documentElement.setAttribute(attr.name, attr.value);
      }
    });
    if (document.body) {
      pipDocument.body.className = document.body.className;
      Array.from(document.body.attributes).forEach((attr) => {
        if (attr && /^data-/.test(attr.name)) {
          pipDocument.body.setAttribute(attr.name, attr.value);
        }
      });
    }
  }

  function ensurePiPDocumentBase(pipDocument) {
    if (!pipDocument || !pipDocument.head) {
      return;
    }
    let base = pipDocument.getElementById('__lumno_pip_base_2026__');
    if (!base) {
      base = pipDocument.createElement('base');
      base.id = '__lumno_pip_base_2026__';
      pipDocument.head.insertBefore(base, pipDocument.head.firstChild || null);
    }
    base.href = document.baseURI || window.location.href;
  }

  function cloneContextNodeShallow(sourceNode, pipDocument) {
    if (!(sourceNode instanceof Element) || !pipDocument) {
      return null;
    }
    const tagName = String(sourceNode.tagName || '').toLowerCase();
    if (!tagName) {
      return null;
    }
    const clone = pipDocument.createElement(tagName);
    if (sourceNode.id) {
      clone.id = sourceNode.id;
    }
    if (sourceNode.className && typeof sourceNode.className === 'string') {
      clone.className = sourceNode.className;
    }
    Array.from(sourceNode.attributes).forEach((attr) => {
      if (!attr || !attr.name) {
        return;
      }
      const name = attr.name;
      if (name === 'id' || name === 'class') {
        return;
      }
      if (
        name === 'style' ||
        name === 'role' ||
        name === 'dir' ||
        name === 'lang' ||
        name.startsWith('data-') ||
        name.startsWith('aria-')
      ) {
        clone.setAttribute(name, attr.value);
      }
    });
    return clone;
  }

  function buildPiPContextChain(element, pipDocument) {
    const root = pipDocument.createElement('div');
    root.setAttribute('data-lumno-pip-context-root', '1');
    root.style.cssText = [
      'position: relative',
      'width: 100%',
      'height: auto',
      'box-sizing: border-box'
    ].join(';');

    const ancestors = [];
    let current = element instanceof Element ? element.parentElement : null;
    while (current && current !== document.body && current !== document.documentElement) {
      ancestors.push(current);
      current = current.parentElement;
    }
    ancestors.reverse();

    let mountPoint = root;
    ancestors.forEach((ancestor) => {
      const clonedAncestor = cloneContextNodeShallow(ancestor, pipDocument);
      if (!clonedAncestor) {
        return;
      }
      mountPoint.appendChild(clonedAncestor);
      mountPoint = clonedAncestor;
    });

    return {
      root: root,
      mountPoint: mountPoint
    };
  }

  function ensurePiPDockAssets(pipDocument) {
    if (!pipDocument || !pipDocument.head) {
      return;
    }
    if (!pipDocument.getElementById('__lumno_pip_remixicon_css_2026__')) {
      const link = pipDocument.createElement('link');
      link.id = '__lumno_pip_remixicon_css_2026__';
      link.rel = 'stylesheet';
      link.href = getRuntimeUrl('assets/remixicon/fonts/remixicon.css');
      pipDocument.head.appendChild(link);
    }
    if (!pipDocument.getElementById('__lumno_pip_dock_style_2026__')) {
      const style = pipDocument.createElement('style');
      style.id = '__lumno_pip_dock_style_2026__';
      style.textContent = `
        .lumno-pip-dock-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 0;
          border-radius: 999px;
          width: 36px;
          min-width: 36px;
          height: 36px;
          padding: 0;
          font: inherit;
          font-size: 12px;
          font-weight: 600;
          line-height: 1.2;
          cursor: pointer;
          transition: background-color 150ms ease, opacity 150ms ease;
          transform: none;
          opacity: 0.96;
          white-space: nowrap;
        }
        .lumno-pip-dock-btn:hover,
        .lumno-pip-dock-btn:focus-visible {
          transform: none;
          opacity: 1;
          outline: none;
        }
        .lumno-pip-dock-btn > * {
          cursor: inherit;
          pointer-events: none;
        }
        .lumno-pip-dock-btn .ri-icon {
          font-size: 15px;
          line-height: 1;
          transform: none;
          transition: transform 150ms ease;
        }
        .lumno-pip-dock-btn:hover .ri-icon,
        .lumno-pip-dock-btn:focus-visible .ri-icon {
          transform: scale(1.03);
        }
        .lumno-pip-dock-btn .lumno-pip-dock-label {
          display: inline-block;
          max-width: 0;
          overflow: hidden;
          transition: max-width 160ms ease, opacity 160ms ease, margin 160ms ease;
          opacity: 0;
          margin-left: 0;
        }
        [data-lumno-pip-dock="1"]:hover .lumno-pip-dock-btn .lumno-pip-dock-label,
        [data-lumno-pip-dock="1"]:focus-within .lumno-pip-dock-btn .lumno-pip-dock-label {
          max-width: 88px;
          opacity: 1;
          margin-left: 2px;
        }
        [data-lumno-pip-dock="1"]:hover .lumno-pip-dock-btn,
        [data-lumno-pip-dock="1"]:focus-within .lumno-pip-dock-btn {
          width: auto;
          padding: 9px 12px;
        }
      `;
      pipDocument.head.appendChild(style);
    }
  }

  function createPlaceholder(element, theme) {
    const rect = element.getBoundingClientRect();
    const computed = window.getComputedStyle(element);
    const placeholder = document.createElement('div');
    const preview = document.createElement('div');
    const clone = element.cloneNode(true);
    const badge = document.createElement('div');
    const borderRadius = theme && theme.borderRadius
      ? theme.borderRadius
      : (computed.borderRadius && computed.borderRadius !== '0px' ? computed.borderRadius : '16px');

    placeholder.setAttribute(PLACEHOLDER_ATTR, '1');
    applyNoTranslate(placeholder);
    placeholder.style.width = `${Math.max(1, Math.round(rect.width))}px`;
    placeholder.style.height = `${Math.max(1, Math.round(rect.height))}px`;
    placeholder.style.display = computed.display === 'inline' ? 'inline-block' : computed.display;
    placeholder.style.pointerEvents = 'none';
    placeholder.style.boxSizing = 'border-box';
    placeholder.style.marginTop = computed.marginTop;
    placeholder.style.marginRight = computed.marginRight;
    placeholder.style.marginBottom = computed.marginBottom;
    placeholder.style.marginLeft = computed.marginLeft;
    placeholder.style.flex = computed.flex;
    placeholder.style.alignSelf = computed.alignSelf;
    placeholder.style.position = 'relative';
    placeholder.style.overflow = 'hidden';
    placeholder.style.border = `2px dashed ${theme && theme.placeholderBorder ? theme.placeholderBorder : 'rgba(37, 99, 235, 0.58)'}`;
    placeholder.style.borderRadius = borderRadius;
    placeholder.style.background = theme && theme.placeholderBackground ? theme.placeholderBackground : 'rgba(37, 99, 235, 0.07)';
    placeholder.style.boxShadow = theme && theme.placeholderShadow ? theme.placeholderShadow : 'inset 0 0 0 1px rgba(255,255,255,0.46)';

    preview.style.cssText = [
      'position: absolute',
      'inset: 0',
      'overflow: hidden',
      'pointer-events: none',
      'user-select: none'
    ].join(';');

    if (clone && clone.nodeType === Node.ELEMENT_NODE) {
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('*').forEach((node) => {
        if (!(node instanceof Element)) {
          return;
        }
        node.setAttribute('aria-hidden', 'true');
      });
      clone.style.pointerEvents = 'none';
      clone.style.userSelect = 'none';
      clone.style.filter = 'grayscale(0.08) saturate(0.9)';
      clone.style.opacity = '0.88';
      clone.style.margin = '0';
      preview.appendChild(clone);
    }

    badge.textContent = getMessage('document_pip_picker_badge', 'Opened in PiP');
    applyNoTranslate(badge);
    badge.style.cssText = [
      'position: absolute',
      'top: 10px',
      'right: 10px',
      'max-width: calc(100% - 20px)',
      'padding: 6px 10px',
      'border-radius: 999px',
      `background: ${theme && theme.badgeBackground ? theme.badgeBackground : 'rgba(255, 255, 255, 0.9)'}`,
      `color: ${theme && theme.badgeText ? theme.badgeText : '#0f172a'}`,
      'font-size: 12px',
      'font-weight: 600',
      'line-height: 1.2',
      `box-shadow: ${theme && theme.cardShadow ? theme.cardShadow : '0 10px 24px rgba(15, 23, 42, 0.18)'}`,
      'white-space: nowrap',
      'overflow: hidden',
      'text-overflow: ellipsis'
    ].join(';');

    placeholder.appendChild(preview);
    placeholder.appendChild(badge);
    return {
      placeholder: placeholder,
      preview: preview,
      badge: badge
    };
  }

  function buildPlaceholderClone(element) {
    const clone = element.cloneNode(true);
    if (clone && clone.nodeType === Node.ELEMENT_NODE) {
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('*').forEach((node) => {
        if (!(node instanceof Element)) {
          return;
        }
        node.setAttribute('aria-hidden', 'true');
      });
      clone.style.pointerEvents = 'none';
      clone.style.userSelect = 'none';
      clone.style.filter = 'grayscale(0.08) saturate(0.9)';
      clone.style.opacity = '0.88';
      clone.style.margin = '0';
    }
    return clone;
  }

  function getElementTree(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE || typeof root.querySelectorAll !== 'function') {
      return [];
    }
    return [root].concat(Array.from(root.querySelectorAll('*')));
  }

  function copyUrlAttribute(sourceNode, cloneNode, attrName, propertyName) {
    if (!sourceNode || !cloneNode || !attrName || typeof sourceNode.getAttribute !== 'function' ||
        typeof cloneNode.setAttribute !== 'function') {
      return;
    }
    const raw = sourceNode.getAttribute(attrName);
    if (!raw || /^\s*(#|data:|blob:|javascript:)/i.test(raw)) {
      return;
    }
    const resolved = sourceNode[propertyName || attrName];
    if (typeof resolved === 'string' && resolved) {
      cloneNode.setAttribute(attrName, resolved);
    }
  }

  function syncCloneRuntimeState(sourceRoot, cloneRoot) {
    const sourceNodes = getElementTree(sourceRoot);
    const cloneNodes = getElementTree(cloneRoot);
    const count = Math.min(sourceNodes.length, cloneNodes.length);
    for (let index = 0; index < count; index += 1) {
      const sourceNode = sourceNodes[index];
      const cloneNode = cloneNodes[index];
      const tagName = String(sourceNode && sourceNode.tagName || '').toLowerCase();
      if (!tagName) {
        continue;
      }
      if (tagName === 'input') {
        cloneNode.value = sourceNode.value;
        cloneNode.checked = Boolean(sourceNode.checked);
        cloneNode.indeterminate = Boolean(sourceNode.indeterminate);
      } else if (tagName === 'textarea') {
        cloneNode.value = sourceNode.value;
        cloneNode.textContent = sourceNode.value;
      } else if (tagName === 'select') {
        cloneNode.selectedIndex = sourceNode.selectedIndex;
        Array.from(sourceNode.options || []).forEach((sourceOption, optionIndex) => {
          const cloneOption = cloneNode.options && cloneNode.options[optionIndex];
          if (cloneOption) {
            cloneOption.selected = Boolean(sourceOption.selected);
          }
        });
      } else if (tagName === 'option') {
        cloneNode.selected = Boolean(sourceNode.selected);
      } else if (tagName === 'details') {
        cloneNode.open = Boolean(sourceNode.open);
      } else if (tagName === 'canvas' && typeof sourceNode.getContext === 'function' && typeof cloneNode.getContext === 'function') {
        try {
          const context = cloneNode.getContext('2d');
          if (context) {
            context.drawImage(sourceNode, 0, 0);
          }
        } catch (error) {
          // Ignore canvas copies that are blocked by browser security.
        }
      }

      if (tagName === 'img') {
        copyUrlAttribute(sourceNode, cloneNode, 'src', sourceNode.currentSrc ? 'currentSrc' : 'src');
      } else if (tagName === 'source' || tagName === 'track' || tagName === 'script') {
        copyUrlAttribute(sourceNode, cloneNode, 'src', 'src');
      } else if (tagName === 'a' || tagName === 'area') {
        copyUrlAttribute(sourceNode, cloneNode, 'href', 'href');
      }
    }
  }

  function buildPiPElementClone(element, pipDocument) {
    if (!element || !pipDocument) {
      return null;
    }
    const clone = typeof pipDocument.importNode === 'function'
      ? pipDocument.importNode(element, true)
      : element.cloneNode(true);
    if (clone && clone.nodeType === Node.ELEMENT_NODE) {
      syncCloneRuntimeState(element, clone);
    }
    return clone;
  }

  function refreshPiPContent(session) {
    if (!session || !session.element || !session.pipDocument || !session.pipContentMount ||
        !session.pipWindow || session.pipWindow.closed) {
      return;
    }
    const clone = buildPiPElementClone(session.element, session.pipDocument);
    if (!clone) {
      return;
    }
    const scrollHost = session.pipContent || null;
    const scrollTop = scrollHost ? scrollHost.scrollTop : 0;
    const scrollLeft = scrollHost ? scrollHost.scrollLeft : 0;
    while (session.pipContentMount.firstChild) {
      session.pipContentMount.removeChild(session.pipContentMount.firstChild);
    }
    session.pipContentMount.appendChild(clone);
    session.pipElementClone = clone;
    if (scrollHost) {
      scrollHost.scrollTop = scrollTop;
      scrollHost.scrollLeft = scrollLeft;
    }
  }

  function schedulePiPContentRefresh(session) {
    if (!session || !session.element || !session.pipContentMount || session.contentSyncTimer != null) {
      return;
    }
    session.contentSyncTimer = window.setTimeout(() => {
      session.contentSyncTimer = null;
      refreshPiPContent(session);
    }, 80);
  }

  function syncPlaceholderMetrics(session) {
    if (!session || !session.element || !session.placeholder) {
      return;
    }
    const rect = session.element.getBoundingClientRect();
    const computed = window.getComputedStyle(session.element);
    session.placeholder.style.width = `${Math.max(1, Math.round(rect.width))}px`;
    session.placeholder.style.height = `${Math.max(1, Math.round(rect.height))}px`;
    session.placeholder.style.display = computed.display === 'inline' ? 'inline-block' : computed.display;
    session.placeholder.style.marginTop = computed.marginTop;
    session.placeholder.style.marginRight = computed.marginRight;
    session.placeholder.style.marginBottom = computed.marginBottom;
    session.placeholder.style.marginLeft = computed.marginLeft;
    session.placeholder.style.flex = computed.flex;
    session.placeholder.style.alignSelf = computed.alignSelf;
  }

  function refreshPlaceholderPreview(session) {
    if (!session || !session.preview || !session.element || !session.placeholder || !session.placeholder.isConnected) {
      return;
    }
    const clone = buildPlaceholderClone(session.element);
    session.preview.innerHTML = '';
    if (clone) {
      session.preview.appendChild(clone);
    }
    syncPlaceholderMetrics(session);
  }

  function schedulePlaceholderPreviewRefresh(session) {
    if (!session || !session.placeholder || !session.placeholder.isConnected || session.previewSyncTimer != null) {
      return;
    }
    session.previewSyncTimer = window.setTimeout(() => {
      session.previewSyncTimer = null;
      refreshPlaceholderPreview(session);
    }, 80);
  }

  function getSelectionSnapshot(element) {
    const rect = element.getBoundingClientRect();
    const requestedWidth = Math.round(rect.width || 520);
    const requestedHeight = Math.round(rect.height || 360);
    return {
      rect: rect,
      scrollX: Number(window.scrollX || window.pageXOffset || 0),
      scrollY: Number(window.scrollY || window.pageYOffset || 0),
      viewportWidth: Math.max(1, Number(window.innerWidth || document.documentElement.clientWidth || 0)),
      viewportHeight: Math.max(1, Number(window.innerHeight || document.documentElement.clientHeight || 0)),
      requestedWidth: Math.max(320, Math.min(1200, requestedWidth)),
      requestedHeight: Math.max(180, Math.min(900, requestedHeight))
    };
  }

  async function createPiPScaffold(element, visualTheme, snapshot) {
    const selection = snapshot || getSelectionSnapshot(element);
    const savedBounds = await loadSavedDocumentPiPBounds();
    const requestOptions = {
      width: selection.requestedWidth,
      height: selection.requestedHeight
    };
    if (savedBounds && Number.isFinite(savedBounds.left) && Number.isFinite(savedBounds.top)) {
      requestOptions.left = savedBounds.left;
      requestOptions.top = savedBounds.top;
    }
    const pipWindow = await window.documentPictureInPicture.requestWindow(requestOptions);
    if (savedBounds &&
      Number.isFinite(savedBounds.left) &&
      Number.isFinite(savedBounds.top) &&
      typeof pipWindow.moveTo === 'function') {
      try {
        pipWindow.moveTo(savedBounds.left, savedBounds.top);
      } catch (error) {
        // Ignore browsers that do not allow repositioning after opening.
      }
    }
    copyStylesToPiP(pipWindow);
    ensurePiPDockAssets(pipWindow.document);

    const pipDocument = pipWindow.document;
    pipDocument.title = document.title || 'Lumno PiP';
    pipDocument.body.innerHTML = '';
    pipDocument.body.style.cssText = [
      'margin: 0',
      'min-height: 100vh',
      `background: ${visualTheme.pageBackground}`
    ].join(';');

    persistDocumentPiPBoundsFromWindow(pipWindow);

    const shell = pipDocument.createElement('div');
    shell.style.cssText = [
      'position: relative',
      'min-height: 100vh',
      `background: ${visualTheme.pageBackground}`,
      'box-sizing: border-box'
    ].join(';');

    const content = pipDocument.createElement('div');
    content.style.cssText = `min-height: 100vh; overflow: auto; padding: 0 0 ${PIP_DOCK_CLEARANCE}px 0; background: ${visualTheme.pageBackground}; box-sizing: border-box;`;

    shell.appendChild(content);
    pipDocument.body.appendChild(shell);

    return {
      pipWindow: pipWindow,
      pipDocument: pipDocument,
      shell: shell,
      content: content,
      selection: selection
    };
  }

  function createPiPDock(pipContext) {
    const { pipWindow, pipDocument, shell, visualTheme } = pipContext;
    const dock = pipDocument.createElement('div');
    dock.setAttribute('data-lumno-pip-dock', '1');
    applyNoTranslate(dock);
    dock.style.cssText = [
      'position: fixed',
      'left: 50%',
      'bottom: 10px',
      'transform: translateX(-50%) translateY(calc(100% - 8px))',
      'display: flex',
      'align-items: center',
      'gap: 8px',
      'padding: 8px 10px 12px',
      'border-radius: 999px',
      `background: ${visualTheme.hudBackground}`,
      `border: 1px solid ${visualTheme.hudBorder}`,
      `box-shadow: ${visualTheme.cardShadow}`,
      'backdrop-filter: blur(16px)',
      '-webkit-backdrop-filter: blur(16px)',
      'transition: transform 180ms ease, opacity 180ms ease',
      'opacity: 0.92',
      'z-index: 2147483647'
    ].join(';');

    const buildDockButton = (label, iconClass) => {
      const button = pipDocument.createElement('button');
      button.type = 'button';
      button.className = 'lumno-pip-dock-btn';
      applyNoTranslate(button);
      button.style.cssText = [
        `background: ${visualTheme.buttonBackground}`,
        `color: ${visualTheme.buttonText}`,
        `box-shadow: ${visualTheme.placeholderShadow}`
      ].join(';');
      const icon = pipDocument.createElement('i');
      icon.className = `ri-icon ${iconClass}`;
      applyNoTranslate(icon);
      const text = pipDocument.createElement('span');
      text.className = 'lumno-pip-dock-label';
      text.textContent = label;
      applyNoTranslate(text);
      button.appendChild(icon);
      button.appendChild(text);
      return button;
    };

    const showDock = () => {
      if (dock._xHideTimer) {
        pipWindow.clearTimeout(dock._xHideTimer);
        dock._xHideTimer = null;
      }
      dock.style.transform = 'translateX(-50%) translateY(0)';
      dock.style.opacity = '1';
    };

    const hideDock = () => {
      if (dock._xHideTimer) {
        pipWindow.clearTimeout(dock._xHideTimer);
      }
      dock._xHideTimer = pipWindow.setTimeout(() => {
        dock._xHideTimer = null;
        dock.style.transform = 'translateX(-50%) translateY(calc(100% - 8px))';
        dock.style.opacity = '0.92';
      }, 140);
    };

    const closeButton = buildDockButton(getMessage('document_pip_picker_button_close', 'Close'), 'ri-close-line');
    closeButton.style.background = visualTheme.secondaryButtonBackground;
    closeButton.addEventListener('click', () => {
      restoreSession({ closeWindow: true });
    });

    const reselectButton = buildDockButton(getMessage('document_pip_picker_button_reselect', 'Reselect'), 'ri-focus-3-line');
    reselectButton.addEventListener('click', () => {
      restoreSession({ closeWindow: true });
      window.requestAnimationFrame(() => {
        startSelection();
      });
    });

    dock.appendChild(reselectButton);
    dock.appendChild(closeButton);
    dock.addEventListener('mouseenter', showDock);
    dock.addEventListener('mouseleave', hideDock);
    dock.addEventListener('focusin', showDock);
    dock.addEventListener('focusout', hideDock);
    pipDocument.addEventListener('mousemove', (event) => {
      const y = Number(event && event.clientY);
      const height = Number(pipWindow.innerHeight || 0);
      if (height > 0 && y >= height - 48) {
        showDock();
        return;
      }
      hideDock();
    });

    shell.appendChild(dock);
    return dock;
  }

  function restoreSession(options) {
    const session = state.session;
    if (!session) {
      releaseDocumentPipOwnership();
      return false;
    }
    state.session = null;
    window[STATE_FLAG] = false;

    if (session.syncObserver) {
      session.syncObserver.disconnect();
    }
    if (session.previewObserver) {
      session.previewObserver.disconnect();
    }
    if (session.resizeObserver) {
      session.resizeObserver.disconnect();
    }
    if (session.previewSyncTimer != null) {
      window.clearTimeout(session.previewSyncTimer);
      session.previewSyncTimer = null;
    }
    if (session.contentSyncTimer != null) {
      window.clearTimeout(session.contentSyncTimer);
      session.contentSyncTimer = null;
    }
    if (session.onMainPageHide) {
      window.removeEventListener('pagehide', session.onMainPageHide, true);
    }
    if (session.dock && session.dock._xHideTimer) {
      try {
        session.pipWindow.clearTimeout(session.dock._xHideTimer);
      } catch (error) {
        // Ignore timer cleanup failures.
      }
      session.dock._xHideTimer = null;
    }

    const element = session.element;
    const placeholder = session.placeholder;
    const originalParent = session.originalParent;
    const originalNextSibling = session.originalNextSibling;
    const canRestoreToParent = originalParent instanceof Node && originalParent.isConnected;
    if (session.movedElement !== false) {
      if (element && canRestoreToParent) {
        if (placeholder && placeholder.parentNode === originalParent) {
          originalParent.insertBefore(element, placeholder);
          placeholder.remove();
        } else if (originalNextSibling && originalNextSibling.parentNode === originalParent) {
          originalParent.insertBefore(element, originalNextSibling);
        } else {
          originalParent.appendChild(element);
        }
      } else if (element && document.body) {
        document.body.appendChild(element);
      }
    }

    if (placeholder && placeholder.isConnected) {
      placeholder.remove();
    }

    if (!options || options.closeWindow !== false) {
      try {
        if (session.pipWindow && !session.pipWindow.closed) {
          session.pipWindow.close();
        }
      } catch (error) {
        // Ignore close failures.
      }
    }
    setHighlight(null);
    releaseDocumentPipOwnership();
    return true;
  }

  async function openDocumentPiP(element) {
    if (!isAllowedElement(element)) {
      showToast(
        getMessage(
          'document_pip_picker_invalid',
          'This element cannot be opened in the floating window.'
        ),
        'error'
      );
      return { ok: false, reason: 'invalid-element' };
    }

    if (containsBlockedMediaContent(element)) {
      showToast(
        getMessage(
          'document_pip_picker_invalid',
          'This element cannot be opened in the floating window.'
        ),
        'error'
      );
      return { ok: false, reason: 'media-selection-blocked' };
    }

    if (hasActiveVideoPiP()) {
      showVideoPiPConflictToast();
      return { ok: false, reason: 'video-pip-active' };
    }

    const ownership = await requestDocumentPipOwnership();
    if (!ownership.granted) {
      showToast(getOpenFailureMessage({ name: 'InvalidStateError' }), 'error');
      return { ok: false, reason: ownership.reason || 'document-owner-busy' };
    }

    const visualTheme = getVisualTheme(element);
    let scaffold = null;
    try {
      scaffold = await createPiPScaffold(element, visualTheme, getSelectionSnapshot(element));
    } catch (error) {
      releaseDocumentPipOwnership();
      showToast(getOpenFailureMessage(error), 'error');
      return {
        ok: false,
        reason: 'request-window-failed',
        errorName: error && error.name ? String(error.name) : '',
        errorMessage: error && error.message ? String(error.message) : ''
      };
    }
    const { pipWindow, pipDocument, shell, content } = scaffold;
    const dock = createPiPDock({
      pipWindow,
      pipDocument,
      shell,
      visualTheme
    });

    let placeholder = null;
    let placeholderParts = null;
    const originalParent = element.parentNode;
    const originalNextSibling = element.nextSibling;
    const contextChain = buildPiPContextChain(element, pipDocument);
    content.appendChild(contextChain.root);

    const syncObserver = new MutationObserver(() => {
      copyStylesToPiP(pipWindow);
    });
    syncObserver.observe(document.documentElement, {
      attributes: true
    });
    if (document.body) {
      syncObserver.observe(document.body, {
        attributes: true
      });
    }
    if (document.head) {
      syncObserver.observe(document.head, {
        childList: true,
        subtree: true
      });
    }

    const previewObserver = new MutationObserver(() => {
      if (state.session) {
        schedulePiPContentRefresh(state.session);
        schedulePlaceholderPreviewRefresh(state.session);
      }
    });
    previewObserver.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    });

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        if (state.session) {
          schedulePiPContentRefresh(state.session);
          syncPlaceholderMetrics(state.session);
        }
      });
      resizeObserver.observe(element);
    }

    const onPiPPageHide = () => {
      persistDocumentPiPBoundsFromWindow(pipWindow);
      restoreSession({ closeWindow: false });
    };
    const onMainPageHide = () => {
      persistDocumentPiPBoundsFromWindow(pipWindow);
      restoreSession({ closeWindow: true });
    };
    pipWindow.addEventListener('pagehide', onPiPPageHide, { once: true });
    window.addEventListener('pagehide', onMainPageHide, true);
    pipWindow.addEventListener('resize', () => {
      persistDocumentPiPBoundsFromWindow(pipWindow);
    });
    pipWindow.addEventListener('beforeunload', () => {
      persistDocumentPiPBoundsFromWindow(pipWindow);
    });

    state.session = {
      element: element,
      pipWindow: pipWindow,
      pipDocument: pipDocument,
      pipContent: content,
      pipContentMount: contextChain.mountPoint,
      pipElementClone: null,
      placeholder: placeholder,
      preview: placeholderParts ? placeholderParts.preview : null,
      originalParent: originalParent,
      originalNextSibling: originalNextSibling,
      movedElement: false,
      syncObserver: syncObserver,
      previewObserver: previewObserver,
      resizeObserver: resizeObserver,
      contentSyncTimer: null,
      previewSyncTimer: null,
      dock: dock,
      onMainPageHide: onMainPageHide
    };
    refreshPiPContent(state.session);
    window[STATE_FLAG] = true;
    return { ok: true };
  }

  function stopSelection(options) {
    state.active = false;
    state.currentTarget = null;
    state.currentStack = [];
    state.currentStackIndex = 0;
    state.currentTheme = null;
    state.opening = false;
    if (typeof state.teardownSelection === 'function') {
      state.teardownSelection();
      state.teardownSelection = null;
    }
    hideToast();
    if (!options || options.clearHighlight !== false) {
      setHighlight(null);
    }
  }

  async function confirmCurrentTarget() {
    if (!state.active || state.opening) {
      return;
    }
    const target = state.currentTarget;
    if (!target) {
      return;
    }
    state.opening = true;
    stopSelection({});
    try {
      const result = await openDocumentPiP(target);
      if (!result || result.ok !== true) {
        releaseDocumentPipOwnership();
        setHighlight(null);
      }
    } catch (error) {
      releaseDocumentPipOwnership();
      setHighlight(null);
      showToast(
        getMessage(
          'document_pip_picker_open_failed',
          'Failed to open the floating content window. Try a different area'
        ),
        'error'
      );
    }
  }

  function startSelection() {
    const support = getDocumentPiPSupportState();
    if (!support.supported) {
      showToast(
        getSupportFailureMessage(support.reason),
        'error'
      );
      return { ok: false, state: 'unsupported', reason: support.reason };
    }
    if (state.active) {
      return { ok: true, state: 'already-active' };
    }
    if (hasActiveVideoPiP()) {
      showVideoPiPConflictToast();
      return { ok: false, state: 'blocked-by-video-pip' };
    }
    ensurePickerUi();
    applyPickerTheme(getPickerTheme(null));
    state.active = true;

    const onMouseMove = (event) => {
      if (!state.active) {
        return;
      }
      updateCurrentTargetFromPointer(event);
    };

    const onWheel = (event) => {
      if (!state.active || !state.currentStack.length) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.sign(event.deltaY || 0);
      if (delta === 0) {
        return;
      }
      selectTargetFromStack(state.currentStackIndex + (delta > 0 ? 1 : -1));
    };

    const onKeyDown = (event) => {
      if (!state.active) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        stopSelection({});
        showToast(
          getMessage('document_pip_picker_cancelled', 'Content selection closed'),
          'info'
        );
        return;
      }
      if ((event.key === '[' || event.key === 'ArrowUp') && state.currentStack.length) {
        event.preventDefault();
        event.stopPropagation();
        selectTargetFromStack(state.currentStackIndex + 1);
        return;
      }
      if ((event.key === ']' || event.key === 'ArrowDown') && state.currentStack.length) {
        event.preventDefault();
        event.stopPropagation();
        selectTargetFromStack(state.currentStackIndex - 1);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'NumpadEnter') && state.currentTarget) {
        event.preventDefault();
        event.stopPropagation();
        confirmCurrentTarget();
      }
    };

    const onClick = async (event) => {
      if (!state.active) {
        return;
      }
      if (isOwnNode(event.target)) {
        return;
      }
      if (!state.currentTarget) {
        updateCurrentTargetFromPointer(event);
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      await confirmCurrentTarget();
    };

    const onPointerBlockingEvent = (event) => {
      if (!state.active) {
        return;
      }
      if (isOwnNode(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerBlockingEvent, true);
    window.addEventListener('mousedown', onPointerBlockingEvent, true);
    window.addEventListener('mouseup', onPointerBlockingEvent, true);
    window.addEventListener('click', onClick, true);

    state.teardownSelection = () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerBlockingEvent, true);
      window.removeEventListener('mousedown', onPointerBlockingEvent, true);
      window.removeEventListener('mouseup', onPointerBlockingEvent, true);
      window.removeEventListener('click', onClick, true);
    };

    showToast(
      getMessage(
        'document_pip_picker_started',
        'Hover to select, press Enter to float. Scroll to change scope, or press Esc to cancel'
      ),
      'info',
      { persistent: true }
    );
    return { ok: true, state: 'started' };
  }

  function toggle() {
    if (state.session) {
      restoreSession({ closeWindow: true });
      showToast(
        getMessage('document_pip_picker_closed', 'Floating content window closed'),
        'info'
      );
      return { ok: true, state: 'closed' };
    }
    if (state.active) {
      stopSelection({});
      showToast(
        getMessage('document_pip_picker_cancelled', 'Content selection closed'),
        'info'
      );
      return { ok: true, state: 'cancelled' };
    }
    return startSelection();
  }

  function bindRuntimeMessageListener() {
    if (state.runtimeMessageHandlerBound) {
      return;
    }
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage ||
        typeof chrome.runtime.onMessage.addListener !== 'function') {
      return;
    }
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.action !== 'lumno:pip-force-surrender') {
        return;
      }
      if (state.active) {
        stopSelection({});
      }
      restoreSession({ closeWindow: true });
      sendResponse({ ok: true });
      return true;
    });
    state.runtimeMessageHandlerBound = true;
  }

  bindRuntimeMessageListener();

  window.__lumnoDocumentPiPPicker2026 = {
    toggle: toggle,
    restore: () => restoreSession({ closeWindow: true }),
    notifyVideoPiPConflict: () => {
      if (state.active) {
        stopSelection({});
      }
      showVideoPiPConflictToast();
      return { ok: false, state: 'blocked-by-video-pip' };
    }
  };
})();
