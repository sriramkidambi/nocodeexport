import { NextRequest, NextResponse } from 'next/server';
import { createScraper, type ScrapedContent, type ScraperOptions } from '@/lib/scraper';
import { NoCodeProcessor, type Platform } from '@/lib/processor';
import AdmZip from 'adm-zip';

export const maxDuration = 8; // Vercel free tier safe margin (10s limit)

interface ExportRequest {
  url: string;
  format: 'html' | 'zip';
  platform?: Platform;
  options?: {
    removeWatermark?: boolean;
    removeRedirects?: boolean;
    removeAnalytics?: boolean;
    inlineAssets?: boolean;
    usePuppeteer?: boolean; // New option for lightweight mode
  };
}

interface ExportResult {
  success: boolean;
  html?: string;
  filename?: string;
  size?: number;
  mode?: 'puppeteer' | 'cheerio'; // Track which mode was used
  error?: string;
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
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

    const format = body.format || 'html';
    const usePuppeteer = body.options?.usePuppeteer ?? true;

    // Determine scraper options based on format and tier
    const scraperOptions: ScraperOptions = {
      usePuppeteer: format === 'zip' ? true : usePuppeteer, // Force Puppeteer for ZIP exports
      timeout: 6000, // Conservative timeout for free tier
      maxAssets: format === 'zip' ? 100 : 50, // More assets for ZIP
    };

    // Scrape the website
    let scrapedContent: ScrapedContent;
    try {
      scrapedContent = await scraper.scrape(body.url, scraperOptions);
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
      // Return single HTML file
      return NextResponse.json(
        {
          success: true,
          html: processedHtml,
          filename: `${baseFilename}.html`,
          size: processedHtml.length,
          mode: scraperOptions.usePuppeteer ? 'puppeteer' : 'cheerio',
        },
        { headers: corsHeaders }
      );
    } else {
      // Create ZIP with assets (only if requested)
      const zip = new AdmZip();

      // Add main HTML file
      zip.addFile('index.html', Buffer.from(processedHtml, 'utf-8'));

      // Add assets if inlineAssets is enabled (limited to prevent timeout)
      if (body.options?.inlineAssets && scrapedContent.assets.length > 0) {
        const assetsDir = 'assets';
        const assetsToDownload = scrapedContent.assets.slice(0, 20); // Limit for free tier

        // Download assets in parallel with timeout
        const downloadPromises = assetsToDownload.map(async (asset) => {
          try {
            const assetBuffer = await scraper.downloadAsset(asset.url);
            const filename = asset.url.split('/').pop()?.split('?')[0] || `asset-${Date.now()}`;
            return { filename, buffer: assetBuffer, success: true };
          } catch {
            return { success: false };
          }
        });

        const results = await Promise.allSettled(downloadPromises);

        results.forEach((result, index) => {
          if (result.status === 'fulfilled' && result.value.success) {
            const { filename, buffer } = result.value;
            zip.addFile(`${assetsDir}/${filename}`, buffer);
          }
        });
      }

      const zipBuffer = zip.toBuffer();

      // Check ZIP size (Vercel limit is 4.5MB for response body)
      if (zipBuffer.length > 4.5 * 1024 * 1024) {
        return NextResponse.json(
          {
            success: false,
            error: 'Export too large for free tier. Try HTML-only format or reduce assets.',
          },
          { status: 413, headers: corsHeaders }
        );
      }

      // Return ZIP file - convert Buffer to Uint8Array for NextResponse
      return new Response(new Uint8Array(zipBuffer), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${baseFilename}.zip"`,
          'Content-Length': zipBuffer.length.toString(),
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
