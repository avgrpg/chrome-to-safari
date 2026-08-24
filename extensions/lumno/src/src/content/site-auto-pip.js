(function () {
  if (window._x_lumno_site_auto_pip_2026_unique_) {
    return;
  }
  window._x_lumno_site_auto_pip_2026_unique_ = true;

  if (window.top !== window.self) {
    return;
  }

  const state = {
    activeVideo: null,
    lastManagedVideo: null,
    enteringPiP: false,
    exitingPiP: false,
    managedPiP: false,
    enterRetryTimer: null,
    recoveryTimer: null,
    suppressEnterUntil: 0,
    lastVisibleAt: 0,
    hadUserGesture: false,
    mediaSessionHandlerBound: false,
    hiddenRetryBudget: 0,
    shouldResumeInlinePlayback: false,
    wasPlayingBeforeHide: false,
    ownerToken: '',
    runtimeMessageHandlerBound: false,
    douyinModalReloadAt: 0
  };

  const ENTER_SUPPRESS_AFTER_EXIT_MS = 1100;
  const ENTER_SUPPRESS_AFTER_VISIBLE_MS = 1300;
  const QUICK_REHIDE_BYPASS_MS = 900;
  const DEFAULT_HIDDEN_RETRY_LIMIT = 4;
  const DEFAULT_HIDDEN_RETRY_DELAY_MS = 220;
  const MIN_VISIBLE_WIDTH = 220;
  const MIN_VISIBLE_HEIGHT = 124;
  const MIN_VISIBLE_AREA = 60000;
  const PAGE_BRIDGE_SCRIPT_ID = "__lumno_site_auto_pip_page_bridge_script_2026__";
  const PAGE_BRIDGE_REQUEST_EVENT = "__lumno_yt_force_exit_pip_req_2026__";
  const PAGE_BRIDGE_RESPONSE_EVENT = "__lumno_yt_force_exit_pip_res_2026__";
  const DOCUMENT_PIP_ACTIVE_FLAG = "__lumno_document_pip_active_2026__";
  const DOUYIN_MODAL_RECOVERY_RELOAD_GUARD_MS = 15000;
  let pageBridgeRequestSeq = 0;

  const host = String(location.hostname || "").toLowerCase();
  const AUTO_PIP_ENABLED_STORAGE_KEY = "_x_extension_auto_pip_enabled_2026_unique_";
  const providerStorageRuntime = globalThis.LumnoSettings &&
    typeof globalThis.LumnoSettings.createProviderStorageRuntime === "function"
    ? globalThis.LumnoSettings.createProviderStorageRuntime(chrome)
    : null;
  let autoPipEnabled = false;
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
    state.hiddenRetryBudget = 0;
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
        maybeExitPiP().catch(() => {});
      }
    });
  }
  syncAutoPipEnabledSetting();
  const autoPipBlacklist = window.__lumnoAutoPipBlacklist2026;
  if (host && autoPipBlacklist && Array.isArray(autoPipBlacklist.hostRules)) {
    const isBlacklisted = autoPipBlacklist.hostRules.some((rule) => {
      if (!(rule instanceof RegExp)) {
        return false;
      }
      return rule.test(host);
    });
    if (isBlacklisted) {
      return;
    }
  }
  const hostProfiles = [
    {
      test: /(^|\.)douyin\.com$/,
      selectors: [
        ".xgplayer video",
        ".xgplayer-video-wrap video",
        ".xg-video-container video",
        "[class*='videoPlayer'] video",
        "[class*='Player'] video",
        "video"
      ],
      rejectSelectors: [
        ".discover-video-card-item video",
        ".waterfall-videoCardContainer video",
        ".jingxuanVideoCard video"
      ],
      allowDisablePiP: true,
      minVisibleArea: 24000,
      allowEnterWhenHiddenVideo: true,
      autoResumeOnHiddenEnter: true,
      allowNoUserGesture: true,
      allowEnterWhenNotPlaying: true,
      hiddenRetryLimit: 24,
      hiddenRetryDelayMs: 180
    },
    {
      test: /(^|\.)bilibili\.com$/,
      selectors: [
        ".bpx-player-video-wrap video",
        ".bilibili-player-video-wrap video",
        ".bilibili-player-video video",
        "#bilibili-player video",
        "#player video"
      ]
    },
    {
      test: /(^|\.)bilibili\.tv$/,
      selectors: [
        ".bpx-player-video-wrap video",
        ".bilibili-player-video-wrap video",
        ".bilibili-player-video video",
        "#bilibili-player video",
        "#player video"
      ]
    },
    {
      test: /(^|\.)youku\.com$/,
      selectors: [
        ".html5player-video video",
        ".youku-player video",
        "#player video",
        "#ykPlayer video"
      ]
    },
    {
      test: /(^|\.)v\.qq\.com$/,
      selectors: [
        ".txp_video_container video",
        ".txp-player video",
        ".txp_videos_container video",
        ".txp_video video",
        ".mod_player video",
        "#mod_player video",
        "#player video",
        "video"
      ],
      rejectSelectors: [
        "[class*='preview'] video",
        "[class*='recommend'] video"
      ],
      allowDisablePiP: true,
      allowEnterWhenHiddenVideo: true,
      autoResumeOnHiddenEnter: true,
      allowNoUserGesture: true,
      allowEnterWhenNotPlaying: true,
      minVisibleArea: 30000,
      hiddenRetryLimit: 16,
      hiddenRetryDelayMs: 180
    },
    {
      test: /(^|\.)(iqiyi\.com|iq\.com)$/,
      selectors: [
        ".iqp-player video",
        ".iqp-player-videolayer video",
        "#flashbox video",
        "#player video"
      ],
      rejectSelectors: [
        ".player_outer_video video",
        "video[outer='1']"
      ],
      allowDisablePiP: true,
      minVisibleArea: 38000,
      allowEnterWhenHiddenVideo: true,
      autoResumeOnHiddenEnter: true,
      allowNoUserGesture: true
    },
    {
      test: /(^|\.)(kuaishou\.com|kwai\.com)$/,
      selectors: [
        ".ks-player video",
        ".video-player video",
        "[class*='player'] video",
        "video"
      ],
      rejectSelectors: [
        ".video-card video",
        ".sidebar video",
        "[class*='preview'] video"
      ],
      minVisibleArea: 36000
    },
    {
      test: /(^|\.)netflix\.com$/,
      selectors: [
        ".watch-video video",
        "[data-uia='video-canvas'] video",
        ".NFPlayer video",
        "video"
      ],
      rejectSelectors: [
        ".previewModal video",
        "[class*='preview'] video",
        "[class*='billboard'] video"
      ],
      minVisibleArea: 56000
    },
    {
      test: /(^|\.)vimeo\.com$/,
      selectors: [
        ".vp-video video",
        ".player video",
        ".js-player video",
        "video"
      ],
      rejectSelectors: [
        ".vp-preview video",
        "[class*='thumbnail'] video"
      ]
    },
    {
      test: /(^|\.)dailymotion\.com$/,
      selectors: [
        ".dmp_Player video",
        ".dmp_VideoContainer video",
        "#player video",
        "video"
      ],
      rejectSelectors: [
        ".sd_video_list video",
        "[class*='preview'] video"
      ]
    },
    {
      test: /(^|\.)(primevideo\.com|amazon\.(com|co\.uk|de|co\.jp|in))$/,
      selectors: [
        ".webPlayerSDKContainer video",
        ".atvwebplayersdk-video video",
        "#dv-web-player video",
        "video"
      ],
      rejectSelectors: [
        "[class*='trailer'] video",
        "[class*='preview'] video"
      ],
      minVisibleArea: 56000
    },
    {
      test: /(^|\.)(disneyplus\.com|hotstar\.com)$/,
      selectors: [
        ".btm-media-client-element video",
        ".video-container video",
        "[data-testid='videoPlayer'] video",
        "video"
      ],
      rejectSelectors: [
        "[class*='preview'] video",
        "[class*='trailer'] video"
      ],
      minVisibleArea: 56000
    },
    {
      test: /(^|\.)(max\.com|hbomax\.com)$/,
      selectors: [
        ".video-player video",
        ".player-container video",
        "[data-testid='video-player'] video",
        "video"
      ],
      rejectSelectors: [
        "[class*='preview'] video",
        "[class*='sizzle'] video"
      ],
      minVisibleArea: 56000
    },
    {
      test: /(^|\.)tiktok\.com$/,
      selectors: [
        "[data-e2e='video-player'] video",
        ".tiktok-player video",
        "[class*='DivVideoContainer'] video",
        "video"
      ],
      rejectSelectors: [
        "[class*='recommend'] video",
        "[class*='preview'] video"
      ],
      allowEnterWhenHiddenVideo: true,
      autoResumeOnHiddenEnter: true,
      allowNoUserGesture: true,
      minVisibleArea: 26000
    },
    {
      test: /(^|\.)tubitv\.com$/,
      selectors: [
        ".video-js video",
        ".vjs-tech",
        "#video_player video",
        "video"
      ],
      rejectSelectors: [
        ".poster video",
        "[class*='preview'] video"
      ]
    },
    {
      test: /(^|\.)pluto\.tv$/,
      selectors: [
        ".video-js video",
        ".vjs-tech",
        ".player video",
        "video"
      ],
      rejectSelectors: [
        "[class*='grid'] video",
        "[class*='preview'] video"
      ]
    },
    {
      test: /(^|\.)twitch\.tv$/,
      selectors: [
        ".video-player video",
        ".persistent-player video",
        "[data-a-target='player-overlay-click-handler'] video",
        "video"
      ],
      rejectSelectors: [
        ".channel-root__player-container--theatre + * video",
        "[class*='preview'] video"
      ],
      minVisibleArea: 42000
    }
  ];

  function getMatchedProfile() {
    const matched = hostProfiles.find((profile) => profile.test.test(host));
    return matched && typeof matched === "object" ? matched : null;
  }

  const matchedProfile = getMatchedProfile();
  const profileSelectors = matchedProfile && Array.isArray(matchedProfile.selectors)
    ? matchedProfile.selectors
    : [];
  const profileRejectSelectors = matchedProfile && Array.isArray(matchedProfile.rejectSelectors)
    ? matchedProfile.rejectSelectors
    : [];

  function isIqiyiHost() {
    return host.endsWith(".iqiyi.com") || host === "iqiyi.com" || host.includes(".iqiyi.");
  }

  function isDouyinHost() {
    return host.endsWith(".douyin.com") || host === "douyin.com";
  }

  function isDouyinJingxuanModalUrl() {
    if (!isDouyinHost()) {
      return false;
    }
    try {
      const url = new URL(location.href);
      return url.pathname === "/jingxuan" && url.searchParams.has("modal_id");
    } catch (error) {
      return false;
    }
  }

  function getHiddenRetryLimit() {
    const value = Number(matchedProfile && matchedProfile.hiddenRetryLimit);
    if (Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    return DEFAULT_HIDDEN_RETRY_LIMIT;
  }

  function getHiddenRetryDelayMs() {
    const value = Number(matchedProfile && matchedProfile.hiddenRetryDelayMs);
    if (Number.isFinite(value) && value >= 40) {
      return Math.floor(value);
    }
    return DEFAULT_HIDDEN_RETRY_DELAY_MS;
  }

  function canEnterPiP() {
    return typeof document !== "undefined" &&
      document.pictureInPictureEnabled === true;
  }

  function canExitPiP() {
    return typeof document !== "undefined" &&
      typeof document.exitPictureInPicture === "function";
  }

  function isVideoPlaying(video) {
    if (!video) {
      return false;
    }
    return !video.paused && !video.ended && Number(video.readyState || 0) >= 2;
  }

  function isProbablyHiddenByStyles(element) {
    if (!element || !(element instanceof Element)) {
      return true;
    }
    const style = window.getComputedStyle(element);
    if (!style) {
      return false;
    }
    return style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity || 1) === 0;
  }

  function getVisibleArea(video) {
    if (!video || typeof video.getBoundingClientRect !== "function") {
      return 0;
    }
    const rect = video.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (vw <= 0 || vh <= 0) {
      return 0;
    }
    const left = Math.max(0, Math.min(vw, rect.left));
    const right = Math.max(0, Math.min(vw, rect.right));
    const top = Math.max(0, Math.min(vh, rect.top));
    const bottom = Math.max(0, Math.min(vh, rect.bottom));
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    return width * height;
  }

  function getRectArea(video) {
    if (!video || typeof video.getBoundingClientRect !== "function") {
      return 0;
    }
    const rect = video.getBoundingClientRect();
    const width = Math.max(0, Number(rect.width || 0));
    const height = Math.max(0, Number(rect.height || 0));
    return width * height;
  }

  function isVideoVisibleEnough(video) {
    if (!video || !video.isConnected || isProbablyHiddenByStyles(video)) {
      return false;
    }
    const rect = video.getBoundingClientRect();
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    if (width < MIN_VISIBLE_WIDTH || height < MIN_VISIBLE_HEIGHT) {
      return false;
    }
    const minArea = Number(matchedProfile && matchedProfile.minVisibleArea) > 0
      ? Number(matchedProfile.minVisibleArea)
      : MIN_VISIBLE_AREA;
    return getVisibleArea(video) >= minArea;
  }

  function hasAnyPlayingMedia() {
    const mediaNodes = Array.from(document.querySelectorAll("video, audio"));
    return mediaNodes.some((node) => {
      return node instanceof HTMLMediaElement &&
        !node.paused &&
        !node.ended &&
        Number(node.readyState || 0) >= 2;
    });
  }

  function shouldRecoverDouyinModalByReload() {
    if (!isDouyinJingxuanModalUrl()) {
      return false;
    }
    const activeVideo = syncActiveVideo(state.lastManagedVideo || state.activeVideo);
    if (activeVideo && activeVideo.isConnected && isVideoVisibleEnough(activeVideo)) {
      return false;
    }
    return hasAnyPlayingMedia() || state.shouldResumeInlinePlayback;
  }

  function reloadDouyinModalIfNeeded() {
    if (!shouldRecoverDouyinModalByReload()) {
      return false;
    }
    const now = Date.now();
    if ((now - Number(state.douyinModalReloadAt || 0)) < DOUYIN_MODAL_RECOVERY_RELOAD_GUARD_MS) {
      return false;
    }
    state.douyinModalReloadAt = now;
    location.replace(location.href);
    return true;
  }

  function isLikelyAudible(video) {
    if (!video) {
      return false;
    }
    if (video.muted || Number(video.volume || 0) === 0) {
      return false;
    }
    if (typeof video.audioTracks === "object" && video.audioTracks && video.audioTracks.length > 0) {
      for (let i = 0; i < video.audioTracks.length; i += 1) {
        if (video.audioTracks[i] && video.audioTracks[i].enabled !== false) {
          return true;
        }
      }
      return false;
    }
    return true;
  }

  function isRejectedByProfile(video) {
    if (!video || profileRejectSelectors.length === 0) {
      return false;
    }
    for (const selector of profileRejectSelectors) {
      try {
        if (video.matches(selector)) {
          return true;
        }
      } catch (error) {
        // Ignore invalid selector and continue.
      }
      try {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }
        if (node === video) {
          return true;
        }
        if (typeof node.contains === "function" && node.contains(video)) {
          return true;
        }
      } catch (error) {
        // Ignore invalid selector and continue.
      }
    }
    return false;
  }

  function isVideoCandidate(video) {
    if (isRejectedByProfile(video)) {
      return false;
    }
    const allowDisablePiP = Boolean(matchedProfile && matchedProfile.allowDisablePiP);
    return video instanceof HTMLVideoElement &&
      video.isConnected &&
      (allowDisablePiP || !video.disablePictureInPicture) &&
      Number(video.videoWidth || 0) > 0 &&
      Number(video.videoHeight || 0) > 0;
  }

  function hasProfileBoost(video) {
    if (!video || profileSelectors.length === 0) {
      return false;
    }
    for (const selector of profileSelectors) {
      try {
        const node = document.querySelector(selector);
        if (!node) {
          continue;
        }
        if (node === video) {
          return true;
        }
        if (typeof node.contains === "function" && node.contains(video)) {
          return true;
        }
      } catch (error) {
        // Ignore invalid selector and continue.
      }
    }
    return false;
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
      const visibleArea = getVisibleArea(video);
      const area = Math.max(visibleArea, getRectArea(video));
      if (area <= 0) {
        continue;
      }
      const playingBoost = isVideoPlaying(video) ? 1_000_000_000 : 0;
      const audibleBoost = isLikelyAudible(video) ? 250_000_000 : 0;
      const profileBoost = hasProfileBoost(video) ? 180_000_000 : 0;
      const lastManagedBoost = video === state.lastManagedVideo ? 20_000_000 : 0;
      const activeBoost = video === state.activeVideo ? 10_000_000 : 0;
      const score = playingBoost + audibleBoost + profileBoost + lastManagedBoost + activeBoost + area;
      if (score > bestScore) {
        bestScore = score;
        best = video;
      }
    }

    return best || videos[0] || null;
  }

  function syncActiveVideo(preferred) {
    if (isVideoCandidate(preferred)) {
      state.activeVideo = preferred;
      return state.activeVideo;
    }
    state.activeVideo = pickPrimaryVideo();
    return state.activeVideo;
  }

  function clearEnterRetryTimer() {
    if (!state.enterRetryTimer) {
      return;
    }
    clearTimeout(state.enterRetryTimer);
    state.enterRetryTimer = null;
  }

  function clearRecoveryTimer() {
    if (!state.recoveryTimer) {
      return;
    }
    clearTimeout(state.recoveryTimer);
    state.recoveryTimer = null;
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
        // Ignore pause failures from site-specific players.
      }
    });
  }

  function markPlaybackIntentFromActiveVideo() {
    const activeVideo = syncActiveVideo(state.lastManagedVideo || state.activeVideo);
    if (isVideoPlaying(activeVideo)) {
      state.hadUserGesture = true;
      state.wasPlayingBeforeHide = true;
      return true;
    }
    return false;
  }

  async function forceSurrenderPiP(reason) {
    const isHidden = document.visibilityState === "hidden";
    if (isHidden) {
      clearPlaybackRecoveryState();
    }
    state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_VISIBLE_MS;
    try {
      await maybeExitPiP();
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
    const baseDelay = getHiddenRetryDelayMs();
    const delay = suppressUntil > now ? (suppressUntil - now + 40) : baseDelay;
    state.enterRetryTimer = setTimeout(async () => {
      state.enterRetryTimer = null;
      if (document.visibilityState !== "hidden") {
        return;
      }
      const entered = await maybeEnterPiP(reason || "deferred_hidden_retry");
      if (entered || document.visibilityState !== "hidden") {
        return;
      }
      if (state.enterRetryTimer) {
        return;
      }
      if (Number(state.hiddenRetryBudget || 0) <= 0) {
        return;
      }
      state.hiddenRetryBudget = Math.max(0, Number(state.hiddenRetryBudget || 0) - 1);
      scheduleDeferredEnterPiP(`${reason || "deferred_hidden_retry"}_loop`);
    }, Math.max(40, delay));
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
      // Older Chromium versions may not support this action.
    }
  }

  function ensurePageBridgeInjected() {
    if (document.getElementById(PAGE_BRIDGE_SCRIPT_ID)) {
      return;
    }
    const runtime = typeof chrome !== "undefined" ? chrome.runtime : null;
    if (!runtime || typeof runtime.getURL !== "function") {
      return;
    }
    const script = document.createElement("script");
    script.id = PAGE_BRIDGE_SCRIPT_ID;
    script.src = runtime.getURL("src/content/youtube-auto-pip-page.js");
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
      }, Math.max(120, Number(timeoutMs || 520)));
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
      }, Math.max(160, Number(timeoutMs || 760)));
      try {
        chrome.runtime.sendMessage({ action: "forceExitPiPInMainWorld" }, (response) => {
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

  function requestBackgroundMainWorldEnterPiP(timeoutMs, actionName) {
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
      }, Math.max(160, Number(timeoutMs || 900)));
      try {
        chrome.runtime.sendMessage({ action: actionName || "siteTryEnterPiPInMainWorld" }, (response) => {
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

  function requestBackgroundSetupIqiyiAutoPiP(timeoutMs) {
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
      }, Math.max(200, Number(timeoutMs || 1000)));
      try {
        chrome.runtime.sendMessage({ action: "iqiyiSetupAutoPiPInMainWorld" }, (response) => {
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

  async function requestVideoPictureInPicture(video) {
    if (!video || typeof video.requestPictureInPicture !== "function") {
      return false;
    }
    const allowDisablePiP = Boolean(matchedProfile && matchedProfile.allowDisablePiP);
    const hadDisableAttr = video.hasAttribute("disablepictureinpicture");
    const previousDisable = Boolean(video.disablePictureInPicture);
    if (allowDisablePiP && previousDisable) {
      try {
        video.disablePictureInPicture = false;
        if (hadDisableAttr) {
          video.removeAttribute("disablepictureinpicture");
        }
      } catch (error) {
        // Ignore property/attribute write errors.
      }
    }
    try {
      await video.requestPictureInPicture();
      return true;
    } finally {
      if (allowDisablePiP && previousDisable) {
        try {
          video.disablePictureInPicture = previousDisable;
          if (hadDisableAttr) {
            video.setAttribute("disablepictureinpicture", "");
          }
        } catch (error) {
          // Ignore restore errors.
        }
      }
    }
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
    const allowNoUserGesture = Boolean(matchedProfile && matchedProfile.allowNoUserGesture);
    if (!state.hadUserGesture && !allowNoUserGesture && reason !== "media_session_action") {
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

    let activeVideo = syncActiveVideo();
    if ((!activeVideo || !isVideoPlaying(activeVideo)) &&
        isVideoCandidate(state.lastManagedVideo)) {
      activeVideo = syncActiveVideo(state.lastManagedVideo);
    }

    let ownershipGranted = false;
    const ensureOwnership = async () => {
      if (ownershipGranted || state.ownerToken) {
        ownershipGranted = true;
        return true;
      }
      const ownershipResult = await requestPiPOwnership("video");
      if (!ownershipResult.granted) {
        clearPlaybackRecoveryState();
        return false;
      }
      ownershipGranted = true;
      return true;
    };

    if (isDouyinHost() && !isVideoPlaying(activeVideo)) {
      return false;
    }

    if (isIqiyiHost() || isDouyinHost()) {
      if (!(await ensureOwnership())) {
        return false;
      }
      if (isIqiyiHost()) {
        await requestBackgroundSetupIqiyiAutoPiP(960);
      }
      await requestBackgroundMainWorldEnterPiP(
        920,
        isIqiyiHost() ? "iqiyiTryEnterPiPInMainWorld" : "siteTryEnterPiPInMainWorld"
      );
      if (document.pictureInPictureElement) {
        state.managedPiP = true;
        if (document.pictureInPictureElement instanceof HTMLVideoElement) {
          state.lastManagedVideo = document.pictureInPictureElement;
        }
        state.hiddenRetryBudget = 0;
        clearEnterRetryTimer();
        return true;
      }
    }

    if (!isVideoPlaying(activeVideo)) {
      return false;
    }

    const allowEnterWhenHiddenVideo = Boolean(
      matchedProfile &&
      matchedProfile.allowEnterWhenHiddenVideo &&
      document.visibilityState === "hidden"
    );
    if (!allowEnterWhenHiddenVideo && !isVideoVisibleEnough(activeVideo)) {
      return false;
    }

    if (!(await ensureOwnership())) {
      return false;
    }

    state.enteringPiP = true;
    try {
      const entered = await requestVideoPictureInPicture(activeVideo);
      if (!entered) {
        return false;
      }
      state.managedPiP = true;
      state.lastManagedVideo = activeVideo;
      state.hiddenRetryBudget = 0;
      clearEnterRetryTimer();
      return true;
    } catch (error) {
      return false;
    } finally {
      state.enteringPiP = false;
      if (!state.managedPiP && ownershipGranted) {
        await releasePiPOwnership();
      }
    }
  }

  async function maybeExitPiP() {
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
      await requestBackgroundMainWorldExitPiP(760);
      if (document.pictureInPictureElement) {
        await requestPageBridgeExitPiP(520);
      }
      if (!document.pictureInPictureElement) {
        return true;
      }
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      }
      return !document.pictureInPictureElement;
    } catch (error) {
      return false;
    } finally {
      state.exitingPiP = false;
      state.managedPiP = false;
      await releasePiPOwnership();
    }
  }

  function recoverInlinePlaybackIfNeeded() {
    if (document.visibilityState !== "visible") {
      return;
    }
    if (!state.shouldResumeInlinePlayback) {
      return;
    }
    if (document.pictureInPictureElement) {
      return;
    }
    if (reloadDouyinModalIfNeeded()) {
      return;
    }
    const video = syncActiveVideo(state.lastManagedVideo || state.activeVideo);
    if (video && video.paused && !video.ended) {
      video.play().catch(() => {
        // Best effort only.
      });
    }
  }

  function scheduleVisibleRecovery() {
    clearRecoveryTimer();
    if (!state.shouldResumeInlinePlayback &&
        !state.managedPiP &&
        !document.pictureInPictureElement) {
      return;
    }
    if (!state.managedPiP && !document.pictureInPictureElement) {
      recoverInlinePlaybackIfNeeded();
      return;
    }

    let attempts = 0;
    const run = async () => {
      attempts += 1;
      await maybeExitPiP();
      if (reloadDouyinModalIfNeeded()) {
        clearRecoveryTimer();
        return;
      }
      recoverInlinePlaybackIfNeeded();
      if (document.visibilityState !== "visible") {
        clearRecoveryTimer();
        return;
      }
      if (document.pictureInPictureElement && attempts < 5) {
        state.recoveryTimer = setTimeout(run, attempts < 3 ? 120 : 280);
        return;
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
      state.hiddenRetryBudget = getHiddenRetryLimit();
      if (isIqiyiHost()) {
        requestBackgroundSetupIqiyiAutoPiP(960).catch(() => {});
      }
      const now = Date.now();
      const visibleSuppressStart = Number(state.lastVisibleAt || 0);
      const isQuickRehide = visibleSuppressStart > 0 &&
        (now - visibleSuppressStart) <= QUICK_REHIDE_BYPASS_MS;
      if (isQuickRehide && Number(state.suppressEnterUntil || 0) > now) {
        state.suppressEnterUntil = 0;
      }
      clearRecoveryTimer();
      scheduleDeferredEnterPiP("visibility_hidden_retry");
      maybeEnterPiP("visibility_hidden");
      return;
    }
    if (document.visibilityState === "visible") {
      markPlaybackIntentFromActiveVideo();
      state.hiddenRetryBudget = 0;
      state.lastVisibleAt = Date.now();
      clearEnterRetryTimer();
      state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_VISIBLE_MS;
      scheduleVisibleRecovery();
    }
  }

  function onVideoEvent(event) {
    const target = event && event.target;
    if (!(target instanceof HTMLVideoElement)) {
      return;
    }
    syncActiveVideo(target);
    if (event.type === "pause" || event.type === "ended") {
      state.shouldResumeInlinePlayback = false;
      state.wasPlayingBeforeHide = false;
    }
    if ((event.type === "play" || event.type === "playing") && !state.hadUserGesture) {
      state.hadUserGesture = true;
    }
    if (event.type === "play" || event.type === "playing") {
      state.wasPlayingBeforeHide = true;
      if (document.visibilityState === "hidden") {
        state.shouldResumeInlinePlayback = true;
      }
    }
    if ((event.type === "play" || event.type === "playing") && document.visibilityState === "hidden") {
      maybeEnterPiP("video_play_hidden");
      return;
    }
    if (event.type === "ended" &&
        target === document.pictureInPictureElement &&
        state.managedPiP) {
      maybeExitPiP();
    }
  }

  function onEnterPictureInPicture(event) {
    if (state.enteringPiP || document.visibilityState === "hidden") {
      state.managedPiP = true;
      return;
    }
    const target = event && event.target;
    state.managedPiP = Boolean(target && target === state.lastManagedVideo);
  }

  function onLeavePictureInPicture() {
    state.managedPiP = false;
    if (document.visibilityState === "visible") {
      scheduleVisibleRecovery();
    }
  }

  function markUserGesture() {
    state.hadUserGesture = true;
  }

  function init() {
    if (!canExitPiP()) {
      return;
    }
    if (isIqiyiHost()) {
      requestBackgroundSetupIqiyiAutoPiP(960).catch(() => {});
    }
    syncActiveVideo();
    markPlaybackIntentFromActiveVideo();
    ensurePageBridgeInjected();
    bindMediaSessionAutoPiP();
    bindRuntimeMessageListener();

    document.addEventListener("pointerdown", markUserGesture, true);
    document.addEventListener("keydown", markUserGesture, true);
    document.addEventListener("touchstart", markUserGesture, true);
    document.addEventListener("visibilitychange", handleVisibilityChange, true);
    document.addEventListener("play", onVideoEvent, true);
    document.addEventListener("playing", onVideoEvent, true);
    document.addEventListener("pause", onVideoEvent, true);
    document.addEventListener("ended", onVideoEvent, true);
    document.addEventListener("loadedmetadata", onVideoEvent, true);
    document.addEventListener("enterpictureinpicture", onEnterPictureInPicture, true);
    document.addEventListener("leavepictureinpicture", onLeavePictureInPicture, true);

    window.addEventListener("focus", () => {
      markPlaybackIntentFromActiveVideo();
      state.suppressEnterUntil = Date.now() + ENTER_SUPPRESS_AFTER_VISIBLE_MS;
      clearEnterRetryTimer();
      scheduleVisibleRecovery();
    }, true);
    window.addEventListener("pageshow", () => {
      markPlaybackIntentFromActiveVideo();
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
