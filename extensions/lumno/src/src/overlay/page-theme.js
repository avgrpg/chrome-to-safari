(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoOverlayPageTheme = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const OVERLAY_PANEL_ID = '_x_extension_overlay_2024_unique_';
  const OVERLAY_HOST_ID = '_x_extension_overlay_host_2026_unique_';
  const DEFAULT_CANVAS_RGB = [255, 255, 255];
  const MAX_BACKGROUND_ANCESTORS = 10;
  const VIEWPORT_SAMPLE_POINTS = Object.freeze([
    { x: 0.28, y: 0.19, weight: 1.2 },
    { x: 0.39, y: 0.19, weight: 1.7 },
    { x: 0.5, y: 0.19, weight: 2.35 },
    { x: 0.61, y: 0.19, weight: 1.7 },
    { x: 0.72, y: 0.19, weight: 1.2 },
    { x: 0.28, y: 0.29, weight: 1.05 },
    { x: 0.39, y: 0.29, weight: 1.45 },
    { x: 0.5, y: 0.29, weight: 1.9 },
    { x: 0.61, y: 0.29, weight: 1.45 },
    { x: 0.72, y: 0.29, weight: 1.05 },
    { x: 0.28, y: 0.39, weight: 0.95 },
    { x: 0.39, y: 0.39, weight: 1.25 },
    { x: 0.5, y: 0.39, weight: 1.55 },
    { x: 0.61, y: 0.39, weight: 1.25 },
    { x: 0.72, y: 0.39, weight: 0.95 },
    { x: 0.28, y: 0.5, weight: 0.7 },
    { x: 0.39, y: 0.5, weight: 0.9 },
    { x: 0.5, y: 0.5, weight: 1.05 },
    { x: 0.61, y: 0.5, weight: 0.9 },
    { x: 0.72, y: 0.5, weight: 0.7 },
    { x: 0.5, y: 0.08, weight: 0.65 },
    { x: 0.18, y: 0.2, weight: 0.55 },
    { x: 0.82, y: 0.2, weight: 0.55 },
    { x: 0.18, y: 0.5, weight: 0.45 },
    { x: 0.82, y: 0.5, weight: 0.45 },
    { x: 0.32, y: 0.64, weight: 0.45 },
    { x: 0.5, y: 0.64, weight: 0.55 },
    { x: 0.68, y: 0.64, weight: 0.45 },
    { x: 0.5, y: 0.78, weight: 0.35 }
  ]);

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, number));
  }

  function parseColorChannel(value) {
    const text = String(value || '').trim();
    if (!text) {
      return NaN;
    }
    if (text.endsWith('%')) {
      return clampNumber((Number(text.slice(0, -1)) / 100) * 255, 0, 255);
    }
    return clampNumber(Number(text), 0, 255);
  }

  function parseAlphaChannel(value) {
    const text = String(value || '').trim();
    if (!text) {
      return 1;
    }
    if (text.endsWith('%')) {
      return clampNumber(Number(text.slice(0, -1)) / 100, 0, 1);
    }
    return clampNumber(Number(text), 0, 1);
  }

  function parseHexColor(hex) {
    if (hex.length === 3 || hex.length === 4) {
      const red = parseInt(hex[0] + hex[0], 16);
      const green = parseInt(hex[1] + hex[1], 16);
      const blue = parseInt(hex[2] + hex[2], 16);
      const alpha = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      if ([red, green, blue, alpha].every((value) => Number.isFinite(value))) {
        return { rgb: [red, green, blue], alpha };
      }
      return null;
    }
    if (hex.length === 6 || hex.length === 8) {
      const red = parseInt(hex.slice(0, 2), 16);
      const green = parseInt(hex.slice(2, 4), 16);
      const blue = parseInt(hex.slice(4, 6), 16);
      const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([red, green, blue, alpha].every((value) => Number.isFinite(value))) {
        return { rgb: [red, green, blue], alpha };
      }
    }
    return null;
  }

  function parseFunctionalColor(trimmed) {
    const match = trimmed.match(/^rgba?\((.*)\)$/);
    if (!match) {
      return null;
    }
    const body = match[1].trim();
    let parts = [];
    let alpha = 1;
    if (body.includes(',')) {
      parts = body.split(',').map((part) => part.trim());
      if (parts.length < 3) {
        return null;
      }
      alpha = parts.length > 3 ? parseAlphaChannel(parts[3]) : 1;
    } else {
      const alphaSplit = body.split('/');
      parts = alphaSplit[0].trim().split(/\s+/).filter(Boolean);
      alpha = alphaSplit.length > 1 ? parseAlphaChannel(alphaSplit[1]) : 1;
    }
    if (parts.length < 3) {
      return null;
    }
    const rgb = [
      parseColorChannel(parts[0]),
      parseColorChannel(parts[1]),
      parseColorChannel(parts[2])
    ];
    if (!rgb.every((value) => Number.isFinite(value))) {
      return null;
    }
    return { rgb, alpha };
  }

  function parseCssColor(color) {
    if (!color || typeof color !== 'string') {
      return null;
    }
    const trimmed = color.trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    if (trimmed === 'transparent') {
      return { rgb: [0, 0, 0], alpha: 0 };
    }
    if (trimmed.startsWith('#')) {
      return parseHexColor(trimmed.slice(1));
    }
    return parseFunctionalColor(trimmed);
  }

  function mixRgb(foreground, background, alpha) {
    const amount = clampNumber(alpha, 0, 1);
    return [
      Math.round((foreground[0] * amount) + (background[0] * (1 - amount))),
      Math.round((foreground[1] * amount) + (background[1] * (1 - amount))),
      Math.round((foreground[2] * amount) + (background[2] * (1 - amount)))
    ];
  }

  function getRelativeLuminance(rgb) {
    if (!rgb || rgb.length !== 3) {
      return 0;
    }
    const [red, green, blue] = rgb.map((value) => {
      const channel = clampNumber(value, 0, 255) / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  }

  function getPerceptualTone(rgb) {
    if (!rgb || rgb.length !== 3) {
      return 0.5;
    }
    return (
      (clampNumber(rgb[0], 0, 255) * 0.299) +
      (clampNumber(rgb[1], 0, 255) * 0.587) +
      (clampNumber(rgb[2], 0, 255) * 0.114)
    ) / 255;
  }

  function getCssColorThemeSignal(color, weight) {
    const parsed = parseCssColor(color);
    if (!parsed || parsed.alpha <= 0.08) {
      return null;
    }
    const rgb = parsed.alpha < 1
      ? mixRgb(parsed.rgb, DEFAULT_CANVAS_RGB, parsed.alpha)
      : parsed.rgb;
    const luminance = getRelativeLuminance(rgb);
    const normalizedWeight = Number.isFinite(Number(weight))
      ? Math.max(0, Number(weight))
      : 1;
    if (luminance < 0.42) {
      return {
        theme: 'dark',
        confidence: clampNumber((0.42 - luminance) / 0.42, 0, 1),
        weight: normalizedWeight
      };
    }
    if (luminance > 0.58) {
      return {
        theme: 'light',
        confidence: clampNumber((luminance - 0.58) / 0.42, 0, 1),
        weight: normalizedWeight
      };
    }
    return null;
  }

  function resolvePageThemeSignals(signals) {
    let totalScore = 0;
    let totalWeight = 0;
    (Array.isArray(signals) ? signals : []).forEach((signal) => {
      if (!signal || (signal.theme !== 'dark' && signal.theme !== 'light')) {
        return;
      }
      const confidence = clampNumber(signal.confidence, 0, 1);
      const weight = Number.isFinite(Number(signal.weight))
        ? Math.max(0, Number(signal.weight))
        : 1;
      if (confidence <= 0 || weight <= 0) {
        return;
      }
      const contributionWeight = confidence * weight;
      totalScore += (signal.theme === 'dark' ? -1 : 1) * contributionWeight;
      totalWeight += contributionWeight;
    });
    if (totalWeight <= 0.2) {
      return null;
    }
    const confidence = totalScore / totalWeight;
    if (confidence <= -0.22) {
      return 'dark';
    }
    if (confidence >= 0.22) {
      return 'light';
    }
    return null;
  }

  function getComputedStyleFor(win, element) {
    if (!win || typeof win.getComputedStyle !== 'function' || !element) {
      return null;
    }
    try {
      return win.getComputedStyle(element);
    } catch (error) {
      return null;
    }
  }

  function isElementRenderable(style) {
    if (!style) {
      return true;
    }
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
    const opacity = Number(style.opacity);
    return !Number.isFinite(opacity) || opacity > 0.03;
  }

  function getElementId(element) {
    if (!element) {
      return '';
    }
    if (typeof element.id === 'string') {
      return element.id;
    }
    return typeof element.getAttribute === 'function' ? String(element.getAttribute('id') || '') : '';
  }

  function hasTruthyAttribute(element, name) {
    if (!element || typeof element.hasAttribute !== 'function') {
      return false;
    }
    return element.hasAttribute(name);
  }

  function isLumnoOverlayElement(element) {
    let current = element;
    let depth = 0;
    while (current && depth < MAX_BACKGROUND_ANCESTORS) {
      const id = getElementId(current);
      if (id === OVERLAY_PANEL_ID || id === OVERLAY_HOST_ID) {
        return true;
      }
      if (hasTruthyAttribute(current, 'data-lumno-overlay-host') ||
          hasTruthyAttribute(current, 'data-lumno-overlay-panel')) {
        return true;
      }
      current = current.parentElement;
      depth += 1;
    }
    return false;
  }

  function getViewportSize(doc, win) {
    const visualViewport = win && win.visualViewport ? win.visualViewport : null;
    const width = Number(visualViewport && visualViewport.width) ||
      Number(win && win.innerWidth) ||
      Number(doc && doc.documentElement && doc.documentElement.clientWidth) ||
      0;
    const height = Number(visualViewport && visualViewport.height) ||
      Number(win && win.innerHeight) ||
      Number(doc && doc.documentElement && doc.documentElement.clientHeight) ||
      0;
    return {
      width: Math.max(0, width),
      height: Math.max(0, height)
    };
  }

  function getElementAtPoint(doc, x, y) {
    if (!doc || typeof doc.elementFromPoint !== 'function') {
      return null;
    }
    try {
      return doc.elementFromPoint(x, y);
    } catch (error) {
      return null;
    }
  }

  function getCompositedBackgroundRgb(element, doc, win) {
    const stack = [];
    let current = element;
    let depth = 0;
    while (current && depth < MAX_BACKGROUND_ANCESTORS) {
      stack.push(current);
      if (current === doc.documentElement) {
        break;
      }
      current = current.parentElement;
      depth += 1;
    }
    if (doc && doc.body && !stack.includes(doc.body)) {
      stack.push(doc.body);
    }
    if (doc && doc.documentElement && !stack.includes(doc.documentElement)) {
      stack.push(doc.documentElement);
    }

    let rgb = DEFAULT_CANVAS_RGB.slice();
    let hasExplicitBackground = false;
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const style = getComputedStyleFor(win, stack[i]);
      const parsed = parseCssColor(style && style.backgroundColor);
      if (!parsed || parsed.alpha <= 0.01) {
        continue;
      }
      hasExplicitBackground = true;
      rgb = mixRgb(parsed.rgb, rgb, parsed.alpha);
    }
    return {
      rgb,
      hasExplicitBackground
    };
  }

  function getElementTextRgb(element, win) {
    const style = getComputedStyleFor(win, element);
    const parsed = parseCssColor(style && style.color);
    if (!parsed || parsed.alpha < 0.2) {
      return null;
    }
    return parsed.rgb;
  }

  function scoreThemeSample(element, weight, doc, win) {
    if (!element || isLumnoOverlayElement(element)) {
      return null;
    }
    const style = getComputedStyleFor(win, element);
    if (!isElementRenderable(style)) {
      return null;
    }
    const background = getCompositedBackgroundRgb(element, doc, win);
    const backgroundRgb = background.rgb;
    const backgroundTone = getPerceptualTone(backgroundRgb);
    const textRgb = getElementTextRgb(element, win);
    const textTone = textRgb ? getPerceptualTone(textRgb) : null;
    let vote = 0;

    if (!background.hasExplicitBackground && textTone !== null) {
      if (textTone >= 0.72) {
        vote -= 1.1;
      } else if (textTone <= 0.28) {
        vote += 1.1;
      }
    } else if (backgroundTone <= 0.38) {
      vote -= 1;
    } else if (backgroundTone >= 0.62) {
      vote += 1;
    } else {
      vote += (backgroundTone - 0.5) * 0.7;
    }

    if (textTone !== null) {
      const backgroundLuminance = getRelativeLuminance(backgroundRgb);
      const textLuminance = getRelativeLuminance(textRgb);
      const contrast = (Math.max(backgroundLuminance, textLuminance) + 0.05) /
        (Math.min(backgroundLuminance, textLuminance) + 0.05);
      if (contrast >= 2.2) {
        if (backgroundTone <= 0.5 && textTone >= 0.64) {
          vote -= 0.55;
        } else if (backgroundTone >= 0.5 && textTone <= 0.36) {
          vote += 0.55;
        }
      }
    }

    return {
      score: vote * weight,
      weight
    };
  }

  function detectPageVisualThemeSignal(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const doc = settings.document || (typeof document !== 'undefined' ? document : null);
    const win = settings.window || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
    if (!doc || !win) {
      return null;
    }
    const viewport = getViewportSize(doc, win);
    if (viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }
    const points = Array.isArray(settings.points) && settings.points.length > 0
      ? settings.points
      : VIEWPORT_SAMPLE_POINTS;
    let totalScore = 0;
    let totalWeight = 0;
    let sampleCount = 0;
    points.forEach((point) => {
      const x = clampNumber(point.x, 0, 1) * Math.max(1, viewport.width - 1);
      const y = clampNumber(point.y, 0, 1) * Math.max(1, viewport.height - 1);
      const element = getElementAtPoint(doc, x, y);
      const weight = Number.isFinite(Number(point.weight)) ? Math.max(0, Number(point.weight)) : 1;
      const sample = scoreThemeSample(element, weight, doc, win);
      if (!sample) {
        return;
      }
      totalScore += sample.score;
      totalWeight += sample.weight;
      sampleCount += 1;
    });

    if (totalWeight < 1) {
      return null;
    }
    const confidence = totalScore / totalWeight;
    const absoluteConfidence = Math.min(1, Math.abs(confidence));
    return {
      theme: confidence <= -0.48 ? 'dark' : (confidence >= 0.48 ? 'light' : null),
      suggestedTheme: confidence < 0 ? 'dark' : 'light',
      confidence: absoluteConfidence,
      score: confidence,
      sampleCount
    };
  }

  function detectPageVisualTheme(options) {
    const signal = detectPageVisualThemeSignal(options);
    return signal && signal.theme ? signal.theme : null;
  }

  function resolveOverlayTheme(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const mode = settings.mode === 'dark' || settings.mode === 'light'
      ? settings.mode
      : 'system';
    if (mode !== 'system') {
      return mode;
    }
    const pageTheme = settings.pageTheme === 'dark' || settings.pageTheme === 'light'
      ? settings.pageTheme
      : null;
    if (settings.pageThemeAdaptationEnabled !== false && pageTheme) {
      return pageTheme;
    }
    return settings.systemTheme === 'dark' ? 'dark' : 'light';
  }

  function shouldStrengthenDarkOverlayBackground(options) {
    const settings = options && typeof options === 'object' ? options : {};
    return settings.resolvedTheme === 'dark' && settings.pageTheme === 'light';
  }

  function shouldObservePageTheme(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const mode = settings.mode === 'dark' || settings.mode === 'light'
      ? settings.mode
      : 'system';
    if (mode === 'dark') {
      return true;
    }
    if (mode !== 'system') {
      return false;
    }
    return settings.pageThemeAdaptationEnabled === true || settings.systemTheme === 'dark';
  }

  function syncPageThemeObservation(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const shouldObserve = shouldObservePageTheme(settings);
    const callback = shouldObserve ? settings.start : settings.stop;
    if (typeof callback === 'function') {
      callback();
    }
    return shouldObserve;
  }

  return Object.freeze({
    parseCssColor,
    getRelativeLuminance,
    getPerceptualTone,
    getCssColorThemeSignal,
    resolvePageThemeSignals,
    detectPageVisualThemeSignal,
    detectPageVisualTheme,
    resolveOverlayTheme,
    shouldStrengthenDarkOverlayBackground,
    shouldObservePageTheme,
    syncPageThemeObservation
  });
});
