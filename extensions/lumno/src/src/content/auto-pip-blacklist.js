(function () {
  if (window.__lumnoAutoPipBlacklist2026) {
    return;
  }

  const hostRules = [
    /(^|\.)jd\.com$/,
    /(^|\.)360buy\.com$/,
    /(^|\.)taobao\.com$/,
    /(^|\.)x\.com$/,
    /(^|\.)twitter\.com$/,
    /(^|\.)weibo\.com$/,
    /(^|\.)weibo\.cn$/
  ];

  window.__lumnoAutoPipBlacklist2026 = {
    hostRules: hostRules
  };
})();
