(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoNewtabDirectNavigationSettle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function createDirectNavigationSettleController(options) {
    const config = options && typeof options === 'object' ? options : {};
    const scheduleTimer = typeof config.setTimeout === 'function'
      ? config.setTimeout
      : setTimeout;
    const cancelTimer = typeof config.clearTimeout === 'function'
      ? config.clearTimeout
      : clearTimeout;
    const delayMs = Number.isFinite(Number(config.delayMs))
      ? Math.max(0, Number(config.delayMs))
      : 120;
    let timer = null;

    function cancel() {
      if (timer === null) {
        return false;
      }
      cancelTimer(timer);
      timer = null;
      return true;
    }

    function schedule(context) {
      cancel();
      timer = scheduleTimer(() => {
        timer = null;
        if (typeof config.onSettle === 'function') {
          config.onSettle(context);
        }
      }, delayMs);
    }

    return Object.freeze({
      cancel,
      schedule,
      isPending: () => timer !== null
    });
  }

  return Object.freeze({
    createDirectNavigationSettleController
  });
});
