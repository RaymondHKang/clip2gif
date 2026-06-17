import { adsenseConfig } from './ads-config.js';

const CONSENT_KEY = 'clip2gif-cookie-consent';

function hasValidConfig() {
  const { enabled, clientId, slots } = adsenseConfig;
  if (!enabled) return false;
  if (!clientId || clientId.includes('XXXX')) return false;
  if (!slots.top || slots.top.includes('XXX')) return false;
  if (!slots.bottom || slots.bottom.includes('XXX')) return false;
  return true;
}

function injectVerificationMeta() {
  const content = adsenseConfig.verificationMeta || adsenseConfig.clientId;
  if (!content || content.includes('XXXX')) return;

  if (document.querySelector('meta[name="google-adsense-account"]')) return;

  const meta = document.createElement('meta');
  meta.name = 'google-adsense-account';
  meta.content = content;
  document.head.appendChild(meta);
}

function loadAdSenseScript() {
  if (document.querySelector('script[data-adsense-loader]')) return;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseConfig.clientId}`;
  script.crossOrigin = 'anonymous';
  script.dataset.adsenseLoader = 'true';
  document.head.appendChild(script);
}

function renderAdUnits() {
  document.querySelectorAll('.ad-slot[data-ad-slot-key]').forEach((slot) => {
    const key = slot.dataset.adSlotKey;
    const slotId = adsenseConfig.slots[key];
    if (!slotId || slotId.includes('XXX')) return;

    slot.hidden = false;
    slot.innerHTML = '';

    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.dataset.adClient = adsenseConfig.clientId;
    ins.dataset.adSlot = slotId;
    ins.dataset.adFormat = 'auto';
    ins.dataset.fullWidthResponsive = 'true';
    slot.appendChild(ins);

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* script still loading */
    }
  });
}

function showConsentBanner() {
  if (localStorage.getItem(CONSENT_KEY)) return;
  if (document.getElementById('cookie-consent')) return;

  const banner = document.createElement('div');
  banner.id = 'cookie-consent';
  banner.className = 'cookie-consent';
  banner.innerHTML = `
    <p>
      We use cookies for analytics and ads (Google AdSense) to keep Clip2GIF free.
      See our <a href="/privacy.html">Privacy Policy</a>.
    </p>
    <div class="cookie-consent-actions">
      <button type="button" class="btn btn-secondary" id="cookie-decline">Decline</button>
      <button type="button" class="btn btn-primary" id="cookie-accept">Accept</button>
    </div>
  `;
  document.body.appendChild(banner);

  banner.querySelector('#cookie-accept').addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    banner.remove();
    activateAds();
  });

  banner.querySelector('#cookie-decline').addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'declined');
    banner.remove();
  });
}

function activateAds() {
  if (!hasValidConfig()) return;
  if (localStorage.getItem(CONSENT_KEY) !== 'accepted') return;

  loadAdSenseScript();
  renderAdUnits();
}

export function initAds() {
  injectVerificationMeta();

  if (!hasValidConfig()) return;

  const consent = localStorage.getItem(CONSENT_KEY);
  if (consent === 'accepted') {
    activateAds();
  } else if (!consent) {
    showConsentBanner();
  }
}
