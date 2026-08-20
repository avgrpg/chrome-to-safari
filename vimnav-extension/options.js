"use strict";
const api = typeof chrome !== "undefined" ? chrome : browser;

const DEFAULTS = { chord: "j", chordInterval: 300, lineStep: 88 };

const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", () => {
  if (api.storage && api.storage.sync) {
    api.storage.sync.get(DEFAULTS).then((stored) => {
      $("chord").value = stored.chord || DEFAULTS.chord;
      $("chordInterval").value = stored.chordInterval ?? DEFAULTS.chordInterval;
      $("lineStep").value = stored.lineStep ?? DEFAULTS.lineStep;
    });
  }

  $("save").addEventListener("click", async () => {
    const value = {
      chord: ($("chord").value || DEFAULTS.chord).toLowerCase().trim() || DEFAULTS.chord,
      chordInterval: Math.max(100, Number($("chordInterval").value) || DEFAULTS.chordInterval),
      lineStep: Math.max(10, Number($("lineStep").value) || DEFAULTS.lineStep),
    };
    await api.storage.sync.set(value);
    const saved = $("saved");
    saved.style.opacity = "1";
    setTimeout(() => (saved.style.opacity = "0"), 1500);
  });
});