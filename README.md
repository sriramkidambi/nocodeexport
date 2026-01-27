# NOCODEEXPORT

> Break free from no-code platform lock-in. Export clean, self-contained HTML from your no-code websites.

[Live App](https://nocodeexport-nine.vercel.app/) | [GitHub Repository](https://github.com/sriramkidambi/nocodeexport)

NOCODEEXPORT extracts websites built with popular no-code platforms and produces clean HTML exports by removing watermarks, redirect scripts, analytics, and platform-specific branding.

## Supported Platforms

- **Framer** - Remove Framer watermarks and redirect scripts
- **Wix** - Strip Wix ads and branding
- **Webflow** - Clean Webflow exports
- **Carrd** - Export Carrd sites without restrictions

## Features

- **Clean HTML Output** - Get self-contained HTML files free from platform watermarks and badges
- **ZIP Package Export** - Download complete packages with all assets (images, stylesheets, fonts)
- **Automatic Platform Detection** - Automatically detects the platform from URL
- **Manual Selection** - Choose the platform manually for better control
- **Asset Management** - Downloads and packages all external assets
- **Link Cleanup** - Converts relative URLs to absolute URLs
- **Privacy-Focused** - Removes analytics and tracking scripts

## How It Works

1. Provide your website URL
2. Select the output format (Single HTML or ZIP Package)
3. The tool renders the page using a headless browser
4. Watermarks, redirects, and tracking scripts are removed
5. Get your clean, exportable HTML

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, pnpm, or bun

### Installation

```bash
# Install dependencies
npm install
# or
yarn install
# or
pnpm install
```

### Development

```bash
# Run the development server
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Project Structure

```
src/
├── app/
│   ├── api/export/route.ts    # Main API endpoint
│   ├── layout.tsx             # Root layout
│   ├── page.tsx               # Main UI component
│   └── globals.css           # Global styles
├── components/
│   └── ui/                   # Shadcn UI components
└── lib/
    ├── processor.ts          # HTML processing logic
    ├── scraper.ts            # Web scraping functionality
    └── utils.ts              # Utility functions
```

## Tech Stack

- **Next.js 16** - React framework
- **React 19** - UI library
- **Tailwind CSS** - Styling
- **Puppeteer** - Headless browser automation
- **Cheerio** - HTML parsing and manipulation
- **Adm-Zip** - ZIP file creation

## Disclaimer

> This is a hacky solution for personal and experimental use only. The tool may break as platforms update their code. It is not recommended for production workloads. For mission-critical sites, please use official export features provided by the platforms.

## License

MIT
