(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoRecentTabSwitcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_LIMIT = 5;
  const STACK_BUFFER_MULTIPLIER = 4;
  const DEFAULT_THUMBNAIL_LIMIT = 10;
  const DEFAULT_THUMBNAIL_TTL_MS = 1000 * 60 * 60 * 2;
  const STATE_VERSION = 1;

  function toPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function getResolvedTabUrl(tab) {
    if (!tab || typeof tab !== 'object') {
      return '';
    }
    const directUrl = typeof tab.url === 'string' ? tab.url.trim() : '';
    if (directUrl) {
      return directUrl;
    }
    return typeof tab.pendingUrl === 'string' ? tab.pendingUrl.trim() : '';
  }

  function defaultShouldIncludeTab(tab) {
    if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number' || tab.incognito === true) {
      return false;
    }
    const url = getResolvedTabUrl(tab);
    if (!url) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function getShortcutCommitModifierEventKey(shortcut) {
    const shortcutText = String(shortcut || '').trim();
    const symbolModifiers = Array.from(shortcutText).map((token) => {
      if (token === '⌥') {
        return 'Alt';
      }
      if (token === '⌃') {
        return 'Control';
      }
      if (token === '⌘') {
        return 'Meta';
      }
      if (token === '⇧') {
        return 'Shift';
      }
      return '';
    }).filter(Boolean);
    if (symbolModifiers.length) {
      return symbolModifiers.find((key) => key !== 'Shift') || symbolModifiers[0] || '';
    }
    const parts = shortcutText
      .split('+')
      .map((part) => String(part || '').trim().toLowerCase())
      .filter(Boolean);
    const modifiers = parts.slice(0, -1).map((token) => {
      if (token === 'alt' || token === 'option') {
        return 'Alt';
      }
      if (token === 'ctrl' || token === 'control' || token === 'macctrl') {
        return 'Control';
      }
      if (token === 'command' || token === 'cmd' || token === 'meta' || token === 'super') {
        return 'Meta';
      }
      if (token === 'shift') {
        return 'Shift';
      }
      return '';
    }).filter(Boolean);
    return modifiers.find((key) => key !== 'Shift') || modifiers[0] || '';
  }

  function getShortcutTriggerEventKey(shortcut) {
    const shortcutText = String(shortcut || '').trim();
    const parts = shortcutText
      .split('+')
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    const symbolTrigger = /[⌥⌃⌘⇧]/.test(shortcutText)
      ? shortcutText.replace(/[⌥⌃⌘⇧]/g, '').replace(/^\++/, '').trim()
      : '';
    const rawToken = symbolTrigger || String(parts[parts.length - 1] || '');
    const token = rawToken.toLowerCase();
    const aliases = {
      comma: ',',
      period: '.',
      slash: '/',
      backslash: '\\',
      return: 'Enter',
      esc: 'Escape',
      space: ' ',
      spacebar: ' '
    };
    if (aliases[token]) {
      return aliases[token];
    }
    if (/^f\d{1,2}$/.test(token)) {
      return token.toUpperCase();
    }
    return token.length === 1 ? token : rawToken;
  }

  function getShortcutReleaseEventKeys(shortcut) {
    const modifierKey = getShortcutCommitModifierEventKey(shortcut);
    if (!modifierKey) {
      return [];
    }
    return [modifierKey];
  }

  function sanitizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeUrl(value) {
    return String(value || '').trim();
  }

  function normalizeThumbnailStatus(value, fallback) {
    const status = String(value || '').trim().toLowerCase();
    if (status === 'ok' ||
        status === 'pending' ||
        status === 'failed' ||
        status === 'restricted') {
      return status;
    }
    return fallback || 'missing';
  }

  function normalizeThumbnailEntry(tabId, raw, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
    const ttlMs = Number.isFinite(Number(opts.ttlMs)) ? Math.max(0, Number(opts.ttlMs)) : DEFAULT_THUMBNAIL_TTL_MS;
    if (typeof tabId !== 'number' || !raw || typeof raw !== 'object') {
      return null;
    }
    const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl : '';
    const hasImage = dataUrl.startsWith('data:image/');
    const status = normalizeThumbnailStatus(raw.status, hasImage ? 'ok' : 'missing');
    if (status === 'missing' || (status === 'ok' && !hasImage)) {
      return null;
    }
    const capturedAt = Number(raw.capturedAt) || (hasImage ? now : 0);
    const updatedAt = Number(raw.updatedAt) || capturedAt || now;
    if (ttlMs > 0 && (now - updatedAt) > ttlMs) {
      return null;
    }
    return {
      tabId,
      url: normalizeUrl(raw.url),
      dataUrl: hasImage ? dataUrl : '',
      capturedAt,
      updatedAt,
      status,
      reason: sanitizeText(raw.reason)
    };
  }

  function normalizeTabSnapshot(tab, visitedAt, shouldIncludeTab) {
    if (!shouldIncludeTab(tab)) {
      return null;
    }
    const now = Number.isFinite(Number(visitedAt)) ? Number(visitedAt) : Date.now();
    return {
      id: tab.id,
      windowId: tab.windowId,
      url: getResolvedTabUrl(tab),
      title: sanitizeText(tab.title),
      favIconUrl: typeof tab.favIconUrl === 'string' ? tab.favIconUrl : '',
      lastAccessed: Number(tab.lastAccessed) || now,
      visitedAt: now
    };
  }

  function createRecentTabTracker(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const limit = toPositiveInteger(settings.limit, DEFAULT_LIMIT);
    const stackLimit = Math.max(limit, limit * STACK_BUFFER_MULTIPLIER);
    const thumbnailLimit = toPositiveInteger(settings.thumbnailLimit, DEFAULT_THUMBNAIL_LIMIT);
    const thumbnailTtlMs = Math.max(0, Number(settings.thumbnailTtlMs) || DEFAULT_THUMBNAIL_TTL_MS);
    const shouldIncludeTab = typeof settings.shouldIncludeTab === 'function'
      ? settings.shouldIncludeTab
      : defaultShouldIncludeTab;
    const recentStack = [];
    const thumbnailByTabId = new Map();

    function trimStack() {
      if (recentStack.length > stackLimit) {
        recentStack.splice(stackLimit);
      }
    }

    function pruneThumbnails(now) {
      const referenceNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
      Array.from(thumbnailByTabId.entries()).forEach(([tabId, entry]) => {
        const normalized = normalizeThumbnailEntry(tabId, entry, {
          now: referenceNow,
          ttlMs: thumbnailTtlMs
        });
        if (!normalized) {
          thumbnailByTabId.delete(tabId);
        }
      });
      const sortedEntries = Array.from(thumbnailByTabId.entries())
        .sort((a, b) => {
          const timeA = Number(a[1] && (a[1].updatedAt || a[1].capturedAt)) || 0;
          const timeB = Number(b[1] && (b[1].updatedAt || b[1].capturedAt)) || 0;
          return timeB - timeA;
        });
      sortedEntries.slice(thumbnailLimit).forEach(([tabId]) => {
        thumbnailByTabId.delete(tabId);
      });
    }

    function removeStackEntry(tabId) {
      if (typeof tabId !== 'number') {
        return false;
      }
      const before = recentStack.length;
      for (let index = recentStack.length - 1; index >= 0; index -= 1) {
        if (recentStack[index] && recentStack[index].id === tabId) {
          recentStack.splice(index, 1);
        }
      }
      return recentStack.length !== before;
    }

    function removeTab(tabId) {
      if (typeof tabId !== 'number') {
        return false;
      }
      const didRemoveStackEntry = removeStackEntry(tabId);
      const didRemoveThumbnail = thumbnailByTabId.delete(tabId);
      return didRemoveStackEntry || didRemoveThumbnail;
    }

    function recordTab(tab, visitedAt) {
      const snapshot = normalizeTabSnapshot(tab, visitedAt, shouldIncludeTab);
      if (!snapshot) {
        if (tab && typeof tab.id === 'number') {
          removeTab(tab.id);
        }
        return null;
      }
      removeStackEntry(snapshot.id);
      recentStack.unshift(snapshot);
      trimStack();
      return snapshot;
    }

    function updateTab(tab, visitedAt) {
      if (!tab || typeof tab.id !== 'number') {
        return null;
      }
      const existingIndex = recentStack.findIndex((item) => item && item.id === tab.id);
      if (existingIndex < 0) {
        return null;
      }
      const previous = recentStack[existingIndex];
      const snapshot = normalizeTabSnapshot(tab, visitedAt || previous.visitedAt, shouldIncludeTab);
      if (!snapshot) {
        removeTab(tab.id);
        return null;
      }
      if (normalizeUrl(previous.url) !== normalizeUrl(snapshot.url)) {
        thumbnailByTabId.delete(tab.id);
      }
      recentStack[existingIndex] = {
        ...previous,
        ...snapshot,
        visitedAt: previous.visitedAt
      };
      return recentStack[existingIndex];
    }

    function getRecentTabs(tabs, requestOptions) {
      const request = requestOptions && typeof requestOptions === 'object' ? requestOptions : {};
      const requestedLimit = toPositiveInteger(request.limit, limit);
      const tabList = Array.isArray(tabs) ? tabs : [];
      const tabById = new Map();
      tabList.forEach((tab) => {
        if (tab && typeof tab.id === 'number' && shouldIncludeTab(tab)) {
          tabById.set(tab.id, {
            ...tab,
            url: getResolvedTabUrl(tab)
          });
        }
      });

      const results = [];
      const seenIds = new Set();
      recentStack.forEach((snapshot) => {
        if (!snapshot || seenIds.has(snapshot.id)) {
          return;
        }
        const liveTab = tabById.get(snapshot.id);
        if (!liveTab) {
          return;
        }
        seenIds.add(snapshot.id);
        const thumbnailState = getThumbnailState(snapshot.id, getResolvedTabUrl(liveTab) || snapshot.url);
        results.push({
          ...snapshot,
          ...liveTab,
          url: getResolvedTabUrl(liveTab) || snapshot.url,
          title: sanitizeText(liveTab.title) || snapshot.title,
          favIconUrl: liveTab.favIconUrl || snapshot.favIconUrl || '',
          _xSwitcherVisitedAt: snapshot.visitedAt,
          _xSwitcherThumbnail: thumbnailState.dataUrl,
          _xSwitcherThumbnailStatus: thumbnailState.status,
          _xSwitcherThumbnailReason: thumbnailState.reason
        });
      });

      if (results.length < requestedLimit) {
        tabList
          .filter((tab) => tab && typeof tab.id === 'number' && !seenIds.has(tab.id) && shouldIncludeTab(tab))
          .slice()
          .sort((a, b) => {
            const accessA = Number(a.lastAccessed) || 0;
            const accessB = Number(b.lastAccessed) || 0;
            return accessB - accessA;
          })
          .forEach((tab) => {
            if (results.length >= requestedLimit || seenIds.has(tab.id)) {
              return;
            }
            seenIds.add(tab.id);
            const thumbnailState = getThumbnailState(tab.id, getResolvedTabUrl(tab));
            results.push({
              ...tab,
              url: getResolvedTabUrl(tab),
              title: sanitizeText(tab.title),
              favIconUrl: tab.favIconUrl || '',
              _xSwitcherVisitedAt: Number(tab.lastAccessed) || 0,
              _xSwitcherThumbnail: thumbnailState.dataUrl,
              _xSwitcherThumbnailStatus: thumbnailState.status,
              _xSwitcherThumbnailReason: thumbnailState.reason
            });
          });
      }

      return results.slice(0, requestedLimit);
    }

    function setThumbnail(tabId, dataUrl, capturedAt, metadata) {
      if (typeof tabId !== 'number') {
        return false;
      }
      const value = typeof dataUrl === 'string' ? dataUrl : '';
      if (!value || !value.startsWith('data:image/')) {
        thumbnailByTabId.delete(tabId);
        return false;
      }
      const meta = metadata && typeof metadata === 'object' ? metadata : {};
      const entry = normalizeThumbnailEntry(tabId, {
        dataUrl: value,
        url: normalizeUrl(meta.url),
        capturedAt: Number(capturedAt) || Date.now(),
        updatedAt: Number(capturedAt) || Date.now(),
        status: 'ok',
        reason: ''
      }, {
        ttlMs: thumbnailTtlMs
      });
      if (!entry) {
        thumbnailByTabId.delete(tabId);
        return false;
      }
      thumbnailByTabId.set(tabId, entry);
      pruneThumbnails(entry.capturedAt);
      return true;
    }

    function setThumbnailStatus(tabId, status, updatedAt, metadata) {
      if (typeof tabId !== 'number') {
        return false;
      }
      const normalizedStatus = normalizeThumbnailStatus(status, '');
      if (!normalizedStatus || normalizedStatus === 'missing' || normalizedStatus === 'ok') {
        return false;
      }
      const meta = metadata && typeof metadata === 'object' ? metadata : {};
      const url = normalizeUrl(meta.url);
      const existing = normalizeThumbnailEntry(tabId, thumbnailByTabId.get(tabId), {
        ttlMs: thumbnailTtlMs
      });
      const canKeepImage = existing &&
        existing.dataUrl &&
        (!url || !existing.url || existing.url === url);
      const entry = normalizeThumbnailEntry(tabId, {
        dataUrl: canKeepImage ? existing.dataUrl : '',
        url: url || (existing ? existing.url : ''),
        capturedAt: canKeepImage ? existing.capturedAt : 0,
        updatedAt: Number(updatedAt) || Date.now(),
        status: normalizedStatus,
        reason: sanitizeText(meta.reason)
      }, {
        ttlMs: thumbnailTtlMs
      });
      if (!entry) {
        thumbnailByTabId.delete(tabId);
        return false;
      }
      thumbnailByTabId.set(tabId, entry);
      pruneThumbnails(entry.updatedAt);
      return true;
    }

    function getThumbnailState(tabId, expectedUrl) {
      const entry = thumbnailByTabId.get(tabId);
      const normalized = normalizeThumbnailEntry(tabId, entry, {
        ttlMs: thumbnailTtlMs
      });
      if (!normalized) {
        thumbnailByTabId.delete(tabId);
        return {
          status: 'missing',
          reason: '',
          dataUrl: '',
          capturedAt: 0,
          updatedAt: 0
        };
      }
      const url = normalizeUrl(expectedUrl);
      if (url && normalized.url && normalized.url !== url) {
        return {
          status: 'stale',
          reason: 'url-mismatch',
          dataUrl: '',
          capturedAt: normalized.capturedAt || 0,
          updatedAt: normalized.updatedAt || normalized.capturedAt || 0
        };
      }
      return {
        status: normalized.status || (normalized.dataUrl ? 'ok' : 'missing'),
        reason: normalized.reason || '',
        dataUrl: normalized.dataUrl || '',
        capturedAt: normalized.capturedAt || 0,
        updatedAt: normalized.updatedAt || normalized.capturedAt || 0
      };
    }

    function getThumbnail(tabId, expectedUrl) {
      return getThumbnailState(tabId, expectedUrl).dataUrl || '';
    }

    function getStackSnapshot() {
      return recentStack.map((item) => ({ ...item }));
    }

    function mergeThumbnailEntries(tabId, baseEntry, overlayEntry, now) {
      const base = normalizeThumbnailEntry(tabId, baseEntry, {
        now,
        ttlMs: thumbnailTtlMs
      });
      const overlay = normalizeThumbnailEntry(tabId, overlayEntry, {
        now,
        ttlMs: thumbnailTtlMs
      });
      if (!base) {
        return overlay;
      }
      if (!overlay) {
        return base;
      }
      const sameTarget = !base.url || !overlay.url || base.url === overlay.url;
      if (!sameTarget || overlay.dataUrl) {
        return overlay;
      }
      if (!base.dataUrl) {
        return overlay;
      }
      return normalizeThumbnailEntry(tabId, {
        ...overlay,
        url: overlay.url || base.url,
        dataUrl: base.dataUrl,
        capturedAt: base.capturedAt,
        updatedAt: Math.max(Number(base.updatedAt) || 0, Number(overlay.updatedAt) || 0)
      }, {
        now,
        ttlMs: thumbnailTtlMs
      });
    }

    function exportState(optionsArg) {
      const opts = optionsArg && typeof optionsArg === 'object' ? optionsArg : {};
      const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
      pruneThumbnails(now);
      return {
        version: STATE_VERSION,
        savedAt: now,
        stack: getStackSnapshot(),
        thumbnails: Array.from(thumbnailByTabId.values()).map((entry) => ({ ...entry }))
      };
    }

    function hydrateState(state, optionsArg) {
      const opts = optionsArg && typeof optionsArg === 'object' ? optionsArg : {};
      const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
      const shouldMerge = opts.merge === true;
      if (!state || typeof state !== 'object') {
        return false;
      }
      const pendingStack = shouldMerge ? getStackSnapshot() : [];
      const pendingThumbnails = shouldMerge
        ? Array.from(thumbnailByTabId.entries()).map(([tabId, entry]) => [tabId, { ...entry }])
        : [];
      recentStack.splice(0, recentStack.length);
      thumbnailByTabId.clear();
      const stack = Array.isArray(state.stack) ? state.stack : [];
      const stackItems = shouldMerge ? pendingStack.concat(stack) : stack;
      stackItems.forEach((item) => {
        const snapshot = normalizeTabSnapshot(item, item && item.visitedAt, shouldIncludeTab);
        if (!snapshot) {
          return;
        }
        if (recentStack.some((existing) => existing && existing.id === snapshot.id)) {
          return;
        }
        recentStack.push(snapshot);
      });
      trimStack();
      const thumbnails = Array.isArray(state.thumbnails) ? state.thumbnails : [];
      thumbnails.forEach((item) => {
        const tabId = Number(item && item.tabId);
        if (!Number.isInteger(tabId)) {
          return;
        }
        const entry = normalizeThumbnailEntry(tabId, item, {
          now,
          ttlMs: thumbnailTtlMs
        });
        if (entry) {
          thumbnailByTabId.set(tabId, entry);
        }
      });
      pendingThumbnails.forEach(([tabId, item]) => {
        const entry = mergeThumbnailEntries(tabId, thumbnailByTabId.get(tabId), item, now);
        if (entry) {
          thumbnailByTabId.set(tabId, entry);
        }
      });
      pruneThumbnails(now);
      return true;
    }

    return Object.freeze({
      recordTab,
      updateTab,
      removeTab,
      getRecentTabs,
      setThumbnail,
      setThumbnailStatus,
      getThumbnailState,
      getThumbnail,
      getStackSnapshot,
      exportState,
      hydrateState
    });
  }

  function callChromeCallback(fn) {
    return new Promise((resolve) => {
      try {
        fn((value) => resolve(value || null));
      } catch (error) {
        resolve(null);
      }
    });
  }

  function getRuntimeError(chromeApi) {
    return chromeApi && chromeApi.runtime && chromeApi.runtime.lastError
      ? chromeApi.runtime.lastError
      : null;
  }

  async function focusWindowAndActivateTab(chromeApi, request) {
    const api = chromeApi || {};
    const tabId = request && typeof request.tabId === 'number' ? request.tabId : null;
    const windowId = request && typeof request.windowId === 'number' ? request.windowId : null;
    if (typeof tabId !== 'number' || !api.tabs || typeof api.tabs.update !== 'function') {
      return { ok: false, reason: 'invalid-tab' };
    }

    if (typeof windowId === 'number' && api.windows && typeof api.windows.update === 'function') {
      await callChromeCallback((done) => {
        api.windows.update(windowId, { focused: true }, done);
      });
    }

    const tab = await callChromeCallback((done) => {
      api.tabs.update(tabId, { active: true }, done);
    });
    const error = getRuntimeError(api);
    if (error) {
      return {
        ok: false,
        tabId,
        windowId,
        reason: error.message || 'tab-update-failed'
      };
    }

    return {
      ok: Boolean(tab),
      tabId,
      windowId: typeof windowId === 'number'
        ? windowId
        : (tab && typeof tab.windowId === 'number' ? tab.windowId : null)
    };
  }

  return Object.freeze({
    DEFAULT_LIMIT,
    createRecentTabTracker,
    defaultShouldIncludeTab,
    getShortcutCommitModifierEventKey,
    getShortcutTriggerEventKey,
    getShortcutReleaseEventKeys,
    focusWindowAndActivateTab
  });
});
