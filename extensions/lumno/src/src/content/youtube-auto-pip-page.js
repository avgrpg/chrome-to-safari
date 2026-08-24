(function () {
  if (window.__lumnoYtAutoPipPageBridge2026) {
    return;
  }
  window.__lumnoYtAutoPipPageBridge2026 = true;

  const REQUEST_EVENT = "__lumno_yt_force_exit_pip_req_2026__";
  const RESPONSE_EVENT = "__lumno_yt_force_exit_pip_res_2026__";

  function getPlayer() {
    const moviePlayer = document.getElementById("movie_player");
    if (moviePlayer && typeof moviePlayer === "object") {
      return moviePlayer;
    }
    const ytdPlayer = document.querySelector("ytd-player");
    if (ytdPlayer && typeof ytdPlayer.getPlayer === "function") {
      try {
        return ytdPlayer.getPlayer();
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  function callPlayerMethod(player, name, args) {
    if (!player || typeof player[name] !== "function") {
      return false;
    }
    try {
      player[name].apply(player, Array.isArray(args) ? args : []);
      return true;
    } catch (error) {
      return false;
    }
  }

  function forceUnminimize() {
    const player = getPlayer();
    if (!player) {
      return false;
    }
    let changed = false;
    changed = callPlayerMethod(player, "setMinimized", [false]) || changed;
    changed = callPlayerMethod(player, "setMinimized", [0]) || changed;
    changed = callPlayerMethod(player, "setMinimized", [null]) || changed;
    changed = callPlayerMethod(player, "setMinimized", []) || changed;
    return changed;
  }

  async function handleForceExitRequest(detail) {
    const requestId = detail && typeof detail.requestId === "number" ? detail.requestId : 0;
    const before = Boolean(document.pictureInPictureElement);
    let attempted = false;
    let error = "";

    try {
      if (before && typeof document.exitPictureInPicture === "function") {
        attempted = true;
        await document.exitPictureInPicture();
      }
    } catch (e) {
      error = e && e.name ? String(e.name) : String(e);
    }

    forceUnminimize();
    const after = Boolean(document.pictureInPictureElement);

    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: {
        requestId: requestId,
        attempted: attempted,
        before: before,
        after: after,
        error: error
      }
    }));
  }

  window.addEventListener(REQUEST_EVENT, (event) => {
    const detail = event && event.detail ? event.detail : {};
    handleForceExitRequest(detail);
  }, false);
})();
