(function(root) {
  'use strict';

  function normalizeActions(actions) {
    if (!Array.isArray(actions)) {
      return [];
    }
    return actions
      .map((action) => String(action || '').trim())
      .filter(Boolean);
  }

  function normalizeRouteGroup(name, descriptor) {
    const groupName = String(name || '').trim();
    const routeDescriptor = descriptor && typeof descriptor === 'object' ? descriptor : {};
    const actions = Array.isArray(descriptor) ? descriptor : routeDescriptor.actions;
    const handler = routeDescriptor.handler || routeDescriptor.handle;
    return Object.freeze({
      name: groupName,
      actions: Object.freeze(normalizeActions(actions)),
      handler: typeof handler === 'function' ? handler : null
    });
  }

  function createRouter(routeGroups) {
    const groups = {};
    const routes = {};
    Object.entries(routeGroups || {}).forEach(([name, descriptor]) => {
      const group = normalizeRouteGroup(name, descriptor);
      if (!group.name || group.actions.length <= 0 || !group.handler) {
        return;
      }
      groups[group.name] = group;
      group.actions.forEach((action) => {
        if (routes[action]) {
          throw new Error(`Duplicate background message action: ${action}`);
        }
        routes[action] = group;
      });
    });
    return Object.freeze({
      groups: Object.freeze(groups),
      routes: Object.freeze(routes)
    });
  }

  function sendUnknownResponse(sendResponse) {
    if (typeof sendResponse === 'function') {
      sendResponse({ ok: false });
    }
    return undefined;
  }

  function dispatch(router, request, sender, sendResponse) {
    const action = request && request.action ? String(request.action) : '';
    const route = action && router && router.routes ? router.routes[action] : null;
    const handler = route && typeof route.handler === 'function' ? route.handler : null;
    if (!handler) {
      return sendUnknownResponse(sendResponse);
    }
    return handler(request, sender, sendResponse);
  }

  const api = Object.freeze({
    createRouter,
    dispatch
  });

  root.LumnoBackgroundMessageRouter = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
