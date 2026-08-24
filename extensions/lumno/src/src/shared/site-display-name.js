(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.LumnoSiteDisplayName = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const DEFAULT_BRAND_NAMES = Object.freeze({
    'lumno.kubai.design': 'Lumno',
    'github.com': 'GitHub',
    'youtube.com': 'YouTube',
    'google.com': 'Google',
    'mp.weixin.qq.com': 'WeChat Official Accounts',
    'weibo.com': 'Weibo',
    'x.com': 'X',
    'twitter.com': 'X',
    'immersivetranslate.com': 'Immersive Translate',
    'abouttrans.info': 'aboutTrans',
    'aboutrans.info': 'aboutTrans'
  });
  const BRAND_HOSTS = Object.freeze(Object.keys(DEFAULT_BRAND_NAMES));
  const PUBLIC_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'gov.uk', 'ac.uk',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn',
    'com.hk', 'com.tw', 'com.au', 'com.sg',
    'co.jp', 'co.kr'
  ]);
  const NOISY_SUBDOMAINS = new Set([
    'onboarding', 'login', 'signin', 'auth', 'account',
    'web', 'app', 'admin', 'stage', 'staging', 'preview', 'dev'
  ]);
  const TITLE_SEPARATORS = Object.freeze([
    ' | ', ' - ', ' — ', ' – ', ' · ', ' • ', '：', ':'
  ]);

  function getPrimaryLabelFromHost(host) {
    if (!host) {
      return '';
    }
    const parts = host.split('.').filter(Boolean);
    if (parts.length === 0) {
      return '';
    }
    if (parts.length === 1) {
      return parts[0];
    }
    const tail = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    const index = PUBLIC_SUFFIXES.has(tail) && parts.length >= 3
      ? parts.length - 3
      : parts.length - 2;
    return parts[index] || parts[0];
  }

  function prettifyLabel(label) {
    const value = String(label || '').trim();
    if (!value) {
      return '';
    }
    if (value.length === 1) {
      return value.toUpperCase();
    }
    if (/^[a-z]+$/.test(value)) {
      return value.charAt(0).toUpperCase() + value.slice(1);
    }
    return value;
  }

  function collectTitleCandidates(rawTitle) {
    if (!rawTitle) {
      return [];
    }
    const candidates = [rawTitle];
    TITLE_SEPARATORS.forEach((separator) => {
      if (rawTitle.includes(separator)) {
        rawTitle.split(separator).forEach((part) => candidates.push(part));
      }
    });
    return candidates;
  }

  function pickTitleCandidate(candidates) {
    let best = '';
    let bestScore = -1;
    candidates.forEach((part) => {
      const value = String(part || '').trim();
      if (!value || value.length < 2 || value.length > 24) {
        return;
      }
      if (/https?:|\/|\\|\?|=|&/.test(value) || /^\d+$/.test(value)) {
        return;
      }
      let score = 0;
      if (/[\u4e00-\u9fff]/.test(value)) {
        score += 2;
      }
      if (/\s/.test(value)) {
        score += 1;
      }
      if (value.length >= 3 && value.length <= 14) {
        score += 1;
      }
      if (score > bestScore) {
        best = value;
        bestScore = score;
      }
    });
    return best;
  }

  function normalizeWordToken(value) {
    return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function pickCasedLabelFromTitle(rawTitle, candidates, hostLabel) {
    const raw = String(hostLabel || '').trim();
    if (!raw || !rawTitle) {
      return '';
    }
    const target = normalizeWordToken(raw);
    if (!target) {
      return '';
    }
    for (let index = 0; index < candidates.length; index += 1) {
      const token = String(candidates[index] || '').trim();
      if (token && normalizeWordToken(token) === target) {
        return token;
      }
    }
    const words = rawTitle
      .split(/[\s|—–\-·•:：()（）\[\]【】]+/)
      .map((part) => String(part || '').trim())
      .filter(Boolean);
    for (let index = 0; index < words.length; index += 1) {
      if (normalizeWordToken(words[index]) === target) {
        return words[index];
      }
    }
    return '';
  }

  function isWeakHostLabel(label) {
    const value = String(label || '').trim().toLowerCase();
    return !value || value.length <= 1 || /^\d+$/.test(value) || NOISY_SUBDOMAINS.has(value);
  }

  function getMatchedBrandHost(host) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_BRAND_NAMES, host)) {
      return host;
    }
    return BRAND_HOSTS.find((brandHost) => host.endsWith(`.${brandHost}`)) || '';
  }

  function getBrandName(host, options) {
    const brandHost = getMatchedBrandHost(host);
    if (!brandHost) {
      return '';
    }
    const fallback = DEFAULT_BRAND_NAMES[brandHost];
    if (!options || typeof options.getBrandName !== 'function') {
      return fallback;
    }
    const localized = options.getBrandName(brandHost, fallback);
    return typeof localized === 'string' && localized ? localized : fallback;
  }

  function getSiteDisplayName(hostname, title, options) {
    const rawTitle = String(title || '').trim();
    const host = String(hostname || '').toLowerCase().replace(/^(www|m)\./i, '');
    const brandName = getBrandName(host, options);
    if (brandName) {
      return brandName;
    }
    if (host) {
      const titleCandidates = collectTitleCandidates(rawTitle);
      const primaryHostLabel = getPrimaryLabelFromHost(host);
      const casedFromTitle = pickCasedLabelFromTitle(
        rawTitle,
        titleCandidates,
        primaryHostLabel
      );
      const hostLabel = casedFromTitle || prettifyLabel(primaryHostLabel);
      const titleCandidate = pickTitleCandidate(titleCandidates);
      const firstSubdomain = host.split('.').filter(Boolean)[0] || '';
      if (NOISY_SUBDOMAINS.has(firstSubdomain) && titleCandidate) {
        return titleCandidate;
      }
      if (isWeakHostLabel(hostLabel) && titleCandidate) {
        return titleCandidate;
      }
      if (hostLabel) {
        return hostLabel;
      }
      if (titleCandidate) {
        return titleCandidate;
      }
    }
    return rawTitle || hostname || '';
  }

  return Object.freeze({
    DEFAULT_BRAND_NAMES,
    getSiteDisplayName
  });
});
