import { NextRequest, NextResponse } from 'next/server';
import { createScraper, type ScrapedContent, type ScraperOptions } from '@/lib/scraper';
import { NoCodeProcessor, type Platform } from '@/lib/processor';
import AdmZip from 'adm-zip';

export const maxDuration = 8; // Vercel free tier safe margin (10s limit)

// Rate limiting store: IP -> { count, resetTime }
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // 5 requests per minute per IP

// Request deduplication store: key -> Promise<ScrapedContent>
const pendingScrapes = new Map<string, Promise<ScrapedContent>>();

interface ExportRequest {
  url: string;
  format: 'html' | 'zip';
  platform?: Platform;
  options?: {
    removeWatermark?: boolean;
    removeRedirects?: boolean;
    removeAnalytics?: boolean;
    inlineAssets?: boolean;
    usePuppeteer?: boolean;
  };
}

interface ExportResult {
  success: boolean;
  html?: string;
  filename?: string;
  size?: number;
  mode?: 'puppeteer' | 'cheerio';
  error?: string;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Rate limiting helper
function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    // New window or expired
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, resetTime: now + RATE_LIMIT_WINDOW };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0, resetTime: record.resetTime };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count, resetTime: record.resetTime };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(ip);
    }
  }
}, 60000); // Clean every minute

// Request deduplication helper
function getDedupeKey(url: string, options: ScraperOptions): string {
  return `${url}-${options.usePuppeteer}-${options.platformHint}-${options.maxAssets}`;
}

async function scrapeWithDedupe(
  scraper: ReturnType<typeof createScraper>,
  url: string,
  options: ScraperOptions
): Promise<ScrapedContent> {
  const key = getDedupeKey(url, options);

  // Check if there's already a pending request for this URL with same options
  const pending = pendingScrapes.get(key);
  if (pending) {
    console.log(`[DEDUPE] Reusing pending scrape for ${url}`);
    return pending;
  }

  // Create new scrape promise
  const scrapePromise = scraper.scrape(url, options).finally(() => {
    // Remove from pending after completion/error
    pendingScrapes.delete(key);
  });

  // Store in pending map
  pendingScrapes.set(key, scrapePromise);

  return scrapePromise;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  // Get client IP for rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             request.headers.get('x-real-ip') ||
             'unknown';

  // Check rate limit
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    const retryAfter = Math.ceil((rateLimit.resetTime - Date.now()) / 1000);
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Please try again later.' },
      { 
        status: 429, 
        headers: {
          ...corsHeaders,
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetTime / 1000)),
          'Retry-After': String(retryAfter),
        }
      }
    );
  }

  const scraper = createScraper();

  try {
    const body: ExportRequest = await request.json();

    // Validate URL
    if (!body.url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate URL format
    try {
      new URL(body.url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Additional URL security checks
    const urlObj = new URL(body.url);
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]'];
    const hostname = urlObj.hostname.toLowerCase();
    
    if (blockedHosts.includes(hostname) || 
        hostname.startsWith('10.') || 
        hostname.startsWith('192.168.') ||
        hostname.startsWith('172.') ||
        body.url.startsWith('data:') ||
        body.url.startsWith('file:')) {
      return NextResponse.json(
        { success: false, error: 'URL not allowed' },
        { status: 403, headers: corsHeaders }
      );
    }

    // Limit URL length
    if (body.url.length > 2000) {
      return NextResponse.json(
        { success: false, error: 'URL too long' },
        { status: 400, headers: corsHeaders }
      );
    }

    const format = body.format || 'html';
    const usePuppeteer = body.options?.usePuppeteer ?? true;
    const platformHint = body.platform ?? detectPlatformFromUrl(body.url);

    // Determine scraper options based on format and tier
    const scraperOptions: ScraperOptions = {
      usePuppeteer: format === 'zip' ? true : usePuppeteer,
      timeout: platformHint === 'wix' ? 7500 : 6000,
      maxAssets: format === 'zip' ? 20 : 50, // Lower limit for ZIP to avoid timeouts
      platformHint,
    };

    // Scrape the website with deduplication
    let scrapedContent: ScrapedContent;
    try {
      scrapedContent = await scrapeWithDedupe(scraper, body.url, scraperOptions);
    } catch (error) {
      console.error('Scraping error:', error);
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to scrape website',
        },
        { status: 500, headers: corsHeaders }
      );
    }

    // Process the HTML to remove unwanted elements
    const processor = new NoCodeProcessor(scrapedContent.html, scrapedContent.url);
    const processedHtml = processor.process({
      platform: body.platform ?? 'auto',
      removeWatermark: body.options?.removeWatermark ?? true,
      removeRedirects: body.options?.removeRedirects ?? true,
      removeAnalytics: body.options?.removeAnalytics ?? true,
      inlineCss: false, // Disable for performance
    });

    // Generate filename
    const sanitizedTitle = scrapedContent.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50); // Limit length
    const baseFilename = sanitizedTitle || 'export';

    if (format === 'html') {
      // Return single HTML file with rate limit headers
      return NextResponse.json(
        {
          success: true,
          html: processedHtml,
          filename: `${baseFilename}.html`,
          size: processedHtml.length,
          mode: scraperOptions.usePuppeteer ? 'puppeteer' : 'cheerio',
        },
        { 
          headers: {
            ...corsHeaders,
            'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
            'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetTime / 1000)),
          }
        }
      );
    } else {
      // Create ZIP with assets (only if requested)
      const zip = new AdmZip();

      // Add main HTML file
      zip.addFile('index.html', Buffer.from(processedHtml, 'utf-8'));

      // Add assets if inlineAssets is enabled (limited to prevent timeout)
      let assetsAdded = 0;
      if (body.options?.inlineAssets && scrapedContent.assets.length > 0) {
        const assetsDir = 'assets';
        const assetsToDownload = scrapedContent.assets.slice(0, 15); // Lower limit for stability

        // Download assets in parallel with timeout
        const downloadPromises = assetsToDownload.map(async (asset) => {
          try {
            const assetBuffer = await scraper.downloadAsset(asset.url);
            const filename = asset.url.split('/').pop()?.split('?')[0] || `asset-${Date.now()}`;
            return { filename, buffer: assetBuffer, success: true, url: asset.url };
          } catch {
            return { success: false, url: asset.url };
          }
        });

        const results = await Promise.allSettled(downloadPromises);

        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value.success) {
            const { filename, buffer } = result.value;
            if (buffer) {
              zip.addFile(`${assetsDir}/${filename}`, buffer);
              assetsAdded++;
            }
          } else if (result.status === 'fulfilled') {
            console.log(`[ASSET] Failed to download: ${result.value.url}`);
          }
        });
      }

      const zipBuffer = zip.toBuffer();

      // Check ZIP size (Vercel limit is 4.5MB for response body)
      if (zipBuffer.length > 4.5 * 1024 * 1024) {
        // Fallback to HTML-only if ZIP too large
        return NextResponse.json(
          {
            success: true,
            html: processedHtml,
            filename: `${baseFilename}.html`,
            size: processedHtml.length,
            mode: scraperOptions.usePuppeteer ? 'puppeteer' : 'cheerio',
            warning: 'ZIP too large, returned HTML only. Some assets may be missing.',
          },
          { 
            status: 200,
            headers: {
              ...corsHeaders,
              'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
              'X-RateLimit-Remaining': String(rateLimit.remaining),
              'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetTime / 1000)),
            }
          }
        );
      }

      // Return ZIP file - convert Buffer to Uint8Array for NextResponse
      return new Response(new Uint8Array(zipBuffer), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${baseFilename}.zip"`,
          'Content-Length': zipBuffer.length.toString(),
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetTime / 1000)),
        },
      });
    }
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500, headers: corsHeaders }
    );
  } finally {
    // Always clean up scraper resources
    await scraper.close().catch(() => {});
  }
}

// Helper to detect platform from URL
function detectPlatformFromUrl(url: string): Platform {
  const urlObj = new URL(url);
  const hostname = urlObj.hostname.toLowerCase();

  // Framer detection
  if (hostname.includes('framer.website') ||
      hostname.includes('framer.com') ||
      hostname.includes('.framer.')) {
    return 'framer';
  }

  // Wix detection
  if (hostname.includes('wix.com') ||
      hostname.includes('wixsite.com') ||
      hostname.includes('wixstudio.io') ||
      hostname.includes('editorx.io')) {
    return 'wix';
  }

  // Webflow detection
  if (hostname.includes('webflow.io')) {
    return 'webflow';
  }

  // Carrd detection
  if (hostname.includes('carrd.co')) {
    return 'carrd';
  }

  return 'auto';
}
