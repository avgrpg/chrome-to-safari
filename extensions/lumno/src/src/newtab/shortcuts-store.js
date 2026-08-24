(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoNewtabShortcutsStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_SHORTCUTS_KEY = '_x_extension_newtab_shortcuts_2026_unique_';
  const DEFAULT_MAX_SHORTCUTS = 60;
  const DEFAULT_SHORTCUTS_CHUNK_SIZE = 20;
  const DEFAULT_SHORTCUTS_SYNC_ITEM_BUDGET_BYTES = 7680;
  const DEFAULT_SHORTCUTS_SYNC_TOTAL_BUDGET_BYTES =
    DEFAULT_SHORTCUTS_SYNC_ITEM_BUDGET_BYTES * 3;
  const DEFAULT_SHORTCUTS_CHUNK_KEYS = Object.freeze([
    DEFAULT_SHORTCUTS_KEY,
    '_x_extension_newtab_shortcuts_chunk_2_2026_unique_',
    '_x_extension_newtab_shortcuts_chunk_3_2026_unique_'
  ]);
  const DEFAULT_SHORTCUTS = Object.freeze([
    Object.freeze({
      id: 'shortcut-lumno-default',
      title: 'Lumno',
      url: 'https://lumno.kubai.design/'
    })
  ]);

  function defaultNormalizeHost(hostname) {
    return String(hostname || '').trim().toLowerCase().replace(/^www\./i, '');
  }

  function getNormalizeHost(options) {
    return options && typeof options.normalizeHost === 'function'
      ? options.normalizeHost
      : defaultNormalizeHost;
  }

  function sanitizeDisplayText(text, options) {
    const value = options && typeof options.sanitizeDisplayText === 'function'
      ? options.sanitizeDisplayText(text)
      : text;
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getMaxShortcuts(options) {
    const raw = Number(options && options.maxShortcuts);
    return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_MAX_SHORTCUTS;
  }

  function getShortcutStorageChunkSize(options) {
    const raw = Number(options && options.chunkSize);
    return Number.isFinite(raw) && raw > 0
      ? Math.max(1, Math.floor(raw))
      : DEFAULT_SHORTCUTS_CHUNK_SIZE;
  }

  function getShortcutStorageKeys(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const key = opts.key || DEFAULT_SHORTCUTS_KEY;
    const chunkSize = getShortcutStorageChunkSize(opts);
    const chunkCount = Math.max(1, Math.ceil(getMaxShortcuts(opts) / chunkSize));
    const configuredKeys = Array.isArray(opts.chunkKeys)
      ? opts.chunkKeys
      : (key === DEFAULT_SHORTCUTS_KEY ? DEFAULT_SHORTCUTS_CHUNK_KEYS : []);
    const keys = [key];
    configuredKeys.forEach((configuredKey) => {
      const normalizedKey = String(configuredKey || '').trim();
      if (normalizedKey && !keys.includes(normalizedKey)) {
        keys.push(normalizedKey);
      }
    });
    while (keys.length < chunkCount) {
      keys.push(`${key}_chunk_${keys.length + 1}`);
    }
    return keys.slice(0, chunkCount);
  }

  function getUtf8ByteLength(value) {
    let byteLength = 0;
    for (const character of String(value || '')) {
      const codePoint = character.codePointAt(0) || 0;
      if (codePoint <= 0x7f) {
        byteLength += 1;
      } else if (codePoint <= 0x7ff) {
        byteLength += 2;
      } else if (codePoint <= 0xffff) {
        byteLength += 3;
      } else {
        byteLength += 4;
      }
    }
    return byteLength;
  }

  function getShortcutStorageItemByteSize(key, value) {
    return getUtf8ByteLength(key) + getUtf8ByteLength(JSON.stringify(value));
  }

  function getShortcutStoragePayloadByteSize(payload) {
    return Object.entries(payload && typeof payload === 'object' ? payload : {})
      .reduce((total, [key, value]) => (
        total + getShortcutStorageItemByteSize(key, value)
      ), 0);
  }

  function getShortcutStorageItemBudget(options) {
    const raw = Number(options && options.maxItemBytes);
    return Number.isFinite(raw) && raw > 0
      ? Math.max(1, Math.floor(raw))
      : DEFAULT_SHORTCUTS_SYNC_ITEM_BUDGET_BYTES;
  }

  function getShortcutStorageTotalBudget(options) {
    const raw = Number(options && options.maxTotalBytes);
    return Number.isFinite(raw) && raw >= 0
      ? Math.max(0, Math.floor(raw))
      : DEFAULT_SHORTCUTS_SYNC_TOTAL_BUDGET_BYTES;
  }

  function stableHashCode(text) {
    const value = String(text || '');
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function normalizeShortcutUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      return '';
    }
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return '';
      }
      if (!parsed.hostname) {
        return '';
      }
      return parsed.toString();
    } catch (error) {
      return '';
    }
  }

  function createShortcutId(url, options) {
    const now = Number.isFinite(Number(options && options.now))
      ? Math.max(0, Math.floor(Number(options.now)))
      : Date.now();
    return `shortcut-${now}-${stableHashCode(url)}`;
  }

  function normalizeShortcutItem(item, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const source = item && typeof item === 'object' ? item : {};
    const url = normalizeShortcutUrl(source.url);
    if (!url) {
      return null;
    }
    const normalizeHost = getNormalizeHost(opts);
    let host = '';
    try {
      host = normalizeHost(new URL(url).hostname);
    } catch (error) {
      host = '';
    }
    const rawTitle = sanitizeDisplayText(source.title || source.name || '', opts);
    const title = rawTitle || host || url;
    const now = Number.isFinite(Number(opts.now))
      ? Math.max(0, Math.floor(Number(opts.now)))
      : Date.now();
    const createdAt = Math.max(0, Number(source.createdAt) || now);
    const updatedAt = Math.max(createdAt, Math.max(0, Number(source.updatedAt) || now));
    const id = sanitizeDisplayText(source.id || '', opts) || createShortcutId(url, opts);
    return {
      id,
      title,
      url,
      host,
      createdAt,
      updatedAt
    };
  }

  function createShortcutRecord(input, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const now = Number.isFinite(Number(opts.now))
      ? Math.max(0, Math.floor(Number(opts.now)))
      : Date.now();
    return normalizeShortcutItem({
      ...(input || {}),
      createdAt: now,
      updatedAt: now
    }, {
      ...opts,
      now
    });
  }

  function normalizeShortcuts(items, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const maxShortcuts = getMaxShortcuts(opts);
    if (!Array.isArray(items) || maxShortcuts <= 0) {
      return [];
    }
    const normalized = [];
    const seenUrls = new Set();
    for (let i = 0; i < items.length; i += 1) {
      const item = normalizeShortcutItem(items[i], opts);
      if (!item || seenUrls.has(item.url)) {
        continue;
      }
      seenUrls.add(item.url);
      normalized.push(item);
      if (normalized.length >= maxShortcuts) {
        break;
      }
    }
    return normalized;
  }

  function getDefaultShortcuts(options) {
    const opts = options && typeof options === 'object' ? options : {};
    return normalizeShortcuts(DEFAULT_SHORTCUTS, opts);
  }

  function storageGet(storage, keys) {
    return new Promise((resolve) => {
      if (!storage || typeof storage.get !== 'function') {
        resolve({});
        return;
      }
      const requestedKeys = Array.isArray(keys) ? keys : [keys];
      storage.get(requestedKeys, (result) => {
        resolve(result || {});
      });
    });
  }

  function getStorageLastError(options) {
    if (options && typeof options.getLastError === 'function') {
      return options.getLastError() || null;
    }
    const chromeApi = typeof globalThis !== 'undefined' ? globalThis.chrome : null;
    return chromeApi && chromeApi.runtime && chromeApi.runtime.lastError
      ? chromeApi.runtime.lastError
      : null;
  }

  function createStorageError(error, fallbackMessage) {
    const message = error && error.message
      ? String(error.message)
      : String(fallbackMessage || 'Shortcut storage write failed');
    const storageError = new Error(message);
    storageError.code = 'SHORTCUT_STORAGE_WRITE_FAILED';
    return storageError;
  }

  function storageSet(storage, value, options) {
    return new Promise((resolve, reject) => {
      if (!storage || typeof storage.set !== 'function') {
        resolve();
        return;
      }
      let settled = false;
      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (error) {
          reject(createStorageError(error));
          return;
        }
        resolve();
      };
      try {
        const maybePromise = storage.set(value, () => {
          finish(getStorageLastError(options));
        });
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(() => finish(null)).catch(finish);
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  function loadShortcuts(storage, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const keys = getShortcutStorageKeys(opts);
    return storageGet(storage, keys).then((result) => {
      const hasStoredValue = keys.some((key) => Boolean(
        result &&
        Object.prototype.hasOwnProperty.call(result, key) &&
        typeof result[key] !== 'undefined'
      ));
      if (!hasStoredValue) {
        return getDefaultShortcuts(opts);
      }
      const items = [];
      keys.forEach((key) => {
        if (Array.isArray(result[key])) {
          items.push(...result[key]);
        }
      });
      return normalizeShortcuts(items, opts);
    });
  }

  function createShortcutStoragePlan(items, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const normalized = normalizeShortcuts(items, opts);
    const keys = getShortcutStorageKeys(opts);
    const chunkSize = getShortcutStorageChunkSize(opts);
    const maxItemBytes = getShortcutStorageItemBudget(opts);
    const requestedMaxTotalBytes = getShortcutStorageTotalBudget(opts);
    const payload = keys.reduce((result, key) => {
      result[key] = [];
      return result;
    }, {});
    const emptyPayloadBytes = getShortcutStoragePayloadByteSize(payload);
    const maxTotalBytes = Math.max(emptyPayloadBytes, requestedMaxTotalBytes);
    let keyIndex = 0;
    let overflowStartIndex = normalized.length;

    for (let itemIndex = 0; itemIndex < normalized.length; itemIndex += 1) {
      const item = normalized[itemIndex];
      let stored = false;
      while (keyIndex < keys.length) {
        const key = keys[keyIndex];
        const chunk = payload[key];
        if (chunk.length >= chunkSize) {
          keyIndex += 1;
          continue;
        }
        const nextChunk = chunk.concat(item);
        const nextItemBytes = getShortcutStorageItemByteSize(key, nextChunk);
        const nextTotalBytes = getShortcutStoragePayloadByteSize(payload) -
          getShortcutStorageItemByteSize(key, chunk) +
          nextItemBytes;
        if (nextItemBytes <= maxItemBytes && nextTotalBytes <= maxTotalBytes) {
          payload[key] = nextChunk;
          stored = true;
          break;
        }
        keyIndex += 1;
      }
      if (!stored) {
        overflowStartIndex = itemIndex;
        break;
      }
    }

    const syncedItems = keys.reduce((result, key) => {
      result.push(...payload[key]);
      return result;
    }, []);
    return {
      payload,
      syncedItems,
      overflowItems: normalized.slice(overflowStartIndex),
      totalBytes: getShortcutStoragePayloadByteSize(payload),
      maxItemBytes,
      maxTotalBytes
    };
  }

  function createShortcutStoragePayload(items, options) {
    return createShortcutStoragePlan(items, options).payload;
  }

  function createShortcutQuotaError(plan) {
    const error = new Error('Shortcut sync quota exceeded');
    error.code = 'SHORTCUT_SYNC_QUOTA_EXCEEDED';
    error.plan = plan;
    return error;
  }

  function mergeShortcutLists(primaryItems, overflowItems, options) {
    return normalizeShortcuts([
      ...(Array.isArray(primaryItems) ? primaryItems : []),
      ...(Array.isArray(overflowItems) ? overflowItems : [])
    ], options);
  }

  function saveShortcutStoragePlan(storage, plan, options) {
    const storagePlan = plan && typeof plan === 'object' ? plan : null;
    if (!storagePlan || !storagePlan.payload) {
      return Promise.reject(createStorageError(null, 'Invalid shortcut storage plan'));
    }
    return storageSet(storage, storagePlan.payload, options).then(() => storagePlan);
  }

  function saveShortcuts(storage, items, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const normalized = normalizeShortcuts(items, opts);
    const plan = createShortcutStoragePlan(normalized, opts);
    if (plan.overflowItems.length > 0 && opts.allowOverflow !== true) {
      return Promise.reject(createShortcutQuotaError(plan));
    }
    return saveShortcutStoragePlan(storage, plan, opts).then(() => normalized);
  }

  function saveShortcut(storage, input, options) {
    const opts = options && typeof options === 'object' ? options : {};
    return loadShortcuts(storage, opts).then((items) => {
      const nextShortcut = createShortcutRecord(input, opts);
      if (!nextShortcut) {
        return items;
      }
      const withoutDuplicate = items.filter((item) => item && item.url !== nextShortcut.url);
      const maxShortcuts = getMaxShortcuts(opts);
      const nextItems = withoutDuplicate.concat(nextShortcut);
      const savedItems = maxShortcuts > 0 && nextItems.length <= maxShortcuts
        ? nextItems
        : items;
      return saveShortcuts(storage, savedItems, opts);
    });
  }

  return {
    DEFAULT_SHORTCUTS_KEY,
    DEFAULT_MAX_SHORTCUTS,
    DEFAULT_SHORTCUTS_CHUNK_SIZE,
    DEFAULT_SHORTCUTS_CHUNK_KEYS,
    DEFAULT_SHORTCUTS_SYNC_ITEM_BUDGET_BYTES,
    DEFAULT_SHORTCUTS_SYNC_TOTAL_BUDGET_BYTES,
    DEFAULT_SHORTCUTS,
    getShortcutStorageChunkSize,
    getShortcutStorageKeys,
    getUtf8ByteLength,
    getShortcutStorageItemByteSize,
    getShortcutStoragePayloadByteSize,
    normalizeShortcutUrl,
    normalizeShortcutItem,
    createShortcutRecord,
    normalizeShortcuts,
    mergeShortcutLists,
    getDefaultShortcuts,
    loadShortcuts,
    createShortcutStoragePlan,
    createShortcutStoragePayload,
    saveShortcutStoragePlan,
    saveShortcuts,
    saveShortcut
  };
});
