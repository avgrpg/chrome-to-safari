(function(root, factory) {
  const api = factory(root);
  root.LumnoOverlayFaviconView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  function noop() {}

  function createOverlayFaviconViewRuntime(options) {
    const config = options || {};
    const doc = config.document || (typeof document !== 'undefined' ? document : null);
    const win = config.windowObj || (typeof window !== 'undefined' ? window : {});
    const chromeApi = config.chromeApi || (typeof chrome !== 'undefined' ? chrome : {});
    const getRiSvg = typeof config.getRiSvg === 'function' ? config.getRiSvg : (() => '');
    const getHostFromUrl = typeof config.getHostFromUrl === 'function' ? config.getHostFromUrl : (() => '');
    const getExtensionFaviconUrl = typeof config.getExtensionFaviconUrl === 'function' ? config.getExtensionFaviconUrl : (() => '');
    const getGstaticFaviconUrl = typeof config.getGstaticFaviconUrl === 'function' ? config.getGstaticFaviconUrl : (() => '');
    const getChromeFaviconUrl = typeof config.getChromeFaviconUrl === 'function' ? config.getChromeFaviconUrl : (() => '');
    const shouldBlockFaviconForHost = typeof config.shouldBlockFaviconForHost === 'function' ? config.shouldBlockFaviconForHost : (() => false);
    const shouldAvoidDirectFaviconForHost = typeof config.shouldAvoidDirectFaviconForHost === 'function'
      ? config.shouldAvoidDirectFaviconForHost
      : (() => false);
    const shouldBlockOverlayFaviconForHost = typeof config.shouldBlockOverlayFaviconForHost === 'function'
      ? config.shouldBlockOverlayFaviconForHost
      : shouldBlockFaviconForHost;
    const isEnhancedFaviconFetchEnabled = typeof config.isEnhancedFaviconFetchEnabled === 'function'
      ? config.isEnhancedFaviconFetchEnabled
      : (() => true);
    const getStrictFaviconReason = typeof config.getStrictFaviconReason === 'function'
      ? config.getStrictFaviconReason
      : (() => '');
    const logFaviconDecision = typeof config.logFaviconDecision === 'function'
      ? config.logFaviconDecision
      : noop;
    const isFaviconProxyUrl = typeof config.isFaviconProxyUrl === 'function' ? config.isFaviconProxyUrl : (() => false);
    const isBlockedLocalFaviconUrl = typeof config.isBlockedLocalFaviconUrl === 'function'
      ? config.isBlockedLocalFaviconUrl
      : (() => false);
    const isChromeMonogramFaviconUrl = typeof config.isChromeMonogramFaviconUrl === 'function'
      ? config.isChromeMonogramFaviconUrl
      : ((url) => /^chrome:\/\/favicon2\//i.test(String(url || '').trim()));
    const preloadThemeFromFavicon = typeof config.preloadThemeFromFavicon === 'function' ? config.preloadThemeFromFavicon : noop;
    const hasThemeForHost = typeof config.hasThemeForHost === 'function' ? config.hasThemeForHost : (() => false);
    const getOverlayPanel = typeof config.getOverlayPanel === 'function' ? config.getOverlayPanel : (() => null);
    const getSuggestionRowsRoot = typeof config.getSuggestionRowsRoot === 'function'
      ? config.getSuggestionRowsRoot
      : (() => null);
    const rerenderReplacedFaviconRows = typeof config.rerenderReplacedFaviconRows === 'function'
      ? config.rerenderReplacedFaviconRows
      : (() => false);
    const setPersistedFaviconUrl = typeof config.setPersistedFaviconUrl === 'function'
      ? config.setPersistedFaviconUrl
      : noop;
    const setPersistedFaviconData = typeof config.setPersistedFaviconData === 'function'
      ? config.setPersistedFaviconData
      : noop;
    const requestFaviconDataFromBackground = typeof config.requestFaviconData === 'function'
      ? config.requestFaviconData
      : null;
    const faviconDataCache = config.faviconDataCache || new Map();
    const faviconDataPending = config.faviconDataPending || new Map();
    const iconPreloadCache = config.iconPreloadCache || new Map();
    const faviconFallbackNodeMap = config.faviconFallbackNodeMap || new WeakMap();
    const setTimer = typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout;
    const clearTimer = typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout;
    const faviconCandidateLoadTimeoutMs = Number.isFinite(config.faviconCandidateLoadTimeoutMs)
      ? Math.max(0, config.faviconCandidateLoadTimeoutMs)
      : 2600;
    const faviconUtils = root.LumnoFaviconUtils || {};
    function isSourceAllowedByEnhancedFetchPolicy(url, pageUrl) {
      if (typeof faviconUtils.isFaviconSourceAllowedByEnhancedFetchPolicy === 'function') {
        return faviconUtils.isFaviconSourceAllowedByEnhancedFetchPolicy(
          url,
          isEnhancedFaviconFetchEnabled(pageUrl || url),
          { chromeApi }
        );
      }
      return isEnhancedFaviconFetchEnabled(pageUrl || url) === true ||
        String(url || '').startsWith('data:') ||
        /^chrome-extension:\/\/[^/]+\/_favicon\//i.test(String(url || '').trim()) ||
        isChromeMonogramFaviconUrl(url);
    }
    const faviconUrlResolver = typeof faviconUtils.createFaviconUrlResolver === 'function'
      ? faviconUtils.createFaviconUrlResolver({
        chromeApi,
        size: 128,
        getExtensionFaviconUrl,
        getGstaticFaviconUrl,
        getChromeFaviconUrl,
        shouldBlockFaviconForHost: shouldBlockOverlayFaviconForHost,
        shouldAvoidDirectFaviconForHost,
        isBlockedLocalFaviconUrl,
        isEnhancedFaviconFetchEnabled,
        getStrictFaviconReason,
        logFaviconDecision
      })
      : null;
    const faviconViewCoreApi = root.LumnoFaviconViewCore || {};
    const faviconViewCore = typeof faviconViewCoreApi.createFaviconViewCore === 'function'
      ? faviconViewCoreApi.createFaviconViewCore({
        document: doc,
        windowObj: win,
        chromeApi,
        getHostFromUrl,
        shouldBlockFaviconForHost: shouldBlockOverlayFaviconForHost,
        isBlockedLocalFaviconUrl: isBlockedOverlayFaviconUrl,
        showResolvedFavicon,
        showPendingFallbackIcon,
        getPersistCacheKey: (img) => img.getAttribute('data-x-ov-favicon-cache-key') || '',
        setPersistedFaviconUrl,
        setPersistedFaviconData,
        shouldPersistFaviconUrl: (url) => !isChromeMonogramFaviconUrl(url) && !isFaviconProxyUrl(url),
        requestFaviconData: config.requestFaviconData,
        preloadThemeFromFavicon,
        getThemeFaviconUrl: getGstaticFaviconUrl,
        hasThemeForHost,
        faviconDataCache,
        faviconDataPending,
        iconPreloadCache,
        detectDefaultExtensionFavicon: config.detectDefaultExtensionFavicon
      })
      : null;

    function setFaviconLoadState(img, state) {
      faviconViewCore.setFaviconLoadState(img, state);
    }

    function setFaviconVisibility(img, visibility) {
      if (!img) {
        return;
      }
      if (visibility) {
        img.setAttribute('data-favicon-visibility', visibility);
      } else {
        img.removeAttribute('data-favicon-visibility');
      }
    }

    function setFallbackNodeVisible(node, visible) {
      faviconViewCore.setFallbackNodeVisible(node, visible);
    }

    function findFallbackIconNode(img) {
      if (!img || !img.parentElement) {
        return null;
      }
      const mappedNode = faviconFallbackNodeMap.get(img);
      if (mappedNode && mappedNode.isConnected && mappedNode.parentElement === img.parentElement) {
        return mappedNode;
      }
      const fallbackNodes = Array.from(img.parentElement.querySelectorAll('._x_extension_overlay_favicon_fallback_2026_unique_'));
      const linkedNode = fallbackNodes.find((candidate) => candidate && candidate._xFallbackForImage === img) || null;
      if (linkedNode) {
        faviconFallbackNodeMap.set(img, linkedNode);
        return linkedNode;
      }
      if (fallbackNodes.length === 1 && img.parentElement.querySelectorAll('img').length === 1) {
        const onlyNode = fallbackNodes[0];
        onlyNode._xFallbackForImage = img;
        faviconFallbackNodeMap.set(img, onlyNode);
        return onlyNode;
      }
      return null;
    }

    function ensureFallbackIconNode(img) {
      if (!img || !img.parentElement || !doc) {
        return null;
      }
      const existingNode = findFallbackIconNode(img);
      if (existingNode) {
        return existingNode;
      }
      const node = doc.createElement('span');
      node.className = 'x-ov-suggestion-inline-icon x-ov-suggestion-favicon-fallback _x_extension_overlay_favicon_fallback_2026_unique_';
      node.innerHTML = getRiSvg('ri-link', 'ri-size-16');
      setFallbackNodeVisible(node, true);
      img.parentElement.insertBefore(node, img.nextSibling);
      node._xFallbackForImage = img;
      faviconFallbackNodeMap.set(img, node);
      return node;
    }

    function removeFallbackIconNode(img) {
      const node = findFallbackIconNode(img);
      if (node && node.parentNode) {
        node.parentNode.removeChild(node);
      }
      if (img) {
        faviconFallbackNodeMap.delete(img);
      }
    }

    function showResolvedFavicon(img) {
      if (!img) {
        return;
      }
      clearOverlayCandidateLoadTimer(img);
      const fallbackNode = findFallbackIconNode(img);
      if (fallbackNode) {
        setFallbackNodeVisible(fallbackNode, false);
      }
      img.removeAttribute('data-fallback-icon');
      img.removeAttribute('data-favicon-placeholder');
      setFaviconVisibility(img, 'visible');
    }

    function showPendingFallbackIcon(img) {
      if (!img) {
        return;
      }
      const node = ensureFallbackIconNode(img);
      img.removeAttribute('data-fallback-icon');
      img.setAttribute('data-favicon-placeholder', 'true');
      setFaviconVisibility(img, 'hidden');
      if (node) {
        setFallbackNodeVisible(node, true);
        return;
      }
      if (win && typeof win.setTimeout === 'function') {
        win.setTimeout(() => {
          if (!img || !img.isConnected || img.getAttribute('data-favicon-placeholder') !== 'true') {
            return;
          }
          const delayedNode = ensureFallbackIconNode(img);
          if (delayedNode) {
            setFallbackNodeVisible(delayedNode, true);
          }
        }, 0);
      }
    }

    function applyFallbackIcon(img) {
      if (!img) {
        return;
      }
      clearOverlayCandidateLoadTimer(img);
      const node = ensureFallbackIconNode(img);
      img.removeAttribute('data-favicon-placeholder');
      img.setAttribute('data-fallback-icon', 'true');
      setFaviconVisibility(img, 'hidden');
      if (node) {
        setFallbackNodeVisible(node, true);
        return;
      }
      if (win && typeof win.setTimeout === 'function') {
        win.setTimeout(() => {
          if (!img || !img.isConnected || img.getAttribute('data-fallback-icon') !== 'true') {
            return;
          }
          const delayedNode = ensureFallbackIconNode(img);
          if (delayedNode) {
            setFallbackNodeVisible(delayedNode, true);
          }
        }, 0);
      }
    }

    function applyFaviconOpticalShift(img) {
      faviconViewCore.applyFaviconOpticalShift(img);
    }

    function applyFaviconOpticalAlignment(img) {
      faviconViewCore.applyFaviconOpticalAlignment(img);
    }

    function getSafeOverlayFaviconCandidateUrl(value, pageUrl, candidateKind) {
      return faviconUrlResolver
        ? faviconUrlResolver.getSafeFaviconCandidateUrl(value, pageUrl, candidateKind)
        : '';
    }

    function isBrowserInternalPageUrl(url) {
      return faviconUrlResolver ? faviconUrlResolver.isBrowserInternalPageUrl(url) : false;
    }

    function isBlockedOverlayFaviconPageUrl(url) {
      return faviconUrlResolver ? faviconUrlResolver.isBlockedFaviconPageUrl(url) : false;
    }

    function isBlockedOverlayFaviconUrl(url) {
      return faviconUrlResolver ? faviconUrlResolver.isBlockedFaviconUrl(url) : false;
    }

    function getRuntimeExtensionFaviconUrl(pageUrl) {
      return getSafeOverlayFaviconCandidateUrl(getRuntimeExtensionFaviconDataSourceUrl(pageUrl));
    }

    function getRuntimeExtensionFaviconDataSourceUrl(pageUrl) {
      if (!faviconUrlResolver) {
        return '';
      }
      return isBrowserInternalPageUrl(pageUrl)
        ? faviconUrlResolver.getBrowserPageFaviconUrl(pageUrl)
        : faviconUrlResolver.getExtensionFaviconUrl(pageUrl);
    }

    function getRuntimeGstaticFaviconUrl(pageUrl) {
      return getSafeOverlayFaviconCandidateUrl(getRuntimeGstaticFaviconDataSourceUrl(pageUrl));
    }

    function getRuntimeGstaticFaviconDataSourceUrl(pageUrl) {
      return isEnhancedFaviconFetchEnabled(pageUrl) === true && faviconUrlResolver
        ? faviconUrlResolver.getGstaticFaviconUrl(pageUrl)
        : '';
    }

    function getRuntimeChromeFaviconUrl(pageUrl) {
      return faviconUrlResolver ? faviconUrlResolver.getChromeFaviconUrl(pageUrl) : '';
    }

    function requestFaviconData(url, pageUrl) {
      if (!isSourceAllowedByEnhancedFetchPolicy(url, pageUrl)) {
        return Promise.resolve(null);
      }
      return faviconViewCore.requestFaviconData(url, pageUrl);
    }

    function requestFaviconDataBypassingOverlayBlock(url, pageUrl) {
      const sourceUrl = String(url || '').trim();
      if (!sourceUrl) {
        return Promise.resolve(null);
      }
      if (!isSourceAllowedByEnhancedFetchPolicy(sourceUrl, pageUrl)) {
        return Promise.resolve(null);
      }
      if (sourceUrl.startsWith('data:')) {
        return Promise.resolve(sourceUrl);
      }
      if (!isBlockedOverlayFaviconUrl(sourceUrl)) {
        return requestFaviconData(sourceUrl);
      }
      if (faviconDataCache.has(sourceUrl)) {
        return Promise.resolve(faviconDataCache.get(sourceUrl));
      }
      if (faviconDataPending.has(sourceUrl)) {
        return faviconDataPending.get(sourceUrl);
      }
      const promise = new Promise((resolve) => {
        const finish = (dataUrl) => {
          const value = String(dataUrl || '').trim();
          if (value && value.startsWith('data:')) {
            if (faviconViewCore && typeof faviconViewCore.cacheFaviconData === 'function') {
              faviconViewCore.cacheFaviconData(sourceUrl, value);
            } else if (typeof faviconUtils.setBoundedCacheEntry === 'function') {
              faviconUtils.setBoundedCacheEntry(faviconDataCache, sourceUrl, value, 256);
            } else {
              faviconDataCache.set(sourceUrl, value);
            }
            resolve(value);
            return;
          }
          resolve(null);
        };
        if (requestFaviconDataFromBackground) {
          Promise.resolve(requestFaviconDataFromBackground(sourceUrl, pageUrl))
            .then(finish)
            .catch(() => finish(''));
          return;
        }
        if (!chromeApi.runtime || typeof chromeApi.runtime.sendMessage !== 'function') {
          finish('');
          return;
        }
        chromeApi.runtime.sendMessage({
          action: 'getFaviconData',
          url: sourceUrl,
          pageUrl: pageUrl || ''
        }, (response) => {
          finish(response && response.data ? response.data : '');
        });
      }).then((dataUrl) => {
        faviconDataPending.delete(sourceUrl);
        return dataUrl || null;
      }).catch(() => {
        faviconDataPending.delete(sourceUrl);
        return null;
      });
      faviconDataPending.set(sourceUrl, promise);
      return promise;
    }

    function setFaviconSrcWithAnimation(img, nextSrc, optionsArg) {
      return faviconViewCore.setFaviconSrcWithAnimation(img, nextSrc, optionsArg);
    }

    function canReuseCurrentFavicon(img, nextSrc) {
      return faviconViewCore.canReuseCurrentFavicon(img, nextSrc);
    }

    function getLastWorkingFaviconSrc(img) {
      return faviconViewCore.getLastWorkingFaviconSrc(img);
    }

    function restoreWorkingFaviconOrFail(img, previousSrc, onFailed) {
      return faviconViewCore.restoreWorkingFaviconOrFallback(img, previousSrc, {
        removeFallbackNode: removeFallbackIconNode,
        onFailed,
        applyFallbackIcon
      });
    }

    function createOverlayThemeAwareFaviconState(img, pageUrl, hostKey, fallbackUrl, onFailed) {
      img._xOverlayThemeFaviconSession = (img._xOverlayThemeFaviconSession || 0) + 1;
      const session = img._xOverlayThemeFaviconSession;
      const normalizedHostKey = hostKey || getHostFromUrl(pageUrl);
      const rawFallbackUrl = String(fallbackUrl || '').trim();
      const cachedFallbackData = faviconDataCache.get(rawFallbackUrl);
      const safeFallbackUrl = getSafeOverlayFaviconCandidateUrl(rawFallbackUrl, pageUrl, 'primary') ||
        getSafeOverlayFaviconCandidateUrl(cachedFallbackData, pageUrl, 'cached-data');

      return {
        pageUrl: String(pageUrl || ''),
        hostKey: String(normalizedHostKey || ''),
        rawFallbackUrl,
        fallbackUrl: safeFallbackUrl,
        primaryUrl: safeFallbackUrl,
        extensionFavicon: getRuntimeExtensionFaviconUrl(pageUrl),
        browserUrl: /^https?:\/\//i.test(String(pageUrl || '')) ? '' : getRuntimeChromeFaviconUrl(pageUrl),
        gstaticFavicon: getRuntimeGstaticFaviconUrl(pageUrl),
        previousWorkingSrc: getSafeOverlayFaviconCandidateUrl(
          getLastWorkingFaviconSrc(img),
          pageUrl,
          'previous'
        ),
        hasFailedHandler: typeof onFailed === 'function',
        handleFailed: typeof onFailed === 'function' ? onFailed : function() {},
        isSessionCurrent() {
          return Boolean(img && img._xOverlayThemeFaviconSession === session);
        },
        isSessionMounted() {
          return Boolean(img && img.isConnected && img._xOverlayThemeFaviconSession === session);
        }
      };
    }

    function getRootFaviconDataSourceUrls(pageUrl) {
      if (!isEnhancedFaviconFetchEnabled(pageUrl)) {
        return [];
      }
      try {
        const parsed = new URL(String(pageUrl || ''));
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return [];
        }
        return [
          '/favicon.ico',
          '/favicon.svg',
          '/favicon.png',
          '/apple-touch-icon.png'
        ].map((pathname) => new URL(pathname, parsed.origin).toString());
      } catch (e) {
        return [];
      }
    }

    function buildBlockedOverlayFaviconDataSourcePlan(state) {
      const unique = [];
      const seen = new Set();
      [
        state.rawFallbackUrl,
        getRuntimeExtensionFaviconDataSourceUrl(state.pageUrl),
        ...getRootFaviconDataSourceUrls(state.pageUrl)
      ].forEach((url) => {
        const value = String(url || '').trim();
        if (!value || seen.has(value) || !isSourceAllowedByEnhancedFetchPolicy(value, state.pageUrl)) {
          return;
        }
        seen.add(value);
        unique.push(value);
      });
      return unique;
    }

    function attachBlockedOverlayFaviconData(img, state) {
      const candidates = buildBlockedOverlayFaviconDataSourcePlan(state);
      if (candidates.length === 0) {
        finalizeOverlayOwnedFaviconFailure(img, state);
        return;
      }
      showPendingFallbackIcon(img);
      let index = 0;
      const tryNext = () => {
        if (!img || !state.isSessionCurrent()) {
          return;
        }
        const sourceUrl = candidates[index];
        index += 1;
        if (!sourceUrl) {
          finalizeOverlayOwnedFaviconFailure(img, state);
          return;
        }
        requestFaviconDataBypassingOverlayBlock(sourceUrl, state.pageUrl).then((dataUrl) => {
          if (!img || !state.isSessionCurrent()) {
            return;
          }
          if (!dataUrl) {
            tryNext();
            return;
          }
          const applied = setFaviconSrcWithAnimation(img, dataUrl, {
            sourceUrl,
            persist: false
          });
          if (!applied && canReuseCurrentFavicon(img, dataUrl)) {
            showResolvedFavicon(img);
          }
          preloadThemeFromFavicon(sourceUrl, dataUrl, state.hostKey);
        }).catch(() => {
          if (img && state.isSessionCurrent()) {
            tryNext();
          }
        });
      };
      tryNext();
    }

    function syncOverlayThemeAwareFaviconAttributes(img, state) {
      img.setAttribute('data-x-ov-theme-favicon', '1');
      img.setAttribute('data-x-ov-favicon-page-url', state.pageUrl);
      img.setAttribute('data-x-ov-favicon-host', state.hostKey);
      img.setAttribute('data-x-ov-favicon-fallback-url', state.rawFallbackUrl);
      img.removeAttribute('data-x-ov-favicon-cache-key');
    }

    function buildOverlayThemeAwareFaviconCandidatePlan(state) {
      return faviconUrlResolver ? faviconUrlResolver.buildFaviconCandidatePlan(state) : [];
    }

    function clearOverlayCandidateLoadTimer(img) {
      if (!img || img._xOverlayThemeFaviconLoadTimer === null || img._xOverlayThemeFaviconLoadTimer === undefined) {
        return;
      }
      clearTimer(img._xOverlayThemeFaviconLoadTimer);
      img._xOverlayThemeFaviconLoadTimer = null;
    }

    function isOverlayCandidateLoaded(img, nextUrl) {
      if (!img || !nextUrl) {
        return false;
      }
      const resolvedSrc = img.getAttribute('data-favicon-current-src') || '';
      if (resolvedSrc === nextUrl) {
        return true;
      }
      return Boolean(img.complete && img.naturalWidth > 0);
    }

    function scheduleOverlayCandidateLoadTimer(img, state, nextUrl) {
      if (!img || !state || !nextUrl || faviconCandidateLoadTimeoutMs <= 0) {
        return;
      }
      clearOverlayCandidateLoadTimer(img);
      const expectedToken = img._xFaviconLoadToken || 0;
      const expectedSrc = String(nextUrl);
      img._xOverlayThemeFaviconLoadTimer = setTimer(() => {
        img._xOverlayThemeFaviconLoadTimer = null;
        if (!img || !state.isSessionCurrent()) {
          return;
        }
        if ((img._xFaviconLoadToken || 0) !== expectedToken) {
          return;
        }
        const currentRenderedSrc = String(img.getAttribute('src') || img.src || '');
        if (currentRenderedSrc && currentRenderedSrc !== expectedSrc) {
          return;
        }
        if (isOverlayCandidateLoaded(img, expectedSrc)) {
          return;
        }
        if (typeof img._xOverlayThemeFaviconErrorHandler === 'function') {
          img._xOverlayThemeFaviconErrorHandler();
        }
      }, faviconCandidateLoadTimeoutMs);
    }

    function tryApplyOverlayThemeAwareFaviconCandidate(img, state, tried, candidate) {
      const nextUrl = candidate && candidate.url ? String(candidate.url) : '';
      if (!nextUrl || !img || !state.isSessionCurrent()) {
        return false;
      }
      if (tried.has(nextUrl)) {
        return false;
      }
      tried.add(nextUrl);
      clearOverlayCandidateLoadTimer(img);

      const faviconProxyCheckKind = faviconUrlResolver
        ? faviconUrlResolver.getFaviconProxyCheckKind(candidate)
        : '';
      const shouldCheckDefaultProxy = Boolean(faviconProxyCheckKind);
      let defaultProxyCheckStarted = false;
      const scheduleDefaultProxyFaviconCheck = () => {
        if (!shouldCheckDefaultProxy) {
          return;
        }
        if (defaultProxyCheckStarted) {
          return;
        }
        defaultProxyCheckStarted = true;
        setTimer(() => {
          if (!img || !state.isSessionCurrent()) {
            return;
          }
          const currentSrc = img.getAttribute('data-favicon-current-src') || img.src || '';
          if (currentSrc !== nextUrl) {
            return;
          }
          const defaultCheckPromise = faviconProxyCheckKind === 'extension'
            ? faviconViewCore.detectDefaultExtensionFavicon(img, nextUrl)
            : faviconViewCore.requestFaviconData(nextUrl, state.pageUrl).then((dataUrl) => !dataUrl);
          defaultCheckPromise.catch(() => false).then((isDefault) => {
            if (!img || !state.isSessionCurrent()) {
              return;
            }
            const latestSrc = img.getAttribute('data-favicon-current-src') || img.src || '';
            if (latestSrc !== nextUrl) {
              return;
            }
            if (isDefault) {
              if (faviconProxyCheckKind === 'gstatic') {
                finalizeOverlayDefaultProxyFaviconFailure(img, state);
                return;
              }
              if (typeof img._xOverlayThemeFaviconErrorHandler === 'function') {
                img._xOverlayThemeFaviconErrorHandler();
              }
              return;
            }
            showResolvedFavicon(img);
          });
        }, 0);
      };
      const handleProxyLoad = () => {
        scheduleDefaultProxyFaviconCheck();
      };
      if (shouldCheckDefaultProxy) {
        img.addEventListener('load', handleProxyLoad, { once: true });
      }
      const applied = setFaviconSrcWithAnimation(img, nextUrl, {
        persist: false,
        deferResolve: shouldCheckDefaultProxy
      });
      const reused = !applied && canReuseCurrentFavicon(img, nextUrl);
      if (!applied && !reused) {
        img.removeEventListener('load', handleProxyLoad);
        return false;
      }
      if (reused) {
        img.removeEventListener('load', handleProxyLoad);
        if (shouldCheckDefaultProxy) {
          showPendingFallbackIcon(img);
          scheduleDefaultProxyFaviconCheck();
        } else {
          showResolvedFavicon(img);
        }
      } else {
        if (!shouldCheckDefaultProxy) {
          setFaviconVisibility(img, 'visible');
        }
        scheduleOverlayCandidateLoadTimer(img, state, nextUrl);
        if (shouldCheckDefaultProxy && img.complete && img.naturalWidth > 0) {
          scheduleDefaultProxyFaviconCheck();
        }
      }
      return true;
    }

    function finalizeOverlayOwnedFaviconFailure(img, state) {
      clearOverlayCandidateLoadTimer(img);
      if (state.hasFailedHandler) {
        removeFallbackIconNode(img);
        state.handleFailed();
        return;
      }
      applyFallbackIcon(img);
    }

    function finalizeOverlayDefaultProxyFaviconFailure(img, state) {
      finalizeOverlayOwnedFaviconFailure(img, state);
    }

    function finalizeOverlayThemeAwareFaviconFailure(img, state) {
      clearOverlayCandidateLoadTimer(img);
      restoreWorkingFaviconOrFail(img, state.previousWorkingSrc, state.handleFailed);
    }

    function attachResolvedFaviconWithFallbacks(img, pageUrl, hostKey, fallbackUrl, onFailed) {
      if (!img) {
        return;
      }
      if (img._xOverlayThemeFaviconErrorHandler) {
        img.removeEventListener('error', img._xOverlayThemeFaviconErrorHandler);
        img._xOverlayThemeFaviconErrorHandler = null;
      }
      clearOverlayCandidateLoadTimer(img);

      const state = createOverlayThemeAwareFaviconState(img, pageUrl, hostKey, fallbackUrl, onFailed);
      if (state.hostKey &&
          shouldBlockOverlayFaviconForHost(state.hostKey) &&
          !isBrowserInternalPageUrl(state.pageUrl)) {
        syncOverlayThemeAwareFaviconAttributes(img, state);
        attachBlockedOverlayFaviconData(img, state);
        return;
      }
      syncOverlayThemeAwareFaviconAttributes(img, state);
      const candidates = buildOverlayThemeAwareFaviconCandidatePlan(state);
      const tried = new Set();
      let candidateIndex = 0;

      const tryNextAvailableCandidate = () => {
        while (candidateIndex < candidates.length) {
          const candidate = candidates[candidateIndex];
          candidateIndex += 1;
          if (tryApplyOverlayThemeAwareFaviconCandidate(img, state, tried, candidate)) {
            return true;
          }
        }
        return false;
      };

      const handleImageError = () => {
        if (!state.isSessionCurrent()) {
          return;
        }
        if (tryNextAvailableCandidate()) {
          return;
        }
        finalizeOverlayThemeAwareFaviconFailure(img, state);
      };

      img._xOverlayThemeFaviconErrorHandler = handleImageError;
      img.addEventListener('error', handleImageError);

      const appliedInitial = tryNextAvailableCandidate();
      if (!appliedInitial) {
        finalizeOverlayThemeAwareFaviconFailure(img, state);
      }
    }

    function refreshOverlayThemeAwareFavicons(optionsArg) {
      const overlay = getOverlayPanel();
      if (!overlay) {
        return;
      }
      const skipWithin = optionsArg && optionsArg.skipWithin ? optionsArg.skipWithin : null;
      overlay.querySelectorAll('img[data-x-ov-theme-favicon="1"]').forEach((img) => {
        if (!img || !img.isConnected) {
          return;
        }
        if (skipWithin && typeof skipWithin.contains === 'function' && skipWithin.contains(img)) {
          return;
        }
        const pageUrl = img.getAttribute('data-x-ov-favicon-page-url') || '';
        if (!pageUrl) {
          return;
        }
        const hostKey = img.getAttribute('data-x-ov-favicon-host') || '';
        const fallbackUrl = img.getAttribute('data-x-ov-favicon-fallback-url') || '';
        attachResolvedFaviconWithFallbacks(img, pageUrl, hostKey, fallbackUrl);
      });
    }

    function refreshOverlayFaviconsForPolicyChange() {
      let rowsRerendered = false;
      try {
        rowsRerendered = rerenderReplacedFaviconRows() === true;
      } catch (e) {
        rowsRerendered = false;
      }
      refreshOverlayThemeAwareFavicons({
        skipWithin: rowsRerendered ? getSuggestionRowsRoot() : null
      });
      return rowsRerendered;
    }

    function attachFaviconData(img, url, hostOverride, pageUrl) {
      const safeUrl = getSafeOverlayFaviconCandidateUrl(url, pageUrl || url, 'data');
      if (safeUrl) {
        faviconViewCore.attachFaviconData(img, safeUrl, hostOverride, pageUrl || url);
      }
    }

    function preloadIcon(url, pageUrl) {
      if (!isSourceAllowedByEnhancedFetchPolicy(url, pageUrl)) {
        logFaviconDecision(url, getStrictFaviconReason(pageUrl) || 'global-off', {
          pageUrl,
          candidateKind: 'preload'
        });
        return;
      }
      const safeUrl = faviconUrlResolver
        ? faviconUrlResolver.getSafeFaviconCandidateUrl(url, pageUrl, 'preload')
        : getSafeOverlayFaviconCandidateUrl(url);
      if (safeUrl) {
        faviconViewCore.preloadIcon(safeUrl);
      }
    }

    function warmIconCache(list) {
      if (!Array.isArray(list)) {
        return;
      }
      faviconViewCore.warmIconCache(list.map((item) => {
        if (!item || !item.favicon) {
          return item;
        }
        return {
          ...item,
          favicon: getSafeOverlayFaviconCandidateUrl(item.favicon, item.url || '', 'preload')
        };
      }));
    }

    return Object.freeze({
      applyFaviconOpticalShift,
      applyFaviconOpticalAlignment,
      isBlockedLocalFaviconUrl: isBlockedOverlayFaviconUrl,
      isChromeMonogramFaviconUrl,
      requestFaviconData,
      setFaviconSrcWithAnimation,
      attachFaviconData,
      attachResolvedFaviconWithFallbacks,
      refreshOverlayThemeAwareFavicons,
      refreshOverlayFaviconsForPolicyChange,
      preloadIcon,
      warmIconCache
    });
  }

  return Object.freeze({
    createOverlayFaviconViewRuntime
  });
});
