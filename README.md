# nocodeexport

> Because "Made with Framer" badges are annoying and you paid for that domain.

Export clean HTML from no-code platforms. Strip watermarks, kill redirects, delete analytics.

## What it does

You built your site on Framer/Wix/Webflow. Now you want the HTML. This tool grabs it and removes the annoying stuff:

| Platform | What gets removed |
|----------|-------------------|
| **Framer** | "Made in Framer" badge, redirect scripts, Framer metadata, analytics |
| **Wix** | Wix ads, free site banners, Wix branding, tracking scripts |
| **Webflow** | Basic cleanup (full support TODO) |
| **Carrd** | Basic cleanup (full support TODO) |

## How to use

```
1. Go to https://nocodeexport-nine.vercel.app
2. Paste your URL
3. Choose format: Single HTML or ZIP with assets
4. Click export
5. Done
```

## Running locally

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## How it works

1. Scrapes your site using Puppeteer (headless Chrome) or Cheerio (lightweight mode)
2. Detects platform automatically (URL patterns + HTML heuristics)
3. Removes watermarks, badges, redirect scripts, analytics
4. Converts relative URLs to absolute
5. Returns clean HTML or ZIP with assets

## Known issues / limitations

- **Vercel free tier**: Max 10s execution, 4.5MB response. Large sites may timeout.
- **Wix sites**: Heavy JS loads slowly. May timeout on complex sites.
- **Platform updates**: This is a hacky cat-and-mouse game. Platforms change their obfuscation, stuff breaks.
- **Zipped assets**: Limited to 20 assets in ZIP mode to avoid timeouts.

## Tech stack

- **Next.js 16** + React 19
- **Puppeteer** (@sparticuz/chromium for Vercel)
- **Cheerio** for lightweight scraping (no JS rendering)
- **Tailwind CSS** + shadcn/ui

## Why I built this

No-code platforms are great until you want to leave. Official export features are either missing or cost money. This is my "screw that" solution.

## License

MIT

---

**Note**: This is for personal/experimental use. Don't rely on it for mission-critical stuff. Platforms will break it eventually.
