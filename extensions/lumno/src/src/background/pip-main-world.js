(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoPipMainWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function getSenderFrameTarget(sender) {
    const senderTab = sender && sender.tab ? sender.tab : null;
    const tabId = senderTab && typeof senderTab.id === 'number' ? senderTab.id : null;
    if (typeof tabId !== 'number') {
      return null;
    }
    return {
      tabId: tabId,
      frameId: sender && typeof sender.frameId === 'number' ? sender.frameId : 0
    };
  }

  function normalizeExecuteScriptPayload(results) {
    const first = Array.isArray(results) && results.length > 0 ? results[0] : null;
    const payload = first && typeof first.result === 'object' ? first.result : null;
    return payload || { ok: false, reason: 'no-result' };
  }

  function executeMainWorld(chromeApi, sender, func) {
    const target = getSenderFrameTarget(sender);
    if (!target) {
      return Promise.resolve({ ok: false, reason: 'no-tab' });
    }
    if (!chromeApi ||
        !chromeApi.scripting ||
        typeof chromeApi.scripting.executeScript !== 'function') {
      return Promise.resolve({ ok: false, reason: 'executeScript-unavailable' });
    }
    return new Promise((resolve) => {
      chromeApi.scripting.executeScript({
        target: { tabId: target.tabId, frameIds: [target.frameId] },
        world: 'MAIN',
        func: func
      }, (results) => {
        if (chromeApi.runtime && chromeApi.runtime.lastError) {
          resolve({
            ok: false,
            reason: chromeApi.runtime.lastError.message || 'executeScript-failed'
          });
          return;
        }
        resolve(normalizeExecuteScriptPayload(results));
      });
    });
  }

  async function siteTryEnterPiPInMainWorld() {
    const result = {
      ok: true,
      before: Boolean(document.pictureInPictureElement),
      after: Boolean(document.pictureInPictureElement),
      attempted: false,
      used: '',
      error: ''
    };

    const selectors = [
      '.xgplayer video',
      '.xgplayer-video-wrap video',
      '.xg-video-container video',
      '.iqp-player-videolayer video',
      '.iqp-player video',
      '.bpx-player-video-wrap video',
      '#player video',
      'video'
    ];

    const host = String(location.hostname || '').toLowerCase();
    const isDouyinHost = host.endsWith('.douyin.com') || host === 'douyin.com';
    const isIqiyiHost = host.endsWith('.iqiyi.com') || host === 'iqiyi.com' || host.includes('.iqiyi.');
    const candidateVideos = [];
    const seen = new WeakSet();
    const pushVideo = (video) => {
      if (!(video instanceof HTMLVideoElement)) {
        return;
      }
      if (!video.isConnected || seen.has(video)) {
        return;
      }
      seen.add(video);
      candidateVideos.push(video);
    };

    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        pushVideo(node);
      }
    }
    Array.from(document.querySelectorAll('video')).forEach((node) => {
      pushVideo(node);
    });

    const getArea = (video) => {
      if (!video || typeof video.getBoundingClientRect !== 'function') {
        return 0;
      }
      const rect = video.getBoundingClientRect();
      const width = Math.max(0, Number(rect.width || 0));
      const height = Math.max(0, Number(rect.height || 0));
      return width * height;
    };

    const hasBoost = (video) => {
      if (!video || typeof video.closest !== 'function') {
        return false;
      }
      if (isDouyinHost) {
        return Boolean(video.closest('.xgplayer, .xgplayer-video-wrap, .xg-video-container'));
      }
      if (host.endsWith('.iqiyi.com') || host === 'iqiyi.com' || host.includes('.iqiyi.')) {
        return Boolean(video.closest('.iqp-player, .iqp-player-videolayer, #flashbox, #player'));
      }
      if (host.endsWith('.bilibili.com') || host === 'bilibili.com') {
        return Boolean(video.closest('.bpx-player-video-wrap, .bilibili-player-video-wrap, #bilibili-player, #player'));
      }
      return false;
    };

    const scoreVideo = (video) => {
      if (!(video instanceof HTMLVideoElement) || !video.isConnected) {
        return -1;
      }
      const area = getArea(video);
      const resolution = Math.max(
        0,
        Number(video.videoWidth || 0) * Number(video.videoHeight || 0)
      );
      const hasFrame = resolution > 0 || Number(video.readyState || 0) >= 1;
      if (!hasFrame) {
        return -1;
      }
      const playingBoost = (!video.paused && !video.ended && Number(video.readyState || 0) >= 2)
        ? 1_000_000_000
        : 0;
      const profileBoost = hasBoost(video) ? 180_000_000 : 0;
      const resolutionBoost = Math.min(80_000_000, Math.floor(resolution / 24));
      return playingBoost + profileBoost + resolutionBoost + area;
    };

    candidateVideos.sort((a, b) => scoreVideo(b) - scoreVideo(a));

    for (const video of candidateVideos) {
      if (document.pictureInPictureElement) {
        break;
      }
      if (scoreVideo(video) < 0) {
        continue;
      }
      try {
        video.autoPictureInPicture = true;
      } catch (e) {}
      try {
        if (video.disablePictureInPicture) {
          video.disablePictureInPicture = false;
        }
      } catch (e) {}
      try {
        if (video.hasAttribute('disablepictureinpicture')) {
          video.removeAttribute('disablepictureinpicture');
        }
      } catch (e) {}
      if (isIqiyiHost && video.paused && !video.ended) {
        try {
          await video.play();
        } catch (e) {}
      }
      if (typeof video.requestPictureInPicture !== 'function') {
        continue;
      }
      try {
        result.attempted = true;
        result.used = 'video.requestPictureInPicture';
        await video.requestPictureInPicture();
        if (document.pictureInPictureElement) {
          break;
        }
      } catch (e) {
        result.error = e && e.name ? String(e.name) : String(e);
      }
    }

    result.after = Boolean(document.pictureInPictureElement);
    return result;
  }

  async function iqiyiTryEnterPiPInMainWorld() {
    const result = {
      ok: true,
      before: Boolean(document.pictureInPictureElement),
      after: Boolean(document.pictureInPictureElement),
      attempted: false,
      used: '',
      error: ''
    };

    const callMethod = async (obj, candidates) => {
      if (!obj || typeof obj !== 'object' || !Array.isArray(candidates)) {
        return false;
      }
      for (const candidate of candidates) {
        const name = typeof candidate === 'string' ? candidate : candidate && candidate.name;
        const args = (candidate && Array.isArray(candidate.args)) ? candidate.args : [];
        if (typeof obj[name] !== 'function') {
          continue;
        }
        try {
          const output = obj[name].apply(obj, args);
          if (output && typeof output.then === 'function') {
            await output;
          }
          result.attempted = true;
          result.used = `method:${name}${args.length ? '(args)' : ''}`;
          if (document.pictureInPictureElement) {
            return true;
          }
        } catch (e) {
          // Try next candidate.
        }
      }
      return false;
    };

    const trySetPiPProperty = (obj) => {
      if (!obj || typeof obj !== 'object' || !('pictureInPicture' in obj)) {
        return false;
      }
      try {
        obj.pictureInPicture = true;
        result.attempted = true;
        result.used = 'property:pictureInPicture';
        return Boolean(document.pictureInPictureElement);
      } catch (e) {
        return false;
      }
    };

    const getPrimaryVideo = () => {
      const selectors = [
        '.iqp-player-videolayer video',
        '.iqp-player video',
        '#flashbox video',
        '#player video',
        'video'
      ];
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!(node instanceof HTMLVideoElement)) {
            continue;
          }
          if (node.matches('.player_outer_video video') || node.getAttribute('outer') === '1') {
            continue;
          }
          return node;
        }
      }
      return null;
    };

    const roots = [];
    const rootSet = new WeakSet();
    const pushRoot = (obj) => {
      if (!obj || typeof obj !== 'object') {
        return;
      }
      if (rootSet.has(obj)) {
        return;
      }
      rootSet.add(obj);
      roots.push(obj);
    };

    try {
      if (window.webPlay &&
          window.webPlay.wonder &&
          typeof window.webPlay.wonder.getPlayer === 'function') {
        pushRoot(window.webPlay.wonder.getPlayer());
      }
    } catch (e) {}
    try {
      if (window.webPlay &&
          window.webPlay.wonder &&
          typeof window.webPlay.wonder.getPCBridge === 'function') {
        pushRoot(window.webPlay.wonder.getPCBridge());
      }
    } catch (e) {}
    try {
      if (window.webPlay &&
          window.webPlay.wonder &&
          window.webPlay.wonder._manager &&
          window.webPlay.wonder._manager._players &&
          typeof window.webPlay.wonder._manager._players === 'object') {
        Object.values(window.webPlay.wonder._manager._players).forEach((player) => {
          pushRoot(player);
        });
      }
    } catch (e) {}

    const collectLoaderPlayers = async (timeoutMs) => {
      if (!window.QiyiPlayerLoader || typeof window.QiyiPlayerLoader.ready !== 'function') {
        return;
      }
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) {
            return;
          }
          done = true;
          resolve();
        };
        const timer = setTimeout(finish, Math.max(120, Number(timeoutMs || 260)));
        try {
          window.QiyiPlayerLoader.ready((manager) => {
            try {
              if (manager && typeof manager === 'object') {
                pushRoot(manager);
                if (manager._players && typeof manager._players === 'object') {
                  Object.values(manager._players).forEach((player) => {
                    pushRoot(player);
                  });
                }
                if (typeof manager.getPlayerById === 'function') {
                  ['mainContent', 'root', 'player', '5fcma2g3wzdcvv2smpk4d3h3vq'].forEach((id) => {
                    try {
                      pushRoot(manager.getPlayerById(id));
                    } catch (e) {}
                  });
                }
              }
            } catch (e) {
              // Ignore manager traversal errors.
            } finally {
              clearTimeout(timer);
              finish();
            }
          });
        } catch (e) {
          clearTimeout(timer);
          finish();
        }
      });
    };

    await collectLoaderPlayers(280);
    if (!roots.length) {
      await collectLoaderPlayers(360);
    }

    const methodCandidates = [
      { name: 'openPictureInPicture', args: [] },
      { name: 'toggleBrowserPicInPic', args: [] },
      { name: 'togglePictureInPicture', args: [] },
      { name: 'togglePip', args: [] },
      { name: 'enterPictureInPicture', args: [] },
      { name: 'setSmallWindowMode', args: [true] }
    ];

    const nestedKeys = [
      '_playBack',
      'playBack',
      '_player',
      'player',
      '_playProxy',
      'videoInfo',
      '_videoInfo'
    ];

    for (const root of roots) {
      if (document.pictureInPictureElement) {
        break;
      }
      await callMethod(root, methodCandidates);
      if (document.pictureInPictureElement) {
        break;
      }
      trySetPiPProperty(root);
      if (document.pictureInPictureElement) {
        break;
      }
      for (const key of nestedKeys) {
        if (!root || typeof root !== 'object') {
          continue;
        }
        const nested = root[key];
        if (!nested || typeof nested !== 'object') {
          continue;
        }
        await callMethod(nested, methodCandidates);
        if (document.pictureInPictureElement) {
          break;
        }
        trySetPiPProperty(nested);
        if (document.pictureInPictureElement) {
          break;
        }
      }
    }

    if (!document.pictureInPictureElement) {
      const video = getPrimaryVideo();
      if (video && typeof video.requestPictureInPicture === 'function') {
        try {
          if (video.disablePictureInPicture) {
            video.disablePictureInPicture = false;
          }
          if (video.hasAttribute('disablepictureinpicture')) {
            video.removeAttribute('disablepictureinpicture');
          }
          result.attempted = true;
          result.used = 'video.requestPictureInPicture';
          await video.requestPictureInPicture();
        } catch (e) {
          result.error = e && e.name ? String(e.name) : String(e);
        }
      }
    }

    result.after = Boolean(document.pictureInPictureElement);
    return result;
  }

  function iqiyiSetupAutoPiPInMainWorld() {
    const result = {
      ok: true,
      bound: false,
      preparedVideos: 0,
      error: ''
    };
    try {
      if (window.__lumnoIqiyiAutoPipSetupDone2026) {
        result.bound = true;
        return result;
      }

      const getPrimaryVideo = () => {
        const selectors = [
          '.iqp-player-videolayer video',
          '.iqp-player video',
          '#flashbox video',
          '#player video',
          'video'
        ];
        for (const selector of selectors) {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            if (!(node instanceof HTMLVideoElement)) {
              continue;
            }
            if (node.matches('.player_outer_video video') || node.getAttribute('outer') === '1') {
              continue;
            }
            return node;
          }
        }
        return null;
      };

      const prepareVideo = (video) => {
        if (!(video instanceof HTMLVideoElement)) {
          return false;
        }
        if (video.matches('.player_outer_video video') || video.getAttribute('outer') === '1') {
          return false;
        }
        try {
          video.autoPictureInPicture = true;
        } catch (e) {}
        try {
          if (video.disablePictureInPicture) {
            video.disablePictureInPicture = false;
          }
        } catch (e) {}
        try {
          if (video.hasAttribute('disablepictureinpicture')) {
            video.removeAttribute('disablepictureinpicture');
          }
        } catch (e) {}
        return true;
      };

      const prepareExistingVideos = () => {
        let count = 0;
        const list = Array.from(document.querySelectorAll('video'));
        for (const video of list) {
          if (prepareVideo(video)) {
            count += 1;
          }
        }
        return count;
      };

      const mediaSession = ('mediaSession' in navigator) ? navigator.mediaSession : null;
      const proto = mediaSession ? Object.getPrototypeOf(mediaSession) : null;
      const nativeSetActionHandler = proto && typeof proto.setActionHandler === 'function'
        ? proto.setActionHandler
        : null;

      if (mediaSession && nativeSetActionHandler) {
        nativeSetActionHandler.call(mediaSession, 'enterpictureinpicture', async () => {
          const video = getPrimaryVideo();
          if (!video || typeof video.requestPictureInPicture !== 'function') {
            return;
          }
          try {
            prepareVideo(video);
            if (!video.paused || document.visibilityState === 'hidden') {
              await video.requestPictureInPicture();
            }
          } catch (e) {}
        });
        nativeSetActionHandler.call(mediaSession, 'leavepictureinpicture', async () => {
          try {
            if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
              await document.exitPictureInPicture();
            }
          } catch (e) {}
        });
        result.bound = true;
      }

      result.preparedVideos = prepareExistingVideos();

      if (!window.__lumnoIqiyiAutoPipObserver2026) {
        const observer = new MutationObserver(() => {
          prepareExistingVideos();
        });
        observer.observe(document.documentElement || document.body, {
          childList: true,
          subtree: true
        });
        window.__lumnoIqiyiAutoPipObserver2026 = observer;
      }

      window.__lumnoIqiyiAutoPipSetupDone2026 = true;
      return result;
    } catch (e) {
      result.ok = false;
      result.error = e && e.message ? String(e.message) : String(e);
      return result;
    }
  }

  async function forceExitPiPInMainWorld() {
    const result = {
      ok: true,
      before: Boolean(document.pictureInPictureElement),
      after: Boolean(document.pictureInPictureElement),
      attemptedExit: false,
      error: ''
    };
    try {
      if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
        result.attemptedExit = true;
        await document.exitPictureInPicture();
      }
    } catch (e) {
      result.error = e && e.name ? String(e.name) : String(e);
    }
    result.after = Boolean(document.pictureInPictureElement);
    return result;
  }

  async function youtubeForceExitPiPInMainWorld() {
    const result = {
      ok: true,
      before: Boolean(document.pictureInPictureElement),
      after: Boolean(document.pictureInPictureElement),
      attemptedExit: false,
      unminimized: false,
      error: ''
    };

    const getPlayer = () => {
      const moviePlayer = document.getElementById('movie_player');
      if (moviePlayer && typeof moviePlayer === 'object') {
        return moviePlayer;
      }
      const ytdPlayer = document.querySelector('ytd-player');
      if (ytdPlayer && typeof ytdPlayer.getPlayer === 'function') {
        try {
          return ytdPlayer.getPlayer();
        } catch (e) {
          return null;
        }
      }
      return null;
    };

    const callPlayerMethod = (player, name, args) => {
      if (!player || typeof player[name] !== 'function') {
        return false;
      }
      try {
        player[name].apply(player, Array.isArray(args) ? args : []);
        return true;
      } catch (e) {
        return false;
      }
    };

    const forceUnminimize = () => {
      const player = getPlayer();
      if (!player) {
        return false;
      }
      let changed = false;
      changed = callPlayerMethod(player, 'setMinimized', [false]) || changed;
      changed = callPlayerMethod(player, 'setMinimized', [0]) || changed;
      changed = callPlayerMethod(player, 'setMinimized', [null]) || changed;
      changed = callPlayerMethod(player, 'setMinimized', []) || changed;
      return changed;
    };

    result.unminimized = forceUnminimize();
    try {
      if (document.pictureInPictureElement && typeof document.exitPictureInPicture === 'function') {
        result.attemptedExit = true;
        await document.exitPictureInPicture();
      }
    } catch (e) {
      result.error = e && e.name ? String(e.name) : String(e);
    }
    result.unminimized = forceUnminimize() || result.unminimized;
    result.after = Boolean(document.pictureInPictureElement);
    return result;
  }

  function create(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const chromeApi = settings.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);

    return {
      siteTryEnterPiPInMainWorld(sender) {
        return executeMainWorld(chromeApi, sender, siteTryEnterPiPInMainWorld);
      },
      iqiyiTryEnterPiPInMainWorld(sender) {
        return executeMainWorld(chromeApi, sender, iqiyiTryEnterPiPInMainWorld);
      },
      iqiyiSetupAutoPiPInMainWorld(sender) {
        return executeMainWorld(chromeApi, sender, iqiyiSetupAutoPiPInMainWorld);
      },
      forceExitPiPInMainWorld(sender) {
        return executeMainWorld(chromeApi, sender, forceExitPiPInMainWorld);
      },
      youtubeForceExitPiPInMainWorld(sender) {
        return executeMainWorld(chromeApi, sender, youtubeForceExitPiPInMainWorld);
      }
    };
  }

  return Object.freeze({
    create,
    executeMainWorld,
    siteTryEnterPiPInMainWorld,
    iqiyiTryEnterPiPInMainWorld,
    iqiyiSetupAutoPiPInMainWorld,
    forceExitPiPInMainWorld,
    youtubeForceExitPiPInMainWorld
  });
});
