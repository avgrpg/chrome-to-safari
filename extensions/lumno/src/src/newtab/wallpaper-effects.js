(function(root) {
  'use strict';

  const EFFECT_TYPES = ['none', 'grain', 'halftone', 'dither', 'ascii'];
  const EFFECT_INK_TONES = ['auto', 'dark', 'light'];
  const BAYER_4X4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];
  const ASCII_LIGHT_WALLPAPER_THRESHOLD = 0.58;
  const TARGET_EFFECT_CANVAS_PIXELS = 2048 * 2048;
  const MAX_EFFECT_CANVAS_SCALE = 1.6;
  const PARAMETER_RENDER_DEBOUNCE_MS = 72;
  const DEFAULT_PREFS = {
    version: 4,
    type: 'none',
    inkTone: 'auto',
    strength: 50,
    size: 50,
    spacing: 50
  };

  function getOption(options, key, fallback) {
    if (options && Object.prototype.hasOwnProperty.call(options, key)) {
      return options[key];
    }
    return fallback;
  }

  function getFunction(options, key, fallback) {
    const value = getOption(options, key, fallback || function() {});
    return typeof value === 'function' ? value : (fallback || function() {});
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, number));
  }

  function quantizeDitherChannel(value, threshold, levels) {
    const stepCount = Math.max(2, Math.round(Number(levels) || 2));
    const scaled = (clampNumber(value, 0, 255) / 255) * (stepCount - 1);
    const lower = Math.floor(scaled);
    const quantizedIndex = Math.min(
      stepCount - 1,
      lower + ((scaled - lower) > clampNumber(threshold, 0, 1) ? 1 : 0)
    );
    return (quantizedIndex / (stepCount - 1)) * 255;
  }

  function quantizeDitherColor(color, threshold, levels, mix) {
    const source = color || {};
    const blend = clampNumber(mix, 0, 1);
    const quantize = (value) => {
      const channel = clampNumber(value, 0, 255);
      const quantized = quantizeDitherChannel(channel, threshold, levels);
      return Math.round(channel + ((quantized - channel) * blend));
    };
    return {
      red: quantize(source.red),
      green: quantize(source.green),
      blue: quantize(source.blue)
    };
  }

  function liftSampleColor(color, brightness, saturationBoost) {
    const source = color || {};
    const red = clampNumber(source.red, 0, 255) / 255;
    const green = clampNumber(source.green, 0, 255) / 255;
    const blue = clampNumber(source.blue, 0, 255) / 255;
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    const delta = maxChannel - minChannel;
    let hue = 0;
    if (delta > 0) {
      if (maxChannel === red) {
        hue = ((green - blue) / delta) % 6;
      } else if (maxChannel === green) {
        hue = ((blue - red) / delta) + 2;
      } else {
        hue = ((red - green) / delta) + 4;
      }
      hue = ((hue * 60) + 360) % 360;
    }
    const saturation = maxChannel > 0 ? delta / maxChannel : 0;
    const liftedValue = maxChannel + (
      (1 - maxChannel) * clampNumber(brightness, 0, 1)
    );
    const liftedSaturation = clampNumber(
      saturation * (1 + clampNumber(saturationBoost, 0, 1.2)),
      0,
      1
    );
    const chroma = liftedValue * liftedSaturation;
    const hueSector = hue / 60;
    const secondChannel = chroma * (1 - Math.abs((hueSector % 2) - 1));
    let redPrime = 0;
    let greenPrime = 0;
    let bluePrime = 0;
    if (hueSector < 1) {
      redPrime = chroma;
      greenPrime = secondChannel;
    } else if (hueSector < 2) {
      redPrime = secondChannel;
      greenPrime = chroma;
    } else if (hueSector < 3) {
      greenPrime = chroma;
      bluePrime = secondChannel;
    } else if (hueSector < 4) {
      greenPrime = secondChannel;
      bluePrime = chroma;
    } else if (hueSector < 5) {
      redPrime = secondChannel;
      bluePrime = chroma;
    } else {
      redPrime = chroma;
      bluePrime = secondChannel;
    }
    const match = liftedValue - chroma;
    return {
      red: Math.round(clampNumber((redPrime + match) * 255, 0, 255)),
      green: Math.round(clampNumber((greenPrime + match) * 255, 0, 255)),
      blue: Math.round(clampNumber((bluePrime + match) * 255, 0, 255))
    };
  }

  function getEffectCanvasScale(devicePixelRatio, viewportWidth, viewportHeight) {
    const width = Math.max(1, Number(viewportWidth) || 1);
    const height = Math.max(1, Number(viewportHeight) || 1);
    const pixelBudgetScale = Math.sqrt(TARGET_EFFECT_CANVAS_PIXELS / (width * height));
    return clampNumber(
      Math.min(Number(devicePixelRatio) || 1, pixelBudgetScale, MAX_EFFECT_CANVAS_SCALE),
      1,
      MAX_EFFECT_CANVAS_SCALE
    );
  }

  function analyzeImageData(data) {
    if (!data || typeof data.length !== 'number' || data.length < 4) {
      return {
        averageLuminance: 0.5,
        lowLuminance: 0.1,
        highLuminance: 0.9,
        useDarkInk: false
      };
    }
    const pixelCount = Math.floor(data.length / 4);
    const sampleStride = Math.max(1, Math.floor(pixelCount / 12000));
    let luminanceTotal = 0;
    let sampledPixels = 0;
    const luminanceSamples = [];
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStride) {
      const index = pixelIndex * 4;
      const alpha = clampNumber(Number(data[index + 3]) / 255, 0, 1);
      const red = (Number(data[index]) * alpha) + (255 * (1 - alpha));
      const green = (Number(data[index + 1]) * alpha) + (255 * (1 - alpha));
      const blue = (Number(data[index + 2]) * alpha) + (255 * (1 - alpha));
      const luminance = ((red * 0.299) + (green * 0.587) + (blue * 0.114)) / 255;
      luminanceTotal += luminance;
      luminanceSamples.push(luminance);
      sampledPixels += 1;
    }
    const averageLuminance = sampledPixels > 0
      ? clampNumber(luminanceTotal / sampledPixels, 0, 1)
      : 0.5;
    luminanceSamples.sort((first, second) => first - second);
    const lastSampleIndex = Math.max(0, luminanceSamples.length - 1);
    const lowLuminance = luminanceSamples.length > 0
      ? luminanceSamples[Math.round(lastSampleIndex * 0.08)]
      : 0.1;
    const highLuminance = luminanceSamples.length > 0
      ? luminanceSamples[Math.round(lastSampleIndex * 0.92)]
      : 0.9;
    return {
      averageLuminance,
      lowLuminance: clampNumber(lowLuminance, 0, 1),
      highLuminance: clampNumber(highLuminance, 0, 1),
      useDarkInk: averageLuminance >= ASCII_LIGHT_WALLPAPER_THRESHOLD
    };
  }

  function normalizePrefs(value) {
    if (!value || typeof value !== 'object') {
      return Object.assign({}, DEFAULT_PREFS);
    }
    const type = EFFECT_TYPES.indexOf(value.type) === -1 ? DEFAULT_PREFS.type : value.type;
    const inkTone = EFFECT_INK_TONES.indexOf(value.inkTone) === -1
      ? DEFAULT_PREFS.inkTone
      : value.inkTone;
    const rawStrength = Number.isFinite(Number(value.strength))
      ? value.strength
      : DEFAULT_PREFS.strength;
    const rawSize = Number.isFinite(Number(value.size))
      ? value.size
      : (Number.isFinite(Number(value.density)) ? value.density : DEFAULT_PREFS.size);
    const rawSpacing = Number.isFinite(Number(value.spacing))
      ? value.spacing
      : DEFAULT_PREFS.spacing;
    return {
      version: DEFAULT_PREFS.version,
      type,
      inkTone,
      strength: Math.round(clampNumber(rawStrength, 0, 100)),
      size: Math.round(clampNumber(rawSize, 0, 100)),
      spacing: Math.round(clampNumber(rawSpacing, 0, 100))
    };
  }

  function resolveUseDarkInk(inkTone, sampler) {
    if (inkTone === 'dark') {
      return true;
    }
    if (inkTone === 'light') {
      return false;
    }
    return Boolean(sampler && sampler.useDarkInk === true);
  }

  function createWallpaperEffects(options) {
    const documentObj = getOption(options, 'documentObj', root.document);
    const windowObj = getOption(options, 'windowObj', root.window);
    const getCurrentWallpaper = getFunction(options, 'getCurrentWallpaper', function() {
      return null;
    });
    const getWallpaperImageUrl = getFunction(options, 'getWallpaperImageUrl', function() {
      return '';
    });
    const shouldAnimateTransition = getFunction(options, 'shouldAnimateTransition', function() {
      return true;
    });
    const onRender = getFunction(options, 'onRender');
    const EFFECT_CROSSFADE_MS = 150;
    const RESIZE_RENDER_SETTLE_MS = 140;
    const RESIZE_CROSSFADE_MS = 180;
    const ASCII_CHARS = '  .,:;-=+xX08S#&@';

    let canvas = null;
    let context = null;
    let prefs = Object.assign({}, DEFAULT_PREFS);
    let renderFrame = 0;
    let renderTimer = 0;
    let renderToken = 0;
    let loadedImage = null;
    let loadedImageUrl = '';
    let loadedSampler = null;
    let loadedSamplerUrl = '';
    let observer = null;
    let asciiGlyphMetricsCache = null;
    let effectBaseCacheKey = '';
    let resizeTransitionCanvas = null;
    let resizeTransitionFrame = 0;
    let resizeTransitionTimer = 0;
    let shouldCrossfadeResize = false;
    let renderRequestRevision = 0;
    let renderCompletedRevision = 0;
    const renderWaiters = [];

    function requestFrame(callback) {
      if (windowObj && typeof windowObj.requestAnimationFrame === 'function') {
        return windowObj.requestAnimationFrame(callback);
      }
      return setTimeout(callback, 16);
    }

    function cancelFrame(id) {
      if (windowObj && typeof windowObj.cancelAnimationFrame === 'function') {
        windowObj.cancelAnimationFrame(id);
        return;
      }
      clearTimeout(id);
    }

    function shouldReduceMotion() {
      return Boolean(windowObj &&
        typeof windowObj.matchMedia === 'function' &&
        windowObj.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function canAnimateTransition() {
      return shouldAnimateTransition() && !shouldReduceMotion();
    }

    function getViewportSize() {
      const docEl = documentObj.documentElement;
      return {
        width: Math.max(1, windowObj.innerWidth || (docEl ? docEl.clientWidth : 0) || 1),
        height: Math.max(1, windowObj.innerHeight || (docEl ? docEl.clientHeight : 0) || 1)
      };
    }

    function getDeviceScale(viewport) {
      return getEffectCanvasScale(
        windowObj.devicePixelRatio || 1,
        viewport.width,
        viewport.height
      );
    }

    function getLuminanceFromRgb(red, green, blue) {
      return ((red * 0.299) + (green * 0.587) + (blue * 0.114)) / 255;
    }

    function isWallpaperActive() {
      return Boolean(documentObj.body &&
        documentObj.body.getAttribute('data-wallpaper-active') === 'true' &&
        getCurrentWallpaper());
    }

    function ensureCanvas() {
      if (canvas && context) {
        return canvas;
      }
      if (!documentObj || !documentObj.createElement || !documentObj.body) {
        return null;
      }
      canvas = documentObj.createElement('canvas');
      canvas.className = 'x-nt-wallpaper-effect-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      context = canvas.getContext('2d', { alpha: true });
      if (!context) {
        canvas = null;
        return null;
      }
      documentObj.body.insertBefore(canvas, documentObj.body.firstChild || null);
      bindObservers();
      return canvas;
    }

    function bindObservers() {
      if (observer || !root.MutationObserver || !documentObj.body) {
        return;
      }
      observer = new root.MutationObserver((mutations) => {
        const shouldRefresh = mutations.some((mutation) => {
          return mutation.type === 'attributes' &&
            mutation.attributeName === 'data-wallpaper-active';
        });
        if (shouldRefresh) {
          scheduleRender();
        }
      });
      observer.observe(documentObj.body, {
        attributes: true,
        attributeFilter: ['data-wallpaper-active']
      });
    }

    function clearEffectBaseCache() {
      effectBaseCacheKey = '';
    }

    function cleanupResizeCrossfade() {
      if (resizeTransitionFrame) {
        cancelFrame(resizeTransitionFrame);
        resizeTransitionFrame = 0;
      }
      if (resizeTransitionTimer) {
        clearTimeout(resizeTransitionTimer);
        resizeTransitionTimer = 0;
      }
      if (resizeTransitionCanvas && resizeTransitionCanvas.parentNode) {
        resizeTransitionCanvas.parentNode.removeChild(resizeTransitionCanvas);
      }
      resizeTransitionCanvas = null;
      if (canvas) {
        canvas.removeAttribute('data-resize-enter');
        canvas.removeAttribute('data-resize-jump');
      }
    }

    function prepareResizeCrossfade() {
      if (!canvas ||
          !context ||
          shouldReduceMotion() ||
          getCanvasOpacity() <= 0.01) {
        return false;
      }
      cleanupResizeCrossfade();
      const snapshot = documentObj.createElement('canvas');
      const snapshotContext = snapshot.getContext('2d', { alpha: true });
      if (!snapshotContext) {
        return false;
      }
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.className = `${canvas.className} x-nt-wallpaper-effect-resize-snapshot`;
      snapshot.setAttribute('aria-hidden', 'true');
      const effectType = canvas.getAttribute('data-effect');
      if (effectType) {
        snapshot.setAttribute('data-effect', effectType);
      }
      snapshot.style.width = '100vw';
      snapshot.style.height = '100vh';
      snapshot.style.opacity = String(getCanvasOpacity());
      snapshot.style.mixBlendMode = canvas.style.mixBlendMode || 'normal';
      try {
        snapshotContext.drawImage(canvas, 0, 0);
      } catch (error) {
        return false;
      }
      if (!canvas.parentNode) {
        return false;
      }
      canvas.parentNode.insertBefore(snapshot, canvas);
      resizeTransitionCanvas = snapshot;
      canvas.setAttribute('data-resize-enter', 'true');
      canvas.setAttribute('data-resize-jump', 'true');
      void canvas.offsetWidth;
      canvas.removeAttribute('data-resize-jump');
      return true;
    }

    function finishResizeCrossfade() {
      if (!canvas || !resizeTransitionCanvas) {
        return;
      }
      const snapshot = resizeTransitionCanvas;
      resizeTransitionFrame = requestFrame(() => {
        resizeTransitionFrame = 0;
        if (!canvas || resizeTransitionCanvas !== snapshot) {
          return;
        }
        canvas.removeAttribute('data-resize-enter');
        snapshot.setAttribute('data-resize-exit', 'true');
        resizeTransitionTimer = setTimeout(() => {
          resizeTransitionTimer = 0;
          if (resizeTransitionCanvas === snapshot) {
            cleanupResizeCrossfade();
          }
        }, RESIZE_CROSSFADE_MS + 80);
      });
    }

    function resizeCanvas() {
      if (!canvas || !context) {
        return null;
      }
      const viewport = getViewportSize();
      const scale = getDeviceScale(viewport);
      const width = Math.max(1, Math.round(viewport.width * scale));
      const height = Math.max(1, Math.round(viewport.height * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        effectBaseCacheKey = '';
      }
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      return viewport;
    }

    function clearCanvas() {
      renderToken += 1;
      shouldCrossfadeResize = false;
      cleanupResizeCrossfade();
      if (renderFrame) {
        cancelFrame(renderFrame);
        renderFrame = 0;
      }
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = 0;
      }
      clearEffectBaseCache();
      if (canvas && context) {
        const viewport = getViewportSize();
        context.clearRect(0, 0, viewport.width, viewport.height);
        canvas.removeAttribute('data-effect');
        canvas.style.opacity = '0';
        canvas.style.mixBlendMode = 'normal';
      }
      onRender();
    }

    function waitForRenderRevision(revision) {
      if (renderCompletedRevision >= revision) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        renderWaiters.push({ revision, resolve });
      });
    }

    function completeRender(revision) {
      renderCompletedRevision = Math.max(renderCompletedRevision, revision);
      for (let index = renderWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = renderWaiters[index];
        if (waiter.revision > renderCompletedRevision) {
          continue;
        }
        renderWaiters.splice(index, 1);
        waiter.resolve();
      }
    }

    function loadImage(url, token) {
      if (!url) {
        return Promise.resolve(null);
      }
      if (loadedImage && loadedImageUrl === url) {
        return Promise.resolve(loadedImage);
      }
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
          if (token !== renderToken) {
            resolve(null);
            return;
          }
          const resolveLoadedImage = () => {
            loadedImage = image;
            loadedImageUrl = url;
            loadedSampler = null;
            loadedSamplerUrl = '';
            resolve(image);
          };
          if (typeof image.decode === 'function') {
            image.decode().then(resolveLoadedImage).catch(resolveLoadedImage);
            return;
          }
          resolveLoadedImage();
        };
        image.onerror = () => {
          reject(new Error('Failed to load wallpaper effect source.'));
        };
        image.src = url;
      });
    }

    function createSampler(image) {
      if (!image) {
        return null;
      }
      const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
      const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
      const sampleScale = Math.min(1, 520 / naturalWidth, 320 / naturalHeight);
      const sourceCanvas = documentObj.createElement('canvas');
      sourceCanvas.width = Math.max(1, Math.round(naturalWidth * sampleScale));
      sourceCanvas.height = Math.max(1, Math.round(naturalHeight * sampleScale));
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) {
        return null;
      }
      sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
      let data = null;
      try {
        data = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
      } catch (e) {
        return null;
      }
      const analysis = analyzeImageData(data);
      return {
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        naturalWidth,
        naturalHeight,
        scaleX: sourceCanvas.width / naturalWidth,
        scaleY: sourceCanvas.height / naturalHeight,
        averageLuminance: analysis.averageLuminance,
        lowLuminance: analysis.lowLuminance,
        highLuminance: analysis.highLuminance,
        useDarkInk: analysis.useDarkInk,
        data
      };
    }

    function getSampler(image, imageUrl) {
      if (loadedSampler && loadedSamplerUrl === imageUrl) {
        return loadedSampler;
      }
      clearEffectBaseCache();
      loadedSampler = createSampler(image);
      loadedSamplerUrl = loadedSampler ? imageUrl : '';
      return loadedSampler;
    }

    function getRenderedMetrics(sampler, viewport) {
      const scale = Math.max(
        viewport.width / sampler.naturalWidth,
        viewport.height / sampler.naturalHeight
      );
      const renderedWidth = sampler.naturalWidth * scale;
      const renderedHeight = sampler.naturalHeight * scale;
      return {
        scale,
        offsetX: (viewport.width - renderedWidth) / 2,
        offsetY: (viewport.height - renderedHeight) / 2,
        renderedWidth,
        renderedHeight
      };
    }

    function sampleColor(sampler, metrics, viewportX, viewportY) {
      const sourceX = ((viewportX - metrics.offsetX) / metrics.scale) * sampler.scaleX;
      const sourceY = ((viewportY - metrics.offsetY) / metrics.scale) * sampler.scaleY;
      const x = Math.round(clampNumber(sourceX, 0, sampler.width - 1));
      const y = Math.round(clampNumber(sourceY, 0, sampler.height - 1));
      const index = (y * sampler.width + x) * 4;
      const red = sampler.data[index] || 0;
      const green = sampler.data[index + 1] || 0;
      const blue = sampler.data[index + 2] || 0;
      const alpha = (sampler.data[index + 3] || 255) / 255;
      return {
        red: Math.round((red * alpha) + (255 * (1 - alpha))),
        green: Math.round((green * alpha) + (255 * (1 - alpha))),
        blue: Math.round((blue * alpha) + (255 * (1 - alpha)))
      };
    }

    function getLuminance(color) {
      return getLuminanceFromRgb(color.red, color.green, color.blue);
    }

    function clampChannel(value) {
      return Math.round(clampNumber(value, 0, 255));
    }

    function boostSampleColor(color, amount) {
      const boost = 1 + clampNumber(amount, 0, 1.2);
      const luma = ((color.red * 0.299) + (color.green * 0.587) + (color.blue * 0.114));
      return {
        red: clampChannel(luma + ((color.red - luma) * boost)),
        green: clampChannel(luma + ((color.green - luma) * boost)),
        blue: clampChannel(luma + ((color.blue - luma) * boost))
      };
    }

    function getEffectAlpha(base, strength) {
      return clampNumber((strength / 100) * base, 0, 1);
    }

    function smoothstep(value) {
      const x = clampNumber(value, 0, 1);
      return x * x * (3 - (2 * x));
    }

    function applyToneCurve(tone, strength) {
      const amount = clampNumber(strength, 0, 100) / 100;
      const blackPoint = amount * 0.22;
      const whitePoint = 1 - (amount * 0.08);
      const leveled = clampNumber((tone - blackPoint) / Math.max(0.01, whitePoint - blackPoint), 0, 1);
      const curved = smoothstep(leveled);
      return (leveled * (1 - amount)) + (curved * amount);
    }

    function getLayerEffectTone(luminance, sampler, strength, useDarkInk) {
      const useLightInk = useDarkInk !== true;
      const rawTone = useLightInk ? luminance : (1 - luminance);
      const low = clampNumber(sampler.lowLuminance, 0, 1);
      const high = clampNumber(sampler.highLuminance, 0, 1);
      const range = high - low;
      if (range < 0.025) {
        return applyToneCurve(rawTone, strength);
      }
      const normalizedTone = useLightInk
        ? clampNumber((luminance - low) / range, 0, 1)
        : clampNumber((high - luminance) / range, 0, 1);
      const contrastMix = 0.72 + ((clampNumber(strength, 0, 100) / 100) * 0.14);
      return applyToneCurve(
        (rawTone * (1 - contrastMix)) + (normalizedTone * contrastMix),
        strength
      );
    }

    function getControlRange(value, minValue, maxValue) {
      const ratio = clampNumber(value, 0, 100) / 100;
      return minValue + ((maxValue - minValue) * ratio);
    }

    function getAsciiGlyphMetrics(fontSize, font, targetContext) {
      if (asciiGlyphMetricsCache &&
          asciiGlyphMetricsCache.fontSize === fontSize &&
          asciiGlyphMetricsCache.font === font) {
        return asciiGlyphMetricsCache;
      }
      const glyphWidth = ASCII_CHARS.split('').reduce((maxWidth, char) => {
        if (char === ' ') {
          return maxWidth;
        }
        const metrics = targetContext.measureText(char);
        return Math.max(maxWidth, metrics.width || 0);
      }, fontSize * 0.62);
      const glyphMetrics = targetContext.measureText('@');
      const glyphHeight = (glyphMetrics.actualBoundingBoxAscent || 0) +
        (glyphMetrics.actualBoundingBoxDescent || 0);
      asciiGlyphMetricsCache = {
        fontSize,
        font,
        glyphWidth,
        glyphHeight
      };
      return asciiGlyphMetricsCache;
    }

    function getOverlayBlendLuminance(baseLuminance, effectLuminance) {
      const base = clampNumber(baseLuminance, 0, 1);
      const source = clampNumber(effectLuminance, 0, 1);
      if (base <= 0.5) {
        return 2 * base * source;
      }
      return 1 - (2 * (1 - base) * (1 - source));
    }

    function setCanvasVisuals(type, opacity, blendMode) {
      if (!canvas) {
        return;
      }
      canvas.setAttribute('data-effect', type);
      canvas.style.opacity = String(clampNumber(opacity, 0, 1));
      canvas.style.mixBlendMode = blendMode || 'normal';
      onRender();
      finishResizeCrossfade();
    }

    function getCanvasOpacity() {
      if (!canvas) {
        return 0;
      }
      const opacity = Number.parseFloat(canvas.style.opacity || '1');
      return clampNumber(Number.isFinite(opacity) ? opacity : 1, 0, 1);
    }

    function getLuminanceAtViewport(viewportX, viewportY, baseLuminance) {
      const normalized = normalizePrefs(prefs);
      if (!canvas ||
          !context ||
          !isWallpaperActive() ||
          normalized.type === 'none' ||
          canvas.style.opacity === '0') {
        return null;
      }
      const viewport = getViewportSize();
      const x = Math.round(clampNumber(viewportX, 0, viewport.width) * (canvas.width / viewport.width));
      const y = Math.round(clampNumber(viewportY, 0, viewport.height) * (canvas.height / viewport.height));
      let pixel = null;
      try {
        pixel = context.getImageData(
          clampNumber(x, 0, canvas.width - 1),
          clampNumber(y, 0, canvas.height - 1),
          1,
          1
        ).data;
      } catch (e) {
        return null;
      }
      const canvasAlpha = (pixel[3] / 255) * getCanvasOpacity();
      const effectLuminance = getLuminanceFromRgb(pixel[0], pixel[1], pixel[2]);
      if (normalized.type === 'grain') {
        if (!Number.isFinite(baseLuminance)) {
          return null;
        }
        const blended = getOverlayBlendLuminance(baseLuminance, effectLuminance);
        return (baseLuminance * (1 - canvasAlpha)) + (blended * canvasAlpha);
      }
      if (!Number.isFinite(baseLuminance)) {
        return null;
      }
      return (baseLuminance * (1 - canvasAlpha)) + (effectLuminance * canvasAlpha);
    }

    function drawGrain(viewport, strength) {
      context.clearRect(0, 0, viewport.width, viewport.height);
      const tile = documentObj.createElement('canvas');
      tile.width = 180;
      tile.height = 180;
      const tileContext = tile.getContext('2d');
      if (!tileContext) {
        return;
      }
      const imageData = tileContext.createImageData(tile.width, tile.height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const value = Math.floor(Math.random() * 255);
        imageData.data[index] = value;
        imageData.data[index + 1] = value;
        imageData.data[index + 2] = value;
        imageData.data[index + 3] = 255;
      }
      tileContext.putImageData(imageData, 0, 0);
      const pattern = context.createPattern(tile, 'repeat');
      if (!pattern) {
        return;
      }
      context.fillStyle = pattern;
      context.fillRect(0, 0, viewport.width, viewport.height);
      setCanvasVisuals('grain', 0.08 + getEffectAlpha(0.22, strength), 'overlay');
    }

    function getGridStart(step, minimum) {
      const first = step / 2;
      if (minimum <= first) {
        return first;
      }
      return first + (Math.floor((minimum - first) / step) * step);
    }

    function getEffectBaseKey(type, viewport, sampler, inkTone, strength, size, spacing) {
      return [
        type,
        loadedImageUrl,
        canvas ? canvas.width : 0,
        canvas ? canvas.height : 0,
        viewport.width,
        viewport.height,
        inkTone,
        resolveUseDarkInk(inkTone, sampler) ? 1 : 0,
        strength,
        size,
        spacing
      ].join(':');
    }

    function drawHalftoneLayer(targetContext, viewport, sampler, inkTone, strength, size, spacing) {
      const metrics = getRenderedMetrics(sampler, viewport);
      const step = getControlRange(
        spacing,
        viewport.width < 720 ? 9 : 10,
        viewport.width < 720 ? 23 : 26
      );
      const sizeRadius = getControlRange(
        size,
        viewport.width < 720 ? 1.4 : 1.6,
        viewport.width < 720 ? 13 : 15
      );
      const maxRadius = Math.min(sizeRadius, step * 0.78);
      const useDarkInk = resolveUseDarkInk(inkTone, sampler);
      const strengthRatio = clampNumber(strength, 0, 100) / 100;
      for (let y = getGridStart(step, 0); y <= viewport.height + step; y += step) {
        if (y < 0 || y > viewport.height + step) {
          continue;
        }
        for (let x = getGridStart(step, 0); x <= viewport.width + step; x += step) {
          if (x < 0 || x > viewport.width + step) {
            continue;
          }
          const color = sampleColor(sampler, metrics, x, y);
          const luminance = getLuminance(color);
          const tone = getLayerEffectTone(luminance, sampler, strength, useDarkInk);
          if (tone <= 0.01) {
            continue;
          }
          const radius = clampNumber(
            tone * maxRadius,
            0.7,
            maxRadius
          );
          const ink = liftSampleColor(
            color,
            0.18 + (strengthRatio * 0.18) + (tone * 0.2),
            0.12 + (strengthRatio * 0.16)
          );
          targetContext.globalAlpha = clampNumber(
            0.24 + (tone * 0.58),
            0.1,
            0.88
          );
          targetContext.fillStyle = `rgb(${ink.red} ${ink.green} ${ink.blue})`;
          targetContext.beginPath();
          targetContext.arc(x, y, radius, 0, Math.PI * 2);
          targetContext.fill();
        }
      }
      targetContext.globalAlpha = 1;
    }

    function drawAsciiLayer(targetContext, viewport, sampler, inkTone, strength, size, spacing) {
      const metrics = getRenderedMetrics(sampler, viewport);
      const useDarkInk = resolveUseDarkInk(inkTone, sampler);
      const strengthRatio = clampNumber(strength, 0, 100) / 100;
      const fontSize = Math.round(getControlRange(size, 7, viewport.width < 720 ? 22 : 24));
      targetContext.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      targetContext.textRendering = 'geometricPrecision';
      targetContext.fontKerning = 'none';
      targetContext.textBaseline = 'middle';
      targetContext.textAlign = 'center';
      const glyphMetrics = getAsciiGlyphMetrics(fontSize, targetContext.font, targetContext);
      const xStep = Math.max(
        getControlRange(spacing, viewport.width < 720 ? 7 : 8, viewport.width < 720 ? 22 : 24),
        glyphMetrics.glyphWidth * 1.08
      );
      const lineHeight = Math.max(
        getControlRange(spacing, 9, viewport.width < 720 ? 24 : 26),
        (glyphMetrics.glyphHeight || fontSize) * 1.12,
        fontSize * 1.04
      );
      for (let y = getGridStart(lineHeight, 0); y <= viewport.height + lineHeight; y += lineHeight) {
        if (y < 0 || y > viewport.height + lineHeight) {
          continue;
        }
        for (let x = getGridStart(xStep, 0); x <= viewport.width + xStep; x += xStep) {
          if (x < 0 || x > viewport.width + xStep) {
            continue;
          }
          const color = sampleColor(sampler, metrics, x, y);
          const luminance = getLuminance(color);
          const tone = getLayerEffectTone(luminance, sampler, strength, useDarkInk);
          if (tone <= 0.02) {
            continue;
          }
          const index = Math.round(tone * (ASCII_CHARS.length - 1));
          const char = ASCII_CHARS[clampNumber(index, 0, ASCII_CHARS.length - 1)];
          if (char === ' ') {
            continue;
          }
          const ink = liftSampleColor(
            color,
            0.24 + (strengthRatio * 0.18) + (tone * 0.24),
            0.16 + (strengthRatio * 0.2)
          );
          const alpha = (0.12 + (tone * 0.7)) *
            (0.72 + (strengthRatio * 0.28));
          targetContext.globalAlpha = clampNumber(alpha, 0.06, 0.94);
          targetContext.fillStyle = `rgb(${ink.red} ${ink.green} ${ink.blue})`;
          targetContext.fillText(char, x, y);
        }
      }
      targetContext.globalAlpha = 1;
    }

    function drawDitherLayer(targetContext, viewport, sampler, _inkTone, strength, size, spacing) {
      const metrics = getRenderedMetrics(sampler, viewport);
      const strengthRatio = clampNumber(strength, 0, 100) / 100;
      const pixelSize = Math.max(2, Math.round(getControlRange(
        size,
        2,
        viewport.width < 720 ? 7 : 9
      )));
      const patternScale = Math.max(1, Math.round(getControlRange(spacing, 1, 4)));
      const colorLevels = Math.max(2, Math.round(getControlRange(strength, 8, 2)));
      const colorMix = getControlRange(strength, 0.32, 1);
      const ditherCanvas = documentObj.createElement('canvas');
      ditherCanvas.width = Math.max(1, Math.ceil(viewport.width / pixelSize));
      ditherCanvas.height = Math.max(1, Math.ceil(viewport.height / pixelSize));
      const ditherContext = ditherCanvas.getContext('2d');
      if (!ditherContext) {
        return;
      }
      const imageData = ditherContext.createImageData(ditherCanvas.width, ditherCanvas.height);
      for (let y = 0; y < ditherCanvas.height; y += 1) {
        const matrixY = Math.floor(y / patternScale) % BAYER_4X4.length;
        for (let x = 0; x < ditherCanvas.width; x += 1) {
          const matrixX = Math.floor(x / patternScale) % BAYER_4X4[matrixY].length;
          const threshold = (BAYER_4X4[matrixY][matrixX] + 0.5) / 16;
          const viewportX = Math.min(viewport.width, (x + 0.5) * pixelSize);
          const viewportY = Math.min(viewport.height, (y + 0.5) * pixelSize);
          const color = boostSampleColor(
            sampleColor(sampler, metrics, viewportX, viewportY),
            0.06 + (strengthRatio * 0.18)
          );
          const dithered = quantizeDitherColor(color, threshold, colorLevels, colorMix);
          const index = ((y * ditherCanvas.width) + x) * 4;
          imageData.data[index] = dithered.red;
          imageData.data[index + 1] = dithered.green;
          imageData.data[index + 2] = dithered.blue;
          imageData.data[index + 3] = 255;
        }
      }
      ditherContext.putImageData(imageData, 0, 0);
      const previousSmoothing = targetContext.imageSmoothingEnabled;
      targetContext.imageSmoothingEnabled = false;
      targetContext.drawImage(
        ditherCanvas,
        0,
        0,
        ditherCanvas.width,
        ditherCanvas.height,
        0,
        0,
        viewport.width,
        viewport.height
      );
      targetContext.imageSmoothingEnabled = previousSmoothing;
    }

    function drawCachedLayeredEffect(type, viewport, sampler, inkTone, strength, size, spacing, drawLayer) {
      const cacheKey = getEffectBaseKey(type, viewport, sampler, inkTone, strength, size, spacing);
      if (effectBaseCacheKey !== cacheKey) {
        context.clearRect(0, 0, viewport.width, viewport.height);
        drawLayer(context, viewport, sampler, inkTone, strength, size, spacing);
        effectBaseCacheKey = cacheKey;
      }
      setCanvasVisuals(type, 1, 'normal');
    }

    function drawHalftone(viewport, sampler, inkTone, strength, size, spacing) {
      drawCachedLayeredEffect(
        'halftone',
        viewport,
        sampler,
        inkTone,
        strength,
        size,
        spacing,
        drawHalftoneLayer
      );
    }

    function drawAscii(viewport, sampler, inkTone, strength, size, spacing) {
      drawCachedLayeredEffect(
        'ascii',
        viewport,
        sampler,
        inkTone,
        strength,
        size,
        spacing,
        drawAsciiLayer
      );
    }

    function drawDither(viewport, sampler, inkTone, strength, size, spacing) {
      drawCachedLayeredEffect(
        'dither',
        viewport,
        sampler,
        inkTone,
        strength,
        size,
        spacing,
        drawDitherLayer
      );
    }

    function renderNow(revision) {
      renderFrame = 0;
      const normalized = normalizePrefs(prefs);
      if (normalized.type === 'none' || !isWallpaperActive()) {
        clearCanvas();
        completeRender(revision);
        return;
      }
      if (!ensureCanvas()) {
        completeRender(revision);
        return;
      }
      const crossfadeResize = shouldCrossfadeResize &&
        (normalized.type === 'halftone' ||
          normalized.type === 'dither' ||
          normalized.type === 'ascii');
      shouldCrossfadeResize = false;
      if (crossfadeResize) {
        prepareResizeCrossfade();
      }
      const viewport = resizeCanvas();
      if (!viewport) {
        completeRender(revision);
        return;
      }
      const token = ++renderToken;
      if (normalized.type === 'grain') {
        drawGrain(viewport, normalized.strength);
        completeRender(revision);
        return;
      }
      const wallpaper = getCurrentWallpaper();
      const imageUrl = wallpaper ? getWallpaperImageUrl(wallpaper) : '';
      loadImage(imageUrl, token).then((image) => {
        if (token !== renderToken) {
          return;
        }
        if (!image) {
          clearCanvas();
          completeRender(revision);
          return;
        }
        const sampler = getSampler(image, imageUrl);
        if (!sampler) {
          clearCanvas();
          completeRender(revision);
          return;
        }
        const nextViewport = resizeCanvas();
        if (!nextViewport) {
          completeRender(revision);
          return;
        }
        if (normalized.type === 'halftone') {
          drawHalftone(
            nextViewport,
            sampler,
            normalized.inkTone,
            normalized.strength,
            normalized.size,
            normalized.spacing
          );
          completeRender(revision);
          return;
        }
        if (normalized.type === 'dither') {
          drawDither(
            nextViewport,
            sampler,
            normalized.inkTone,
            normalized.strength,
            normalized.size,
            normalized.spacing
          );
          completeRender(revision);
          return;
        }
        if (normalized.type === 'ascii') {
          drawAscii(
            nextViewport,
            sampler,
            normalized.inkTone,
            normalized.strength,
            normalized.size,
            normalized.spacing
          );
        }
        completeRender(revision);
      }).catch(() => {
        clearCanvas();
        completeRender(revision);
      });
    }

    function runRenderNow(revision) {
      try {
        renderNow(revision);
      } catch (_error) {
        try {
          clearCanvas();
        } finally {
          completeRender(revision);
        }
      }
    }

    function scheduleRender(delay) {
      const revision = ++renderRequestRevision;
      if (renderFrame) {
        cancelFrame(renderFrame);
        renderFrame = 0;
      }
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = 0;
      }
      const wait = Number(delay) || 0;
      if (wait > 0) {
        renderTimer = setTimeout(() => {
          renderTimer = 0;
          renderFrame = requestFrame(() => runRenderNow(revision));
        }, wait);
        return revision;
      }
      renderFrame = requestFrame(() => runRenderNow(revision));
      return revision;
    }

    function apply(nextPrefs) {
      const previousPrefs = normalizePrefs(prefs);
      prefs = normalizePrefs(nextPrefs);
      const previousType = previousPrefs.type;
      const visualPrefsChanged = previousType !== prefs.type ||
        previousPrefs.inkTone !== prefs.inkTone ||
        previousPrefs.strength !== prefs.strength ||
        previousPrefs.size !== prefs.size ||
        previousPrefs.spacing !== prefs.spacing;
      if (!visualPrefsChanged) {
        return;
      }
      if (prefs.type !== 'ascii' && prefs.type !== 'dither' && prefs.type !== 'halftone') {
        clearEffectBaseCache();
      }
      if (canvas &&
          context &&
          canAnimateTransition() &&
          previousType !== prefs.type &&
          previousType !== 'none' &&
          prefs.type !== 'none' &&
          getCanvasOpacity() > 0.01) {
        canvas.style.opacity = '0';
        scheduleRender(EFFECT_CROSSFADE_MS);
        return;
      }
      if (visualPrefsChanged && previousType === prefs.type) {
        scheduleRender(PARAMETER_RENDER_DEBOUNCE_MS);
        return;
      }
      scheduleRender();
    }

    function refresh(options) {
      const normalized = normalizePrefs(prefs);
      const immediate = Boolean(options && options.immediate);
      if (canvas &&
          context &&
          canAnimateTransition() &&
          normalized.type !== 'none' &&
          getCanvasOpacity() > 0.01) {
        canvas.style.opacity = '0';
        return waitForRenderRevision(scheduleRender(immediate ? 0 : EFFECT_CROSSFADE_MS));
      }
      return waitForRenderRevision(scheduleRender(immediate ? 0 : 60));
    }

    if (windowObj && typeof windowObj.addEventListener === 'function') {
      windowObj.addEventListener('resize', () => {
        const normalized = normalizePrefs(prefs);
        shouldCrossfadeResize = Boolean(
          canvas &&
          context &&
          canAnimateTransition() &&
          (normalized.type === 'halftone' ||
            normalized.type === 'dither' ||
            normalized.type === 'ascii') &&
          getCanvasOpacity() > 0.01
        );
        scheduleRender(RESIZE_RENDER_SETTLE_MS);
      }, { passive: true });
    }

    return {
      apply,
      getLuminanceAtViewport,
      refresh,
      normalizePrefs
    };
  }

  root.LumnoNewtabWallpaperEffects = {
    analyzeImageData,
    DEFAULT_PREFS,
    EFFECT_INK_TONES,
    EFFECT_TYPES,
    createWallpaperEffects,
    getEffectCanvasScale,
    liftSampleColor,
    normalizePrefs,
    quantizeDitherColor,
    resolveUseDarkInk
  };
})(globalThis);
