(function () {
  if (window._x_lumno_youtube_auto_pip_2026_unique_) {
    return;
  }
  window._x_lumno_youtube_auto_pip_2026_unique_ = true;

  if (window.top !== window.self) {
    return;
  }

  const host = String(location.hostname || "").toLowerCase();
  if (!host || !/(^|\.)youtube\.com$/.test(host)) {
    return;
  }
  const AUTO_PIP_ENABLED_STORAGE_KEY = "_x_extension_auto_pip_enabled_2026_unique_";
  const providerStorageRuntime = globalThis.LumnoSettings &&
    typeof globalThis.LumnoSettings.createProviderStorageRuntime === "function"
    ? globalThis.LumnoSettings.createProviderStorageRuntime(chrome)
    : null;
  let autoPipEnabled = false;

  const state = {
    activeVideo: null,
    enteringPiP: false,
    exitingPiP: false,
    managedPiP: false,
    mediaSessionHandlerBound: false,
    lastManagedVideo: null,
    recoveryTimer: null,
    enterRetryTimer: null,
    suppressEnterUntil: 0,
    uiRecoverySuppressUntil: 0,
    shouldResumeInlinePlayback: false,
    wasPlayingBeforeHide: false,
    ownerToken: "",
    runtimeMessageHandlerBound: false
  };
  const RECOVERY_RELOAD_GUARD_KEY = "_x_lumno_yt_pip_recovery_reload_at_2026_";
  const PAGE_BRIDGE_SCRIPT_ID = "__lumno_yt_auto_pip_page_bridge_script_2026__";
  const PAGE_BRIDGE_REQUEST_EVENT = "__lumno_yt_force_exit_pip_req_2026__";
  const PAGE_BRIDGE_RESPONSE_EVENT = "__lumno_yt_force_exit_pip_res_2026__";
  const DOCUMENT_PIP_ACTIVE_FLAG = "__lumno_document_pip_active_2026__";
  const ENTER_SUPPRESS_AFTER_EXIT_MS = 1200;
  const ENTER_SUPPRESS_AFTER_VISIBLE_MS = 1400;
  let pageBridgeRequestSeq = 0;

  function normalizeAutoPipEnabled(value) {
    return value !== false;
  }

  function setAutoPipEnabled(value) {
    autoPipEnabled = normalizeAutoPipEnabled(value);
  }
  function isDocumentPiPActive() {
    return window[DOCUMENT_PIP_ACTIVE_FLAG] === true;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
        resolve({ ok: false, reason: "no-runtime-sendMessage" });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve({
              ok: false,
              reason: chrome.runtime.lastError.message || "runtime-lastError"
            });
            return;
          }
          resolve(response && typeof response === "object"
            ? response
            : { ok: false, reason: "empty-response" });
        });
      } catch (error) {
        resolve({ ok: false, reason: String(error) });
      }
    });
  }

  async function requestPiPOwnership(kind) {
    const response = await sendRuntimeMessage({
      action: "pipRequestOwnership",
      kind: kind
    });
    if (response && response.ok && response.granted && response.token) {
      state.ownerToken = String(response.token);
      return { ok: true, granted: true };
    }
    return {
      ok: false,
      granted: false,
      reason: response && response.reason ? String(response.reason) : "ownership-denied"
    };
  }

  async function releasePiPOwnership() {
    const token = typeof state.ownerToken === "string" ? state.ownerToken : "";
    state.ownerToken = "";
    if (!token) {
      return { ok: true, released: false, reason: "no-owner-token" };
    }
    return sendRuntimeMessage({
      action: "pipReleaseOwnership",
      token: token
    });
  }

  function clearPlaybackRecoveryState() {
    state.shouldResumeInlinePlayback = false;
    state.wasPlayingBeforeHide = false;
    clearEnterRetryTimer();
    clearRecoveryTimer();
  }

  function syncAutoPipEnabledSetting() {
    if (!chrome || !chrome.storage) {
      return;
    }
    const storageArea = providerStorageRuntime
      ? providerStorageRuntime.area
      : (chrome.storage.sync || chrome.storage.local);
    if (!storageArea || typeof storageArea.get !== "function") {
      return;
    }
    storageArea.get([AUTO_PIP_ENABLED_STORAGE_KEY], (result) => {
      const rawValue = result ? result[AUTO_PIP_ENABLED_STORAGE_KEY] : undefined;
      const normalized = normalizeAutoPipEnabled(rawValue);
      setAutoPipEnabled(normalized);
      if (rawValue !== normalized && typeof storageArea.set === "function") {
        storageArea.set({ [AUTO_PIP_ENABLED_STORAGE_KEY]: normalized });
      }
    });
    if (!chrome.storage.onChanged || typeof chrome.storage.onChanged.addListener !== "function") {
      return;
    }
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (providerStorageRuntime && !providerStorageRuntime.isActiveAreaName(areaName)) {
        return;
      }
      if (!changes || !changes[AUTO_PIP_ENABLED_STORAGE_KEY]) {
        return;
      }
      setAutoPipEnabled(changes[AUTO_PIP_ENABLED_STORAGE_KEY].newValue);
      if (!autoPipEnabled) {
        clearPlaybackRecoveryState();
      }
      if (!autoPipEnabled && (state.managedPiP || document.pictureInPictureElement)) {
        maybeExitPiP("settings_disabled").catch(() => {});
      }
    });
  }
  syncAutoPipEnabledSetting();

  const DEBUG = false;
  function debugLog(stage, detail) {
    if (!DEBUG) {
      return;
    }
    try {
      console.log("[Lumno][yt-auto-pip]", stage, detail || "");
    } catch (error) {
      // Ignore logging errors.
    }
  }

  function shouldAllowRecoveryReload() {
    try {
      const raw = sessionStorage.getItem(RECOVERY_RELOAD_GUARD_KEY);
      const lastAt = Number(raw || 0);
      if (!lastAt) {
        return true;
      }
      return (Date.now() - lastAt) > 15000;
    } catch (error) {
      return true;
    }
  }

  function markRecoveryReloadNow() {
    try {
      sessionStorage.setItem(RECOVERY_RELOAD_GUARD_KEY, String(Date.now()));
    } catch (error) {
      // Ignore storage write failures.
    }
  }

  function ensurePageBridgeInjected() {
    if (document.getElementById(PAGE_BRIDGE_SCRIPT_ID)) {
      return;
    }
    const script = document.createElement("script");
    script.id = PAGE_BRIDGE_SCRIPT_ID;
    script.src = chrome.runtime.getURL("src/content/youtube-auto-pip-page.js");
    script.async = false;
    const target = document.documentElement || document.head || document.body;
    if (!target) {
      return;
    }
    target.appendChild(script);
  }

  function requestPageBridgeExitPiP(timeoutMs) {
    return new Promise((resolve) => {
      if (typeof window.CustomEvent !== "function") {
        resolve({ ok: false, reason: "no-custom-event" });
        return;
      }
      ensurePageBridgeInjected();
      const requestId = ++pageBridgeRequestSeq;
      let done = false;

      const finish = (result) => {
        if (done) {
          return;
        }
        done = true;
        window.removeEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse, true);
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result || { ok: false });
      };

      const onResponse = (event) => {
        const detail = event && event.detail ? event.detail : {};
        if (Number(detail.requestId || 0) !== requestId) {
          return;
        }
        finish({
          ok: true,
          attempted: Boolean(detail.attempted),
          before: Boolean(detail.before),
          after: Boolean(detail.after),
          error: String(detail.error || "")
        });
      };

      window.addEventListener(PAGE_BRIDGE_RESPONSE_EVENT, onResponse, true);
      const timer = setTimeout(() => {
        finish({ ok: false, reason: "timeout" });
      }, Math.max(120, Number(timeoutMs || 400)));

      window.dispatchEvent(new CustomEvent(PAGE_BRIDGE_REQUEST_EVENT, {
        detail: { requestId: requestId }
      }));
    });
  }

  function requestBackgroundMainWorldExitPiP(timeoutMs) {
    return new Promise((resolve) => {
      if (!chrome || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
        resolve({ ok: false, reason: "no-runtime-sendMessage" });
        return;
      }
      let done = false;
      const finish = (result) => {
        if (done) {
          return;
        }
        done = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result || { ok: false });
      };
      const timer = setTimeout(() => {
        finish({ ok: false, reason: "timeout" });
      }, Math.max(160, Number(timeoutMs || 700)));
      try {
        chrome.runtime.sendMessage({ action: "ytForceExitPiPInMainWorld" }, (response) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            finish({
              ok: false,
              reason: chrome.runtime.lastError.message || "runtime-lastError"
            });
            return;
          }
          finish(response && typeof response === "object"
            ? response
            : { ok: false, reason: "empty-response" });
        });
      } catch (error) {
        finish({ ok: false, reason: String(error) });
      }
    });
  }

  function canEnterPiP() {
    return typeof document !== "undefined" &&
      typeof document.pictureInPictureEnabled === "boolean" &&
      document.pictureInPictureEnabled;
  }

  function canExitPiP() {
    return typeof document !== "undefined" &&
      typeof document.exitPictureInPicture === "function";
  }

  function getVideoArea(video) {
    if (!video || typeof video.getBoundingClientRect !== "function") {
      return 0;
    }
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Number(rect.width) || 0);
    const height = Math.max(0, Number(rect.height) || 0);
    return width * height;
  }

  function isVideoPlaying(video) {
    if (!video) {
      return false;
    }
    return !video.paused && !video.ended && Number(video.readyState || 0) >= 2;
  }

  function isVideoCandidate(video) {
    return Boolean(video) &&
      !video.disablePictureInPicture &&
      Number(video.videoWidth || 0) > 0 &&
      Number(video.videoHeight || 0) > 0;
  }

  function pickPrimaryVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (!videos.length) {
      return null;
    }

    let best = null;
    let bestScore = -1;
    for (const video of videos) {
      if (!isVideoCandidate(video)) {
        continue;
      }
      const playingBoost = isVideoPlaying(video) ? 1000000000 : 0;
      const areaScore = getVideoArea(video);
      const score = playingBoost + areaScore;
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }
    return best || videos[0] || null;
  }

  function syncActiveVideo(preferred) {
    if (preferred && isVideoCandidate(preferred)) {
      state.activeVideo = preferred;
      return state.activeVideo;
    }
    state.activeVideo = pickPrimaryVideo();
    return state.activeVideo;
  }

  function bindMediaSessionAutoPiP() {
    if (state.mediaSessionHandlerBound) {
      return;
    }
    if (!navigator.mediaSession || typeof navigator.mediaSession.setActionHandler !== "function") {
      return;
    }
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
        await maybeEnterPiP("media_session_action");
      });
      state.mediaSessionHandlerBound = true;
    } catch (error) {
      // Older browser versions may not support this action type.
    }
  }

  function getFirstHTMLElement(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) {
        return node;
      }
    }
    return null;
  }

  function getYouTubePiPButton() {
    return getFirstHTMLElement([
      ".ytp-pip-button",
      ".ytp-right-controls .ytp-button.ytp-pip-button"
    ]);
  }

  function getYouTubeMiniPlayerButton() {
    return getFirstHTMLElement([
      ".ytp-miniplayer-button",
      ".ytp-right-controls .ytp-button.ytp-miniplayer-button"
    ]);
  }

  function isPressedButton(button) {
    if (!button) {
      return false;
    }
    const ariaPressed = button.getAttribute("aria-pressed");
    if (ariaPressed === "true") {
      return true;
    }
    if (button.classList.contains("ytp-button-active") || button.classList.contains("ytp-active")) {
      return true;
    }
    return false;
  }

  function clickButton(button) {
    if (!button) {
      return false;
    }
    try {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (error) {
      return false;
    }
  }

  function getYouTubePiPToggleButtonIfPressed() {
    const pipButton = getYouTubePiPButton();
    if (isPressedButton(pipButton)) {
      return pipButton;
    }
    const miniplayerButton = getYouTubeMiniPlayerButton();
    if (isPressedButton(miniplayerButton)) {
      return miniplayerButton;
    }
    return null;
  }

  function isProbablyHiddenByStyles(element) {
    if (!element || !(element instanceof Element)) {
      return true;
    }
    const style = window.getComputedStyle(element);
    if (!style) {
      return false;
    }
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) {
      return true;
    }
    return false;
  }

  function isInlineVideoVisible(video) {
    if (!video || !video.isConnected) {
      return false;
    }
    if (isProbablyHiddenByStyles(video)) {
      return false;
    }
    const rect = video.getBoundingClientRect();
    return Number(rect.width || 0) >= 160 && Number(rect.height || 0) >= 90;
  }

  function isElementVisible(element) {
    if (!element || !(element instanceof Element) || !element.isConnected) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (!style) {
      return true;
    }
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return Number(rect.width || 0) > 0 && Number(rect.height || 0) > 0;
  }

  function markUiRecoverySuppressed(ms) {
    const duration = Math.max(0, Number(ms || 0));
    if (!duration) {
      return;
    }
    state.uiRecoverySuppressUntil = Math.max(
      Number(state.uiRecoverySuppressUntil || 0),
      Date.now() + duration
    );
  }

  function isSettingsMenuExpanded() {
    const settingsButton = document.querySelector(".ytp-settings-button");
    if (settingsButton instanceof Element && settingsButton.getAttribute("aria-expanded") === "true") {
      return true;
    }
    const visibleMenu = document.querySelector(".ytp-settings-menu, .ytp-panel-menu");
    return isElementVisible(visibleMenu);
  }

  function shouldDeferVisibleRecoveryForUi() {
    const suppressUntil = Number(state.uiRecoverySuppressUntil || 0);
    if (Date.now() < suppressUntil) {
      return true;
    }
    if (isSettingsMenuExpanded()) {
      markUiRecoverySuppressed(380);
      return true;
    }
    return false;
  }

  function hasYouTubeMiniPlayerState() {
    return Boolean(
      document.querySelector(
        "ytd-app[miniplayer-active_], ytd-app[miniplayer-is-active], ytd-app[miniplayer-active]"
      )
    );
  }

  function forceRestoreYouTubeInlineContainer() {
    const app = document.querySelector("ytd-app");
    if (app && app instanceof Element) {
      app.removeAttribute("miniplayer-active_");
      app.removeAttribute("miniplayer-is-active");
      app.removeAttribute("miniplayer-active");
    }

    document.querySelectorAll("ytd-watch-flexy[hidden], #player[hidden], #movie_player[hidden]").forEach((node) => {
      if (node instanceof HTMLElement) {
        node.hidden = false;
      }
      if (node instanceof Element) {
        node.removeAttribute("hidden");
      }
    });

    document.querySelectorAll(".ytp-player-minimized").forEach((node) => {
      if (node instanceof Element) {
        node.classList.remove("ytp-player-minimized");
      }
    });
    document.body.classList.remove("ytp-player-minimized");
    document.documentElement.classList.remove("ytp-player-minimized");
  }

  function getYouTubePlayerApi() {
    const moviePlayer = document.getElementById("movie_player");
    if (moviePlayer && typeof moviePlayer === "object") {
      return moviePlayer;
    }
    const ytdPlayer = document.querySelector("ytd-player");
    if (ytdPlayer && typeof ytdPlayer.getPlayer === "function") {
      try {
        const player = ytdPlayer.getPlayer();
        if (player && typeof player === "object") {
          return player;
        }
      } catch (error) {
        // Ignore API retrieval errors.
      }
    }
    return null;
  }

  function callPlayerMethod(player, methodName, args) {
    if (!player || typeof player[methodName] !== "function") {
      return { called: false, value: undefined };
    }
    try {
      return { called: true, value: player[methodName].apply(player, Array.isArray(args) ? args : []) };
    } catch (error) {
      return { called: false, value: undefined };
    }
  }

  function forceUnminimizeViaPlayerApi() {
    const player = getYouTubePlayerApi();
    if (!player) {
      return false;
    }
    let changed = false;
    const candidates = [
      [false],
      [0],
      [null],
      []
    ];
    for (const args of candidates) {
      const result = callPlayerMethod(player, "setMinimized", args);
      changed = result.called || changed;
    }
    if (changed) {
      debugLog("setMinimized-forced", { ok: true });
    }
    return changed;
  }

  function tryExitYouTubeViaPlayerApi(video) {
    const player = getYouTubePlayerApi();
    if (!player) {
      return false;
    }

    let changed = false;
    changed = forceUnminimizeViaPlayerApi() || changed;
    const miniActive = callPlayerMethod(player, "isMiniplayerActive", []).value;
    if (miniActive === true) {
      const toggled = callPlayerMethod(player, "toggleMiniplayer", []);
      changed = toggled.called || changed;
    }

    const exitCandidates = [
      ["exitPictureInPicture", []],
      ["togglePictureInPicture", []],
      ["togglePip", []],
      ["setPictureInPicture", [false]]
    ];
    for (const [name, args] of exitCandidates) {
      const result = callPlayerMethod(player, name, args);
      changed = result.called || changed;
    }

    if (video && isVideoPlaying(video) && !isInlineVideoVisible(video)) {
      const paused = callPlayerMethod(player, "pauseVideo", []);
      const played = callPlayerMethod(player, "playVideo", []);
      changed = paused.called || played.called || changed;
    }

    debugLog("player-api-exit", { changed: changed });
    return changed;
  }

  function looksLikeYouTubeGhostPiP(video) {
    if (document.pictureInPictureElement) {
      return true;
    }
    if (hasYouTubeMiniPlayerState()) {
      return true;
    }
    if (isPressedButton(getYouTubePiPButton()) || isPressedButton(getYouTubeMiniPlayerButton())) {
      return true;
    }
    if (video && isVideoPlaying(video) && !isInlineVideoVisible(video)) {
      return true;
    }
    return false;
  }

  function tryExitYouTubePipLikeModes(video) {
    const ghostState = looksLikeYouTubeGhostPiP(video);
    if (!ghostState) {
      return false;
    }
    let changed = false;
    const pipButton = getYouTubePiPButton();
    const miniButton = getYouTubeMiniPlayerButton();
    if (pipButton && isPressedButton(pipButton)) {
      changed = clickButton(pipButton) || changed;
    }
    if (miniButton && (isPressedButton(miniButton) || hasYouTubeMiniPlayerState())) {
      changed = clickButton(miniButton) || changed;
    }
    changed = tryExitYouTubeViaPlayerApi(video) || changed;
    return changed;
  }

  function trySoftResetPlayerRender(video) {
    if (!video) {
      return;
    }
    try {
      // Nudges Chromium compositor to repaint when YouTube leaves stale mini-player state.
      video.style.transform = "translateZ(0)";
      requestAnimationFrame(() => {
        video.style.transform = "";
      });
    } catch (error) {
      // Ignore style mutation errors.
    }
  }

  function maybeHardRecoverByReload(video) {
    if (document.visibilityState !== "visible") {
      return;
    }
    if (!video || !isVideoPlaying(video) || isInlineVideoVisible(video) || document.pictureInPictureElement) {
      return;
    }
    const url = new URL(location.href);
    const seconds = Math.max(0, Math.floor(Number(video.currentTime || 0)));
    if (seconds > 0) {
      url.searchParams.set("t", String(seconds));
    }
    url.searchParams.set("autoplay", "1");
    location.replace(url.toString());
  }

  function forceReloadToReturnInlinePlayback(source) {
    if (document.visibilityState !== "visible") {
      return false;
    }
    if (!shouldAllowRecoveryReload()) {
      return false;
    }

    let seconds = 0;
    const pipElement = document.pictureInPictureElement;
    if (pipElement && pipElement instanceof HTMLVideoElement) {
      seconds = Math.max(0, Math.floor(Number(pipElement.currentTime || 0)));
    }

    if (!seconds) {
      const fallbackVideo = syncActiveVideo(state.lastManagedVideo || state.activeVideo);
      if (fallbackVideo) {
        seconds = Math.max(0, Math.floor(Number(fallbackVideo.currentTime || 0)));
      }
    }

    const url = new URL(location.href);
    if (seconds > 0) {
      url.searchParams.set("t", String(seconds));
    }
    url.searchParams.set("autoplay", "1");
    url.searchParams.set("lumno_pip_recover", "1");
    markRecoveryReloadNow();
    debugLog("force-reload-inline-recover", { source: source || "", seconds: seconds });
    location.replace(url.toString());
    return true;
  }

  function clearRecoveryTimer() {
    if (!state.recoveryTimer) {
      return;
    }
    clearTimeout(state.recoveryTimer);
    state.recoveryTimer = null;
  }

  function clearEnterRetryTimer() {
    if (!state.enterRetryTimer) {
      return;
    }
    clearTimeout(state.enterRetryTimer);
    state.enterRetryTimer = null;
  }

  function pauseAllManagedMedia() {
    const mediaNodes = Array.from(document.querySelectorAll("video, audio"));
    mediaNodes.forEach((node) => {
      if (!(node instanceof HTMLMediaElement)) {
        return;
      }
      if (node.paused || node.ended) {
        return;
      }
      try {
        node.pause();
      } catch (error) {
        // Ignore site/player-specific pause failures.
      }
    });
  }

  async function forceSurrenderPiP(reason) {
    const isHidden = document.visibilityState === "hidden";
    if (isHidden) {
      clearPlaybackRecoveryState();
    }
    state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_VISIBLE_MS;
    try {
      await maybeExitPiP("ownership_surrender");
    } catch (error) {
      // Best effort only.
    }
    if (isHidden) {
      pauseAllManagedMedia();
    }
    state.managedPiP = false;
    await releasePiPOwnership();
    return {
      ok: true,
      reason: reason || "surrendered"
    };
  }

  function bindRuntimeMessageListener() {
    if (state.runtimeMessageHandlerBound) {
      return;
    }
    if (!chrome || !chrome.runtime || !chrome.runtime.onMessage ||
        typeof chrome.runtime.onMessage.addListener !== "function") {
      return;
    }
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.action !== "lumno:pip-force-surrender") {
        return;
      }
      forceSurrenderPiP(message && message.reason ? String(message.reason) : "")
        .then((result) => {
          sendResponse(result);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            reason: error && error.message ? error.message : String(error || "surrender-failed")
          });
        });
      return true;
    });
    state.runtimeMessageHandlerBound = true;
  }

  function scheduleDeferredEnterPiP(reason) {
    if (!autoPipEnabled) {
      return;
    }
    clearEnterRetryTimer();
    if (document.visibilityState !== "hidden") {
      return;
    }
    const now = Date.now();
    const suppressUntil = Number(state.suppressEnterUntil || 0);
    const delay = suppressUntil > now ? (suppressUntil - now + 40) : 40;
    state.enterRetryTimer = setTimeout(() => {
      state.enterRetryTimer = null;
      if (document.visibilityState !== "hidden") {
        return;
      }
      maybeEnterPiP(reason || "deferred_hidden_retry");
    }, Math.max(40, delay));
  }

  async function maybeEnterPiP(reason) {
    if (!autoPipEnabled) {
      return false;
    }
    if (isDocumentPiPActive()) {
      return false;
    }
    if (!canEnterPiP() || !canExitPiP() || state.enteringPiP || state.exitingPiP) {
      return false;
    }
    if (Date.now() < Number(state.suppressEnterUntil || 0)) {
      scheduleDeferredEnterPiP(`${reason || "enter"}_suppressed_retry`);
      return false;
    }
    if (document.visibilityState !== "hidden") {
      return false;
    }
    if (document.pictureInPictureElement) {
      return true;
    }

    const activeVideo = syncActiveVideo();
    if (!isVideoPlaying(activeVideo)) {
      return false;
    }

    const ownershipResult = await requestPiPOwnership("video");
    if (!ownershipResult.granted) {
      clearPlaybackRecoveryState();
      return false;
    }

    state.enteringPiP = true;
    try {
      await activeVideo.requestPictureInPicture();
      state.managedPiP = true;
      state.lastManagedVideo = activeVideo;
      clearEnterRetryTimer();
      return true;
    } catch (error) {
      if (reason !== "media_session_action") {
        // Fallback is best-effort: hidden-tab requests can fail without activation.
      }
      return false;
    } finally {
      state.enteringPiP = false;
      if (!state.managedPiP) {
        await releasePiPOwnership();
      }
    }
  }

  async function maybeExitPiP(reason) {
    if (!canExitPiP() || state.enteringPiP || state.exitingPiP) {
      return false;
    }
    if (!state.managedPiP && !document.pictureInPictureElement) {
      await releasePiPOwnership();
      return true;
    }
    state.exitingPiP = true;
    state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_EXIT_MS;
    try {
      const backgroundResult = await requestBackgroundMainWorldExitPiP(760);
      debugLog("background-main-exit-result", backgroundResult);
      if (document.pictureInPictureElement) {
        const bridgeResult = await requestPageBridgeExitPiP(520);
        debugLog("bridge-exit-result", bridgeResult);
      }
      forceUnminimizeViaPlayerApi();
      if (!document.pictureInPictureElement) {
        state.managedPiP = false;
        return true;
      }
      await document.exitPictureInPicture();
      return !document.pictureInPictureElement;
    } catch (error) {
      return false;
    } finally {
      state.exitingPiP = false;
      state.managedPiP = false;
      forceUnminimizeViaPlayerApi();
      await releasePiPOwnership();
    }
  }

  function recoverInlinePlaybackIfNeeded(reason, attemptIndex) {
    if (document.visibilityState !== "visible") {
      return;
    }
    if (!state.shouldResumeInlinePlayback) {
      return;
    }

    if (document.pictureInPictureElement) {
      return;
    }

    const video = syncActiveVideo(state.lastManagedVideo || state.activeVideo);
    forceUnminimizeViaPlayerApi();
    const pressedPipButton = getYouTubePiPToggleButtonIfPressed();
    const shouldTryYTReset = Boolean(pressedPipButton) || looksLikeYouTubeGhostPiP(video);

    if (shouldTryYTReset) {
      if (pressedPipButton) {
        clickButton(pressedPipButton);
      }
      tryExitYouTubePipLikeModes(video);
      forceUnminimizeViaPlayerApi();
      forceRestoreYouTubeInlineContainer();
      trySoftResetPlayerRender(video);
      window.dispatchEvent(new Event("resize"));
    }

    if (video && video.paused && !video.ended) {
      video.play().catch(() => {
        // Ignore autoplay/activation errors on recovery.
      });
    }

    if (attemptIndex >= 8) {
      maybeHardRecoverByReload(video);
    }
  }

  function scheduleVisibleRecovery() {
    clearRecoveryTimer();
    if (!state.shouldResumeInlinePlayback &&
        !state.managedPiP &&
        !document.pictureInPictureElement) {
      return;
    }

    let attempts = 0;
    const run = async () => {
      if (shouldDeferVisibleRecoveryForUi()) {
        state.recoveryTimer = setTimeout(() => {
          run();
        }, 160);
        return;
      }
      attempts += 1;
      await maybeExitPiP("page_visible");
      recoverInlinePlaybackIfNeeded("visible_recovery", attempts);

      if (document.visibilityState !== "visible") {
        clearRecoveryTimer();
        return;
      }

      const stillInPiP = Boolean(document.pictureInPictureElement);
      const video = syncActiveVideo(state.lastManagedVideo || state.activeVideo);
      const stillGhost = looksLikeYouTubeGhostPiP(video);
      debugLog("visible-recover", {
        attempts: attempts,
        stillInPiP: stillInPiP,
        stillGhost: stillGhost,
        inlineVisible: isInlineVideoVisible(video)
      });
      if ((stillInPiP || stillGhost) && attempts < 10) {
        const delay = attempts < 3 ? 120 : 320;
        state.recoveryTimer = setTimeout(() => {
          run();
        }, delay);
        return;
      }
      if (stillInPiP || stillGhost) {
        forceReloadToReturnInlinePlayback("visible-recovery-stuck");
      }
      clearRecoveryTimer();
    };

    run();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      const videoForHiddenSnapshot = syncActiveVideo(state.lastManagedVideo || state.activeVideo);
      const shouldTrackRecovery = autoPipEnabled || state.managedPiP || Boolean(document.pictureInPictureElement);
      state.wasPlayingBeforeHide = Boolean(
        videoForHiddenSnapshot &&
        isVideoPlaying(videoForHiddenSnapshot) &&
        !videoForHiddenSnapshot.ended
      );
      state.shouldResumeInlinePlayback = Boolean(
        shouldTrackRecovery &&
        (
          state.wasPlayingBeforeHide ||
          state.managedPiP ||
          document.pictureInPictureElement
        )
      );
      clearRecoveryTimer();
      scheduleDeferredEnterPiP("visibility_hidden_retry");
      maybeEnterPiP("visibility_hidden");
      return;
    }
    if (document.visibilityState === "visible") {
      clearEnterRetryTimer();
      state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_VISIBLE_MS;
      scheduleVisibleRecovery();
    }
  }

  function onVideoEvent(event) {
    const target = event && event.target;
    if (!target || target.tagName !== "VIDEO") {
      return;
    }
    syncActiveVideo(target);
    if (event.type === "pause" || event.type === "ended") {
      state.shouldResumeInlinePlayback = false;
      state.wasPlayingBeforeHide = false;
    }

    if (event.type === "play" || event.type === "playing") {
      state.wasPlayingBeforeHide = true;
      if (document.visibilityState === "hidden") {
        state.shouldResumeInlinePlayback = true;
      }
    }

    if (event.type === "play" && document.visibilityState === "hidden") {
      maybeEnterPiP("video_play_hidden");
      return;
    }

    if (event.type === "ended" &&
        target === document.pictureInPictureElement &&
        state.managedPiP) {
      maybeExitPiP("video_stopped");
    }
  }

  function onEnterPictureInPicture(event) {
    if (state.enteringPiP) {
      state.managedPiP = true;
      return;
    }
    const target = event && event.target;
    state.managedPiP = Boolean(target && target === state.activeVideo);
  }

  function onLeavePictureInPicture() {
    state.managedPiP = false;
    if (document.visibilityState === "visible") {
      scheduleVisibleRecovery();
    }
  }

  function init() {
    if (!canExitPiP()) {
      return;
    }
    try {
      const url = new URL(location.href);
      if (url.searchParams.has("lumno_pip_recover")) {
        url.searchParams.delete("lumno_pip_recover");
        history.replaceState(history.state, "", url.toString());
      }
    } catch (error) {
      // Ignore URL cleanup errors.
    }
    ensurePageBridgeInjected();
    syncActiveVideo();
    bindMediaSessionAutoPiP();
    bindRuntimeMessageListener();

    document.addEventListener("visibilitychange", handleVisibilityChange, true);
    document.addEventListener("play", onVideoEvent, true);
    document.addEventListener("playing", onVideoEvent, true);
    document.addEventListener("pause", onVideoEvent, true);
    document.addEventListener("ended", onVideoEvent, true);
    document.addEventListener("enterpictureinpicture", onEnterPictureInPicture, true);
    document.addEventListener("leavepictureinpicture", onLeavePictureInPicture, true);
    document.addEventListener("pointerdown", (event) => {
      const target = event && event.target instanceof Element ? event.target : null;
      if (!target || !target.closest) {
        return;
      }
      if (target.closest(".ytp-settings-button, .ytp-panel-menu, .ytp-settings-menu")) {
        markUiRecoverySuppressed(1200);
      }
    }, true);
    window.addEventListener("focus", () => {
      state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_VISIBLE_MS;
      clearEnterRetryTimer();
      scheduleVisibleRecovery();
    }, true);
    window.addEventListener("pageshow", () => {
      state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_VISIBLE_MS;
      clearEnterRetryTimer();
      scheduleVisibleRecovery();
    }, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }
  init();
})();
