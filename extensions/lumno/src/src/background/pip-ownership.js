(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoPipOwnership = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const GLOBAL_PIP_OWNER_STORAGE_KEY = '_x_lumno_global_pip_owner_2026_';

  function create(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const chromeApi = settings.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    const getResolvedTabUrl = typeof settings.getResolvedTabUrl === 'function'
      ? settings.getResolvedTabUrl
      : (tab) => (tab && typeof tab.url === 'string' ? tab.url : '');
    let globalPipOwnerCache = null;
    let globalPipOwnerCacheLoaded = false;

    function getSessionStorageArea() {
      if (!chromeApi || !chromeApi.storage) {
        return null;
      }
      return chromeApi.storage.session || chromeApi.storage.local || null;
    }

    function normalizePipOwnerRecord(value) {
      if (!value || typeof value !== 'object') {
        return null;
      }
      const kind = value.kind === 'document' ? 'document' : (value.kind === 'video' ? 'video' : '');
      const tabId = Number(value.tabId);
      if (!kind || !Number.isInteger(tabId) || tabId < 0) {
        return null;
      }
      const frameId = Number.isInteger(Number(value.frameId)) ? Number(value.frameId) : 0;
      const token = typeof value.token === 'string' && value.token
        ? value.token
        : '';
      if (!token) {
        return null;
      }
      return {
        kind: kind,
        tabId: tabId,
        frameId: frameId,
        token: token,
        url: typeof value.url === 'string' ? value.url : '',
        updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now()
      };
    }

    function getGlobalPipOwnerRecord() {
      if (globalPipOwnerCacheLoaded) {
        return Promise.resolve(globalPipOwnerCache);
      }
      const storageArea = getSessionStorageArea();
      if (!storageArea || typeof storageArea.get !== 'function') {
        globalPipOwnerCacheLoaded = true;
        globalPipOwnerCache = null;
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        storageArea.get([GLOBAL_PIP_OWNER_STORAGE_KEY], (result) => {
          const normalized = normalizePipOwnerRecord(
            result ? result[GLOBAL_PIP_OWNER_STORAGE_KEY] : null
          );
          globalPipOwnerCacheLoaded = true;
          globalPipOwnerCache = normalized;
          resolve(normalized);
        });
      });
    }

    function setGlobalPipOwnerRecord(record) {
      const normalized = normalizePipOwnerRecord(record);
      globalPipOwnerCacheLoaded = true;
      globalPipOwnerCache = normalized;
      const storageArea = getSessionStorageArea();
      if (!storageArea || typeof storageArea.set !== 'function') {
        return Promise.resolve(normalized);
      }
      return new Promise((resolve) => {
        storageArea.set({ [GLOBAL_PIP_OWNER_STORAGE_KEY]: normalized }, () => {
          resolve(normalized);
        });
      });
    }

    function clearGlobalPipOwnerRecord(expectedToken) {
      const shouldClear = !expectedToken ||
        !globalPipOwnerCache ||
        globalPipOwnerCache.token === expectedToken;
      if (!shouldClear) {
        return Promise.resolve(false);
      }
      globalPipOwnerCacheLoaded = true;
      globalPipOwnerCache = null;
      const storageArea = getSessionStorageArea();
      if (!storageArea || typeof storageArea.remove !== 'function') {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        storageArea.remove(GLOBAL_PIP_OWNER_STORAGE_KEY, () => {
          resolve(true);
        });
      });
    }

    function createGlobalPipOwnerToken() {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return `pip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function getPipSenderContext(sender) {
      const senderTab = sender && sender.tab ? sender.tab : null;
      const tabId = senderTab && typeof senderTab.id === 'number' ? senderTab.id : null;
      if (typeof tabId !== 'number') {
        return null;
      }
      return {
        tabId: tabId,
        frameId: sender && typeof sender.frameId === 'number' ? sender.frameId : 0,
        url: getResolvedTabUrl(senderTab)
      };
    }

    function isSameGlobalPipOwner(owner, context, kind) {
      if (!owner || !context) {
        return false;
      }
      return owner.kind === kind &&
        owner.tabId === context.tabId &&
        owner.frameId === context.frameId;
    }

    function sendMessageToTab(tabId, message) {
      return new Promise((resolve) => {
        if (!chromeApi || !chromeApi.tabs || typeof chromeApi.tabs.sendMessage !== 'function') {
          resolve({ ok: false, reason: 'tabs-sendMessage-unavailable' });
          return;
        }
        try {
          chromeApi.tabs.sendMessage(tabId, message, (response) => {
            if (chromeApi.runtime && chromeApi.runtime.lastError) {
              resolve({
                ok: false,
                reason: chromeApi.runtime.lastError.message || 'sendMessage-failed'
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

    async function forceSurrenderGlobalPipOwner(owner, requestedKind) {
      if (!owner) {
        return { ok: true, cleared: false };
      }
      const result = await sendMessageToTab(owner.tabId, {
        action: 'lumno:pip-force-surrender',
        reason: requestedKind === 'document' ? 'document-owner-takeover' : 'video-owner-takeover',
        ownerKind: owner.kind
      });
      if (result && result.ok) {
        await clearGlobalPipOwnerRecord(owner.token);
        return { ok: true, cleared: true };
      }
      const errorReason = String(result && result.reason ? result.reason : '');
      const isStaleOwner = errorReason.includes('Receiving end does not exist') ||
        errorReason.includes('No tab with id') ||
        errorReason.includes('message port closed');
      if (isStaleOwner) {
        await clearGlobalPipOwnerRecord(owner.token);
        return { ok: true, cleared: true };
      }
      return {
        ok: false,
        reason: result && result.reason ? result.reason : 'surrender-failed'
      };
    }

    async function requestGlobalPipOwnership(sender, kind) {
      const context = getPipSenderContext(sender);
      if (!context) {
        return { ok: false, granted: false, reason: 'no-tab' };
      }
      if (kind !== 'video' && kind !== 'document') {
        return { ok: false, granted: false, reason: 'invalid-kind' };
      }

      const currentOwner = await getGlobalPipOwnerRecord();
      if (currentOwner && isSameGlobalPipOwner(currentOwner, context, kind)) {
        return {
          ok: true,
          granted: true,
          token: currentOwner.token,
          owner: currentOwner
        };
      }

      if (currentOwner) {
        if (currentOwner.kind === 'document' && kind === 'video') {
          return {
            ok: false,
            granted: false,
            reason: 'document-owner-active',
            owner: currentOwner
          };
        }
        const surrenderResult = await forceSurrenderGlobalPipOwner(currentOwner, kind);
        if (!surrenderResult.ok) {
          return {
            ok: false,
            granted: false,
            reason: surrenderResult.reason || 'owner-busy',
            owner: currentOwner
          };
        }
      }

      const nextOwner = {
        kind: kind,
        tabId: context.tabId,
        frameId: context.frameId,
        token: createGlobalPipOwnerToken(),
        url: context.url,
        updatedAt: Date.now()
      };
      await setGlobalPipOwnerRecord(nextOwner);
      return {
        ok: true,
        granted: true,
        token: nextOwner.token,
        owner: nextOwner
      };
    }

    async function releaseGlobalPipOwnership(sender, token) {
      const context = getPipSenderContext(sender);
      if (!context) {
        return { ok: false, released: false, reason: 'no-tab' };
      }
      const currentOwner = await getGlobalPipOwnerRecord();
      if (!currentOwner) {
        return { ok: true, released: true, reason: 'no-owner' };
      }
      const matchesToken = typeof token === 'string' && token && currentOwner.token === token;
      const matchesSender = currentOwner.tabId === context.tabId &&
        currentOwner.frameId === context.frameId;
      if (!matchesToken && !matchesSender) {
        return { ok: true, released: false, reason: 'owner-mismatch' };
      }
      await clearGlobalPipOwnerRecord(currentOwner.token);
      return { ok: true, released: true };
    }

    function clearGlobalPipOwnerForTabId(tabId) {
      if (typeof tabId !== 'number') {
        return;
      }
      getGlobalPipOwnerRecord().then((owner) => {
        if (!owner || owner.tabId !== tabId) {
          return;
        }
        clearGlobalPipOwnerRecord(owner.token).catch(() => {});
      }).catch(() => {});
    }

    return Object.freeze({
      clearGlobalPipOwnerForTabId,
      releaseGlobalPipOwnership,
      requestGlobalPipOwnership
    });
  }

  return Object.freeze({
    create
  });
});
