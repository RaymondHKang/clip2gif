# Deploy & AdSense setup guide

Your site is live at **https://clip2gif.pages.dev/**

---

## Part 1 — Deployment (Cloudflare Pages)

### Already done
- Site hosted on Cloudflare Pages (`clip2gif` project)
- Code on GitHub: https://github.com/RaymondHKang/clip2gif

### Enable auto-deploy on every push (recommended)

1. **Create a Cloudflare API token**
   - Open https://dash.cloudflare.com/profile/api-tokens
   - **Create Token** → use template **Edit Cloudflare Workers**
   - Under Permissions, ensure **Account → Cloudflare Pages → Edit**
   - Create and copy the token

2. **Add GitHub secrets**
   - Open https://github.com/RaymondHKang/clip2gif/settings/secrets/actions
   - Add `CLOUDFLARE_API_TOKEN` → paste your token
   - Add `CLOUDFLARE_ACCOUNT_ID` → `2b85ebcfc01f6e31c9db513a9cbdcc90`

3. **Push to deploy** — every push to `master` runs the GitHub Action and updates the site.

### Manual deploy (alternative)

```powershell
cd C:\Users\raymo\Projects\clip2gif
npm run build
npx wrangler pages deploy dist --project-name=clip2gif
```

### Add a custom domain (strongly recommended for AdSense)

AdSense approval is much easier with your own domain (e.g. `clip2gif.com`).

1. Buy a domain (Cloudflare Registrar, Namecheap, or Porkbun — ~$10–15/year)
2. Cloudflare Dashboard → **Workers & Pages** → **clip2gif** → **Custom domains** → **Set up a domain**
3. Follow the DNS prompts (easiest if the domain is on Cloudflare nameservers)
4. Update these files with your real domain:
   - `src/ads-config.js` → `siteUrl`
   - `public/robots.txt` → Sitemap URL
   - `public/sitemap.xml` → all `<loc>` URLs
   - `privacy.html` and `terms.html` → contact emails
5. Redeploy

---

## Part 2 — Google AdSense

### Before you apply

Google requires a **real, public site** with original content and legal pages. You already have:

- Working tool (video → GIF converter)
- Privacy Policy (`/privacy.html`)
- Terms of Service (`/terms.html`)
- `ads.txt` placeholder at `/ads.txt`

**Tips that help approval:**
- Use a **custom domain** (not just `.pages.dev`)
- Add a bit more content over time (FAQ, how-to) — optional but helpful
- Make sure Privacy and Terms links work from the footer
- Site must have some traffic (share on Reddit, Product Hunt, etc.)

### Step 1 — Sign up

1. Go to https://www.google.com/adsense
2. Sign in with your Google account
3. **Add site** → enter your URL (`https://clip2gif.pages.dev` or your custom domain)
4. Choose your country and accept terms

### Step 2 — Verify site ownership

Google may ask you to verify. Options:

**Option A — Meta tag (easiest with this project)**

1. Copy your `ca-pub-XXXXXXXXXXXXXXXX` ID from AdSense
2. Edit `src/ads-config.js`:
   ```js
   verificationMeta: 'ca-pub-XXXXXXXXXXXXXXXX',
   ```
3. Deploy the site
4. Click **Verify** in AdSense

**Option B — DNS TXT record** (if using custom domain on Cloudflare)

Add the TXT record Google gives you in Cloudflare DNS.

**Option C — ads.txt**

1. Edit `public/ads.txt`:
   ```
   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
   ```
   (Replace `pub-XXXXXXXXXXXXXXXX` with your publisher ID, keeping the `pub-` prefix in the file as Google specifies)
2. Deploy — file must be at `https://yoursite.com/ads.txt`

### Step 3 — Wait for review

Review usually takes **a few days to 2 weeks**. Google will email you when approved or if changes are needed.

Do **not** enable ads (`enabled: true`) until you are approved.

### Step 4 — Create ad units (after approval)

1. AdSense → **Ads** → **By ad unit** → **Display ads**
2. Create two **responsive** display units, e.g.:
   - `Clip2GIF - Top` (horizontal)
   - `Clip2GIF - Bottom` (rectangle)
3. Copy each unit’s **data-ad-slot** ID (numeric string)

### Step 5 — Turn on ads in the code

Edit `src/ads-config.js`:

```js
export const adsenseConfig = {
  enabled: true,
  clientId: 'ca-pub-1234567890123456',
  verificationMeta: 'ca-pub-1234567890123456',
  slots: {
    top: '1234567890',
    bottom: '0987654321',
  },
};
```

Update `public/ads.txt` with your real publisher line, then deploy:

```powershell
npm run build
npx wrangler pages deploy dist --project-name=clip2gif
```

Ads appear below the hero and below the converter. EU/UK visitors see a cookie consent banner first.

### Step 6 — Search Console (recommended)

1. https://search.google.com/search-console
2. Add your property (domain or URL prefix)
3. Submit sitemap: `https://yoursite.com/sitemap.xml`

This helps Google index your site and can support AdSense long-term.

---

## Revenue expectations

Utility sites typically earn **$1–8 RPM** (dollars per 1,000 pageviews). Meaningful income needs steady traffic from SEO (“video to gif”, “mp4 to gif”) and sharing.

---

## Checklist

- [ ] GitHub Actions secrets configured (auto-deploy)
- [ ] Custom domain connected (recommended)
- [ ] `siteUrl`, `robots.txt`, `sitemap.xml` updated for domain
- [ ] AdSense application submitted
- [ ] `ads.txt` updated with publisher ID
- [ ] AdSense approved → `ads-config.js` updated → `enabled: true` → redeploy
- [ ] Search Console sitemap submitted
