/*
 * LumnoHistory — Safari-compatible replacement for chrome.history.
 *
 * Safari Web Extensions have NO chrome.history API, so this module maintains
 * a self-tracked visit log in IndexedDB. It mirrors the subset of the
 * chrome.history surface the extension actually uses:
 *   - search({ text, maxResults, startTime, endTime })
 *   - deleteUrl({ url })
 *   - recordVisit({ url, title, faviconUrl })   (extension-internal writer)
 *
 * Loaded as a global `LumnoHistory` in both the background service worker
 * (via importScripts) and the new-tab page (via <script>), since IndexedDB is
 * available in both contexts.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DB_NAME = 'lumno-history';
  const STORE = 'visits';
  const RETENTION_MS = 365 * 24 * 60 * 60 * 1000; // 365 days
  const MAX_RECORDS = 5000;

  let dbPromise = null;
  const changeListeners = [];

  function getDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        reject(new Error('indexeddb-unavailable'));
        return;
      }
      let open;
      try {
        open = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'url' });
          store.createIndex('lastVisitTime', 'lastVisitTime', { unique: false });
          store.createIndex('domain', 'domain', { unique: false });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error || new Error('open-failed'));
    });
    return dbPromise;
  }

  function normalizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl);
      u.hash = '';
      u.search = u.search; // keep query string for uniqueness
      return u.toString();
    } catch (e) {
      return rawUrl;
    }
  }

  function domainOf(rawUrl) {
    try {
      return new URL(rawUrl).hostname.toLowerCase();
    } catch (e) {
      return '';
    }
  }

  function emitChange() {
    for (let i = 0; i < changeListeners.length; i++) {
      try {
        changeListeners[i]();
      } catch (e) {
        /* ignore listener errors */
      }
    }
  }

  // Best-effort trim: drop records older than RETENTION_MS, then cap to MAX_RECORDS
  // by deleting the oldest (ascending cursor on lastVisitTime).
  function trim(db) {
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const now = Date.now();
      // 1) expire by age
      const ageIdx = store.index('lastVisitTime');
      const ageCursor = ageIdx.openCursor();
      ageCursor.onsuccess = () => {
        const cursor = ageCursor.result;
        if (!cursor) return;
        if (now - (Number(cursor.value && cursor.value.lastVisitTime) || 0) > RETENTION_MS) {
          cursor.delete();
          cursor.continue();
        }
      };
      // 2) cap by count (deferred so the age pass can finish first)
      const countReq = store.count();
      countReq.onsuccess = () => {
        const overflow = (countReq.result || 0) - MAX_RECORDS;
        if (overflow <= 0) return;
        const idx = store.index('lastVisitTime');
        const cur = idx.openCursor();
        let deleted = 0;
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || deleted >= overflow) return;
          c.delete();
          deleted++;
          c.continue();
        };
      };
    } catch (e) {
      /* trim is best-effort */
    }
  }

  function recordVisit(payload) {
    const url = payload && payload.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return Promise.resolve(false);
    }
    const norm = normalizeUrl(url);
    return getDb().then((db) => new Promise((resolve, reject) => {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const getReq = store.get(norm);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        const now = Date.now();
        const record = existing || {
          url: norm,
          title: '',
          domain: domainOf(norm),
          visitCount: 0,
          lastVisitTime: now,
          faviconUrl: '',
          searchText: ''
        };
        record.title = (payload.title || record.title || '').toString().slice(0, 500);
        record.domain = domainOf(norm) || record.domain;
        record.visitCount = (Number(record.visitCount) || 0) + 1;
        record.lastVisitTime = now;
        if (payload.faviconUrl) {
          record.faviconUrl = String(payload.faviconUrl).slice(0, 2000);
        }
        record.searchText = (norm + ' ' + record.title).toLowerCase();
        const putReq = store.put(record);
        putReq.onsuccess = () => {
          trim(db);
          emitChange();
          resolve(true);
        };
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    })).catch(() => false);
  }

  function search(options) {
    const opts = options || {};
    const text = (opts.text || '').toString().toLowerCase().trim();
    const maxResults = Number(opts.maxResults) > 0 ? Math.floor(opts.maxResults) : 100;
    const startTime = Number(opts.startTime) || 0;
    const endTime = Number(opts.endTime) || Date.now() + 1000;
    return getDb().then((db) => new Promise((resolve, reject) => {
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        let items = Array.isArray(req.result) ? req.result : [];
        items = items.filter((it) => {
          if (!it) return false;
          const t = Number(it.lastVisitTime) || 0;
          if (t < startTime || t > endTime) return false;
          if (text && (!it.searchText || it.searchText.indexOf(text) === -1)) return false;
          return true;
        });
        items.sort((a, b) => (Number(b.lastVisitTime) || 0) - (Number(a.lastVisitTime) || 0));
        items = items.slice(0, maxResults);
        resolve(items.map((it) => ({
          id: it.url,
          url: it.url,
          title: it.title || '',
          lastVisitTime: it.lastVisitTime,
          visitCount: it.visitCount,
          typedCount: 0,
          faviconUrl: it.faviconUrl || ''
        })));
      };
      req.onerror = () => reject(req.error);
    }));
  }

  function deleteUrl(options) {
    const url = options && options.url;
    if (!url) return Promise.resolve(false);
    const norm = normalizeUrl(url);
    return getDb().then((db) => new Promise((resolve, reject) => {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
      const req = store.delete(norm);
      req.onsuccess = () => {
        emitChange();
        resolve(true);
      };
      req.onerror = () => reject(req.error);
    })).catch(() => false);
  }

  function setOnChange(cb) {
    if (typeof cb === 'function') changeListeners.push(cb);
  }

  return {
    search: search,
    deleteUrl: deleteUrl,
    recordVisit: recordVisit,
    setOnChange: setOnChange,
    _normalizeUrl: normalizeUrl
  };
});
