# Clip2GIF

Free, privacy-first video-to-GIF converter. Everything runs in the browser — no server uploads, no accounts.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173

```bash
npm run build   # output in dist/
npm run preview # preview production build
```

## How it works

- **ffmpeg.wasm** converts video clips to GIF locally in the browser
- Users pick start/end times, width, and frame rate
- A two-pass palette method keeps GIF quality high while controlling file size
- Videos never leave the user's device (strong privacy story for users and AdSense reviewers)

## Hosting recommendation

| Provider | Cost | Why |
|----------|------|-----|
| **Cloudflare Pages** (recommended) | Free | Global CDN, easy custom domain, `_headers` file already included for ffmpeg.wasm |
| Vercel | Free tier | `vercel.json` included with required COOP/COEP headers |
| Netlify | Free tier | Add `_headers` from `public/` |

**Important:** ffmpeg.wasm requires these HTTP headers on every page:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Both `public/_headers` (Cloudflare/Netlify) and `vercel.json` are preconfigured.

### Deploy to Cloudflare Pages

1. Push this repo to GitHub
2. Cloudflare Dashboard → Pages → Create project → Connect GitHub
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Add custom domain (see Domain section below)
5. Headers from `public/_headers` deploy automatically

### Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Or connect the GitHub repo in the Vercel dashboard. `vercel.json` handles headers.

## Domain name

Register a descriptive domain for SEO and trust:

- **Namecheap**, **Cloudflare Registrar**, or **Porkbun** — ~$10–15/year for `.com`
- Good names: `clip2gif.com`, `videotogif.app`, `makeagif.online`
- Point DNS to your host (Cloudflare Pages gives you nameservers or a CNAME target)

Replace all `YOUR-DOMAIN.com` placeholders in:

- `public/robots.txt`
- `public/sitemap.xml`
- `privacy.html` and `terms.html` contact emails

## Google AdSense setup

AdSense approval requires a **real, live site** with original content, privacy policy, and terms — all included here.

### Before applying

1. Deploy the site on your custom domain (not localhost)
2. Replace `pub-XXXXXXXXXXXXXXXX` in `public/ads.txt` with your publisher ID (after signup)
3. Uncomment the AdSense script and ad units in `index.html`
4. Update contact emails in legal pages
5. Add 5–10 pages of helpful content over time (FAQ, how-to guides) — Google favors sites with substance beyond a single tool page
6. Ensure site is indexed: submit sitemap in [Google Search Console](https://search.google.com/search-console)

### Apply for AdSense

1. Go to [google.com/adsense](https://www.google.com/adsense)
2. Add your site URL
3. Verify ownership (HTML tag or DNS)
4. Wait for review (days to 2 weeks)

### After approval

1. Create ad units in AdSense dashboard (display, responsive)
2. Paste your `data-ad-client` and `data-ad-slot` values into `index.html`
3. Uncomment the `<ins class="adsbygoogle">` blocks
4. Ad placements included:
   - Top leaderboard (mobile + desktop)
   - Left/right sidebar (desktop only, 160px columns)
   - In-content rectangle below the converter

### EU/UK cookie consent

If you serve EU visitors, add a cookie consent banner (e.g. [CookieYes](https://www.cookieyes.com/) free tier or [Klaro](https://klaro.org/)) before AdSense loads non-essential cookies.

## Revenue expectations

Utility sites like converters earn roughly **$1–8 RPM** (revenue per 1,000 pageviews) depending on traffic geography and ad placement. To earn meaningfully:

- Target SEO keywords: "video to gif", "convert mp4 to gif", "trim video gif"
- Share on Reddit, Product Hunt, tool directories (AlternativeTo, SaaSHub)
- Keep load times fast (static hosting helps)
- Add FAQ content for long-tail search

## Project structure

```
clip2gif/
├── index.html          # Main converter page + ad slots
├── privacy.html        # Required for AdSense
├── terms.html          # Required for AdSense
├── src/
│   ├── main.js         # UI logic
│   ├── converter.js    # ffmpeg.wasm conversion
│   └── styles.css      # All styles
├── public/
│   ├── _headers        # COOP/COEP for Cloudflare/Netlify
│   ├── ads.txt         # AdSense ads.txt
│   ├── robots.txt
│   └── sitemap.xml
└── vercel.json         # Headers for Vercel
```

## Limitations

- First conversion downloads ~25 MB of ffmpeg WASM (cached afterward)
- Large clips (>30 s) or high FPS produce big GIFs — the UI warns at 30 s
- Very old browsers without WebAssembly are unsupported
- Mobile works but large videos may be slow on low-end phones

## License

MIT — use freely for your own monetized site.
