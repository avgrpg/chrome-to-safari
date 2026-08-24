(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoCommandTargetPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const ONBOARDING_SEARCH_OVERLAY_COMMAND_ACTION = 'triggerOnboardingSearchOverlayFromCommand';

  function isSearchCommandSource(source) {
    return source === 'commands' || source === 'commands-prefill';
  }

  function shouldTriggerOnboardingOverlayFromCommand(source, url, options) {
    if (!isSearchCommandSource(source) || !url) {
      return false;
    }
    const settings = options && typeof options === 'object' ? options : {};
    const isOwnExtensionUrl = typeof settings.isOwnExtensionUrl === 'function'
      ? settings.isOwnExtensionUrl(url)
      : false;
    if (!isOwnExtensionUrl) {
      return false;
    }
    const isOnboardingUrl = typeof settings.isOnboardingUrl === 'function'
      ? settings.isOnboardingUrl(url)
      : false;
    return Boolean(isOnboardingUrl);
  }

  function shouldSuppressRestrictedCommandFallback(source, url, options) {
    return shouldTriggerOnboardingOverlayFromCommand(source, url, options);
  }

  return Object.freeze({
    ONBOARDING_SEARCH_OVERLAY_COMMAND_ACTION,
    shouldTriggerOnboardingOverlayFromCommand,
    shouldSuppressRestrictedCommandFallback
  });
});
