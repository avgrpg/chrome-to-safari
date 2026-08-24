"use strict";
(() => {
  const api = typeof chrome !== "undefined" ? chrome : browser;

  const DEFAULTS = { lineStep: 88, chord: "j", chordInterval: 300 };
  const cfg = { ...DEFAULTS };

  let mode = "off"; // off | normal | hint
  let lastChord = 0;
  let pendingG = false;
  let hint = null;

  const isEditable = (el) => {
    if (!el) return false;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      el.isContentEditable === true
    );
  };

  const anyModifier = (e) => e.metaKey || e.ctrlKey || e.altKey;

  let statusDiv = null;
  const statusEl = () => {
    if (!statusDiv) {
      statusDiv = document.createElement("div");
      statusDiv.id = "vimnav-status";
      (document.body || document.documentElement).appendChild(statusDiv);
    }
    return statusDiv;
  };
  const showStatus = (text) => {
    const s = statusEl();
    s.textContent = text;
    s.style.display = "block";
  };
  const hideStatus = () => {
    if (statusDiv) statusDiv.style.display = "none";
  };

  const enterNormal = () => {
    if (mode === "normal") return;
    if (mode === "hint") teardownHint();
    mode = "normal";
    if (document.activeElement && isEditable(document.activeElement)) {
      document.activeElement.blur();
    }
    showStatus("NORMAL");
  };

  const exitNormal = () => {
    if (mode === "hint") teardownHint();
    mode = "off";
    hideStatus();
  };

  const vScroll = (dy) => window.scrollBy({ top: dy, behavior: "smooth" });
  const hScroll = (dx) => window.scrollBy({ left: dx, behavior: "smooth" });
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const scrollBottom = () => {
    const max = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    window.scrollTo({ top: max, behavior: "smooth" });
  };
  const step = () => cfg.lineStep;

  const handleNormalKey = (e) => {
    if (anyModifier(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.key;

    if (k === "Escape") {
      exitNormal();
      return;
    }

    if (k === "g" || k === "G") {
      if (pendingG && k === "g") {
        pendingG = false;
        scrollTop();
      } else if (k === "G") {
        pendingG = false;
        scrollBottom();
      } else {
        pendingG = true;
      }
      return;
    }
    pendingG = false;

    switch (k) {
      case "j":
        vScroll(step());
        break;
      case "k":
        vScroll(-step());
        break;
      case "h":
        hScroll(-step());
        break;
      case "l":
        hScroll(step());
        break;
      case "d":
        vScroll(Math.floor(window.innerHeight / 2));
        break;
      case "u":
        vScroll(-Math.floor(window.innerHeight / 2));
        break;
      case "f":
        startHint(false);
        break;
      case "F":
        startHint(true);
        break;
      case "H":
        showStatus("HISTORY  ←");
        history.back();
        setTimeout(() => mode === "normal" && showStatus("NORMAL"), 600);
        break;
      case "L":
        showStatus("HISTORY  →");
        history.forward();
        setTimeout(() => mode === "normal" && showStatus("NORMAL"), 600);
        break;
      case "?":
        showStatus(
          "j↓ k↑ h← l→   d/u ½page   gg/G top·bottom   f links   H/L history   ? help   Esc exit"
        );
        setTimeout(() => mode === "normal" && showStatus("NORMAL"), 4000);
        break;
      default:
        break;
    }
  };

  const handleHintKey = (e) => {
    if (anyModifier(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.key;

    if (k === "Escape") {
      teardownHint();
      enterNormal();
      return;
    }
    if (!/^[a-z0-9]$/i.test(k)) return;

    hint.buf += k.toLowerCase();
    const matches = hint.items.filter((it) => it.label.startsWith(hint.buf));

    if (matches.length === 0) {
      hint.buf = "";
      paintHints();
      return;
    }
    if (matches.length === 1) {
      openItem(matches[0]);
      return;
    }
    paintHints();
  };

  const openItem = (item) => {
    if (hint.newTab) window.open(item.el.href, "_blank", "noopener");
    else window.location.href = item.el.href;
    teardownHint();
    exitNormal();
  };

  const keyHandler = (e) => {
    if (mode === "normal") handleNormalKey(e);
    else if (mode === "hint") handleHintKey(e);
    else detectChord(e);
  };

  const detectChord = (e) => {
    if (anyModifier(e)) return;
    if (isEditable(document.activeElement)) return;
    const k = (e.key || "").toLowerCase();
    if (k !== cfg.chord) return;
    const now = performance.now();
    if (now - lastChord <= cfg.chordInterval) {
      e.preventDefault();
      e.stopPropagation();
      lastChord = 0;
      enterNormal();
    } else {
      lastChord = now;
    }
  };

  const GEN = "abcdefghijklmnopqrstuvwxyz";

  const startHint = (newTab) => {
    const links = [];
    for (const a of document.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      if (!href || /^\s*(#|javascript:)/i.test(href)) continue;
      const rect = a.getBoundingClientRect();
      if (rect.width < 3 || rect.height < 3) continue;
      if (
        rect.bottom < 0 ||
        rect.top > innerHeight ||
        rect.right < 0 ||
        rect.left > innerWidth
      ) continue;
      links.push({ el: a, rect });
    }
    if (links.length === 0) return;

    const items = links.map((link, n) => {
      let label;
      if (n < 26) {
        label = GEN[n];
      } else {
        label = GEN[Math.floor((n - 26) / 26)] + GEN[(n - 26) % 26];
      }
      return { ...link, label };
    });

    hint = { items, buf: "", newTab, overlay: null, raf: null };
    hint.overlay = document.createElement("div");
    hint.overlay.id = "vimnav-hints";
    (document.body || document.documentElement).appendChild(hint.overlay);
    for (const it of items) {
      const badge = document.createElement("div");
      badge.className = "vimnav-hint";
      badge.textContent = it.label;
      hint.overlay.appendChild(badge);
      it.badge = badge;
    }
    mode = "hint";
    hideStatus();
    hint.raf = requestAnimationFrame(paintHints);
  };

  const paintHints = () => {
    if (!hint) return;
    for (const it of hint.items) {
      const rect = it.el.getBoundingClientRect();
      const visible =
        rect.width >= 3 &&
        rect.height >= 3 &&
        rect.bottom >= 0 &&
        rect.top <= innerHeight &&
        rect.right >= 0 &&
        rect.left <= innerWidth;
      it.badge.style.display = visible ? "block" : "none";
      it.badge.style.left = rect.left + "px";
      it.badge.style.top = rect.top + "px";
      it.badge.classList.toggle("vimnav-dim", !it.label.startsWith(hint.buf));
    }
    hint.raf = requestAnimationFrame(paintHints);
  };

  const teardownHint = () => {
    if (!hint) return;
    cancelAnimationFrame(hint.raf);
    hint.overlay.remove();
    hint = null;
  };

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "vimnav-toggle") {
      if (mode === "off") enterNormal();
      else exitNormal();
    }
  });

  if (api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const key of Object.keys(cfg)) {
        if (changes[key] && typeof changes[key].newValue !== "undefined") {
          cfg[key] = changes[key].newValue;
        }
      }
    });
  }
  if (api.storage && api.storage.sync) {
    api.storage.sync.get(cfg).then((stored) => {
      Object.assign(cfg, stored);
    });
  }

  window.addEventListener("keydown", keyHandler, true);
})();