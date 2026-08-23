"use strict";
const api = typeof chrome !== "undefined" ? chrome : browser;

const toggleOnActiveTab = async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  try {
    await api.tabs.sendMessage(tab.id, { type: "vimnav-toggle" });
  } catch (_) {
    // No content script on this page (chrome://, about:, store front, ...)
  }
};

if (api.action && api.action.onClicked) {
  api.action.onClicked.addListener(toggleOnActiveTab);
}

if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener((name) => {
    if (name === "toggle-vim") toggleOnActiveTab();
  });
}