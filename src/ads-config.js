/**
 * Google AdSense configuration
 * ─────────────────────────────
 * 1. Apply at https://www.google.com/adsense
 * 2. Replace clientId with your ca-pub-XXXXXXXXXXXXXXXX
 * 3. Create ad units in AdSense → paste slot IDs below
 * 4. Set enabled: true and redeploy
 *
 * See ADSENSE.md in the repo for the full walkthrough.
 */
export const adsenseConfig = {
  /** Flip to true only AFTER AdSense approves your site */
  enabled: false,

  /** Your publisher ID, e.g. ca-pub-1234567890123456 */
  clientId: 'ca-pub-XXXXXXXXXXXXXXXX',

  /**
   * Optional — paste during AdSense site verification if Google asks for a meta tag.
   * Usually the same value as clientId.
   */
  verificationMeta: '',

  /** Ad unit slot IDs from AdSense dashboard (Ads → By ad unit) */
  slots: {
    /** Responsive display ad below the hero text */
    top: 'XXXXXXXXXX',
    /** Responsive display ad below the converter */
    bottom: 'XXXXXXXXXX',
  },
};

/** Public site URL — update when you add a custom domain */
export const siteUrl = 'https://clip2gif.pages.dev';
