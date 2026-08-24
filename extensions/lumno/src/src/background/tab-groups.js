(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoBackgroundTabGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function getChromeApi(chromeApi) {
    return chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
  }

  function getUngroupedTabId(chromeApi) {
    const api = getChromeApi(chromeApi);
    return api &&
      api.tabGroups &&
      typeof api.tabGroups.TAB_GROUP_ID_NONE === 'number'
      ? api.tabGroups.TAB_GROUP_ID_NONE
      : -1;
  }

  function getSourceTabGroupContext(sourceTab, chromeApi) {
    const api = getChromeApi(chromeApi);
    if (!sourceTab || typeof sourceTab.groupId !== 'number') {
      return null;
    }
    const groupId = sourceTab.groupId;
    if (groupId === getUngroupedTabId(api)) {
      return null;
    }
    return {
      groupId,
      windowId: typeof sourceTab.windowId === 'number' ? sourceTab.windowId : null
    };
  }

  function normalizeSourceTabGroupContext(source, chromeApi) {
    if (!source || typeof source !== 'object') {
      return null;
    }
    if (typeof source.groupId === 'number' && !Object.prototype.hasOwnProperty.call(source, 'id')) {
      const groupId = source.groupId;
      if (groupId === getUngroupedTabId(chromeApi)) {
        return null;
      }
      return {
        groupId,
        windowId: typeof source.windowId === 'number' ? source.windowId : null
      };
    }
    return getSourceTabGroupContext(source, chromeApi);
  }

  function shouldGroupCreatedTab(tab, context, createProperties) {
    if (!context || typeof context.groupId !== 'number') {
      return false;
    }
    if (!tab || typeof tab.id !== 'number') {
      return false;
    }
    if ((createProperties && createProperties.pinned === true) || tab.pinned === true) {
      return false;
    }
    if (typeof tab.groupId === 'number' && tab.groupId === context.groupId) {
      return false;
    }
    if (typeof context.windowId === 'number' &&
        typeof tab.windowId === 'number' &&
        tab.windowId !== context.windowId) {
      return false;
    }
    return true;
  }

  function buildCreatePropertiesForSourceGroup(createProperties, sourceTab, chromeApi) {
    const props = {
      ...(createProperties && typeof createProperties === 'object' ? createProperties : {})
    };
    const context = getSourceTabGroupContext(sourceTab, chromeApi);
    if (context &&
        typeof context.windowId === 'number' &&
        typeof props.windowId !== 'number') {
      props.windowId = context.windowId;
    }
    return props;
  }

  function moveTabToSourceGroupContext(chromeApi, tab, sourceContext, callback, createProperties) {
    const api = getChromeApi(chromeApi);
    const context = normalizeSourceTabGroupContext(sourceContext, api);
    const done = typeof callback === 'function' ? callback : () => {};
    if (!api ||
        !api.tabs ||
        typeof api.tabs.group !== 'function' ||
        !shouldGroupCreatedTab(tab, context, createProperties)) {
      done(false, '');
      return;
    }
    try {
      api.tabs.group({
        tabIds: tab.id,
        groupId: context.groupId
      }, () => {
        const error = api.runtime && api.runtime.lastError
          ? api.runtime.lastError.message || 'tab-group-failed'
          : '';
        done(!error, error);
      });
    } catch (error) {
      done(false, error && error.message ? error.message : 'tab-group-threw');
    }
  }

  function moveTabToSourceGroup(chromeApi, tab, sourceTab, callback, createProperties) {
    const context = getSourceTabGroupContext(sourceTab, chromeApi);
    moveTabToSourceGroupContext(chromeApi, tab, context, callback, createProperties);
  }

  function createTabInSourceGroup(chromeApi, createProperties, sourceTab, callback) {
    const api = getChromeApi(chromeApi);
    const done = typeof callback === 'function' ? callback : () => {};
    if (!api || !api.tabs || typeof api.tabs.create !== 'function') {
      done(null, { ok: false, reason: 'tabs-api-unavailable', grouped: false });
      return;
    }
    const props = buildCreatePropertiesForSourceGroup(createProperties, sourceTab, api);
    const sourceContext = getSourceTabGroupContext(sourceTab, api);
    try {
      api.tabs.create(props, (tab) => {
        const createError = api.runtime && api.runtime.lastError
          ? api.runtime.lastError.message || 'tab-create-failed'
          : '';
        if (createError) {
          done(tab || null, { ok: false, reason: createError, grouped: false });
          return;
        }
        moveTabToSourceGroupContext(api, tab, sourceContext, (grouped, groupReason) => {
          done(tab || null, {
            ok: true,
            reason: '',
            grouped: Boolean(grouped),
            groupReason: groupReason || ''
          });
        }, props);
      });
    } catch (error) {
      done(null, {
        ok: false,
        reason: error && error.message ? error.message : 'tab-create-threw',
        grouped: false
      });
    }
  }

  return Object.freeze({
    buildCreatePropertiesForSourceGroup,
    createTabInSourceGroup,
    getSourceTabGroupContext,
    getUngroupedTabId,
    moveTabToSourceGroup,
    moveTabToSourceGroupContext,
    shouldGroupCreatedTab
  });
});
