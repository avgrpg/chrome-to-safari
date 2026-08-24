(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoBookmarkTabGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function collectBookmarkUrls(node, collected) {
    const urls = Array.isArray(collected) ? collected : [];
    if (!node) {
      return urls;
    }
    const url = node.url ? String(node.url).trim() : '';
    if (url && !/^javascript:/i.test(url)) {
      urls.push(url);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => collectBookmarkUrls(child, urls));
    return urls;
  }

  function getLastErrorMessage(chromeApi, fallback) {
    const runtime = chromeApi && chromeApi.runtime;
    return runtime && runtime.lastError
      ? String(runtime.lastError.message || fallback)
      : '';
  }

  function getBookmarkSubTree(chromeApi, folderId) {
    return new Promise((resolve, reject) => {
      try {
        chromeApi.bookmarks.getSubTree(folderId, (nodes) => {
          const error = getLastErrorMessage(
            chromeApi,
            'bookmark-folder-unavailable'
          );
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve(Array.isArray(nodes) && nodes.length > 0 ? nodes[0] : null);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function createBackgroundTab(chromeApi, createProperties) {
    return new Promise((resolve) => {
      try {
        chromeApi.tabs.create(createProperties, (tab) => {
          const error = getLastErrorMessage(chromeApi, 'tab-create-failed');
          if (error || !tab || typeof tab.id !== 'number') {
            resolve(null);
            return;
          }
          resolve(tab);
        });
      } catch (_error) {
        resolve(null);
      }
    });
  }

  function createTabGroup(chromeApi, tabIds) {
    return new Promise((resolve, reject) => {
      try {
        chromeApi.tabs.group({ tabIds }, (groupId) => {
          const error = getLastErrorMessage(chromeApi, 'tab-group-failed');
          if (error || typeof groupId !== 'number') {
            reject(new Error(error || 'tab-group-failed'));
            return;
          }
          resolve(groupId);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function updateTabGroupTitle(chromeApi, groupId, title) {
    return new Promise((resolve, reject) => {
      try {
        chromeApi.tabGroups.update(groupId, { title }, () => {
          const error = getLastErrorMessage(
            chromeApi,
            'tab-group-title-failed'
          );
          if (error) {
            reject(new Error(error));
            return;
          }
          resolve(true);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function createResult(overrides) {
    return Object.assign({
      ok: false,
      requestedCount: 0,
      openedCount: 0,
      failedCount: 0,
      groupId: null,
      reason: ''
    }, overrides || {});
  }

  async function openBookmarkFolderInNewTabGroup(chromeApi, rawOptions) {
    const options = rawOptions && typeof rawOptions === 'object'
      ? rawOptions
      : {};
    const folderId = String(options.folderId || '').trim();
    if (!folderId) {
      return createResult({ reason: 'invalid-folder-id' });
    }
    if (!chromeApi || !chromeApi.bookmarks ||
        typeof chromeApi.bookmarks.getSubTree !== 'function') {
      return createResult({ reason: 'bookmarks-api-unavailable' });
    }
    if (!chromeApi.tabs || typeof chromeApi.tabs.create !== 'function' ||
        typeof chromeApi.tabs.group !== 'function' ||
        !chromeApi.tabGroups || typeof chromeApi.tabGroups.update !== 'function') {
      return createResult({ reason: 'tab-group-api-unavailable' });
    }

    let folderNode = null;
    try {
      folderNode = await getBookmarkSubTree(chromeApi, folderId);
    } catch (error) {
      return createResult({
        reason: error && error.message
          ? error.message
          : 'bookmark-folder-unavailable'
      });
    }
    if (!folderNode) {
      return createResult({ reason: 'bookmark-folder-unavailable' });
    }

    const urls = collectBookmarkUrls(folderNode);
    const requestedCount = urls.length;
    if (!requestedCount) {
      return createResult({ reason: 'empty-folder' });
    }

    const windowId = Number(options.windowId);
    const insertIndex = Number(options.insertIndex);
    const openedTabs = [];
    for (let index = 0; index < urls.length; index += 1) {
      const createProperties = {
        url: urls[index],
        active: false
      };
      if (Number.isFinite(windowId)) {
        createProperties.windowId = windowId;
      }
      if (Number.isFinite(insertIndex)) {
        createProperties.index = Math.max(0, insertIndex + index);
      }
      const tab = await createBackgroundTab(chromeApi, createProperties);
      if (tab) {
        openedTabs.push(tab);
      }
    }

    const openedCount = openedTabs.length;
    const failedCount = requestedCount - openedCount;
    if (!openedCount) {
      return createResult({
        requestedCount,
        failedCount,
        reason: 'tab-create-failed'
      });
    }

    let groupId = null;
    try {
      groupId = await createTabGroup(
        chromeApi,
        openedTabs.map((tab) => tab.id)
      );
      const folderTitle = String(options.title || folderNode.title || '').trim();
      await updateTabGroupTitle(chromeApi, groupId, folderTitle);
    } catch (error) {
      return createResult({
        requestedCount,
        openedCount,
        failedCount,
        groupId,
        reason: error && error.message ? error.message : 'tab-group-failed'
      });
    }

    return createResult({
      ok: failedCount === 0,
      requestedCount,
      openedCount,
      failedCount,
      groupId,
      reason: failedCount > 0 ? 'partial-tab-create-failure' : ''
    });
  }

  return Object.freeze({
    collectBookmarkUrls,
    openBookmarkFolderInNewTabGroup
  });
});
