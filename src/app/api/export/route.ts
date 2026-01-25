import { NextRequest, NextResponse } from 'next/server';
import { getScraper, type ScrapedContent } from '@/lib/scraper';
import { NoCodeProcessor, type Platform } from '@/lib/processor';
import AdmZip from 'adm-zip';

export const maxDuration = 10; // 10 second limit for Vercel free tier

interface ExportRequest {
  url: string;
  format: 'html' | 'zip';
  platform?: Platform;
  options?: {
    removeWatermark?: boolean;
    removeRedirects?: boolean;
    removeAnalytics?: boolean;
    inlineAssets?: boolean;
  };
}

interface ExportResult {
  success: boolean;
  html?: string;
  filename?: string;
  size?: number;
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
  const scraper = getScraper();

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

    // Scrape the website
    let scrapedContent: ScrapedContent;
    try {
      scrapedContent = await scraper.scrape(body.url);
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
      inlineCss: body.options?.inlineAssets ?? false,
    });

    // Generate filename
    const sanitizedTitle = scrapedContent.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const baseFilename = sanitizedTitle || 'export';

    if (format === 'html') {
      // Return single HTML file
      return NextResponse.json(
        {
          success: true,
          html: processedHtml,
          filename: `${baseFilename}.html`,
          size: processedHtml.length,
        },
        { headers: corsHeaders }
      );
    } else {
      // Create ZIP with assets
      const zip = new AdmZip();

      // Add main HTML file
      zip.addFile('index.html', Buffer.from(processedHtml, 'utf-8'));

      // Add assets if inlineAssets is enabled
      if (body.options?.inlineAssets) {
        const assetsDir = 'assets';
        for (const asset of scrapedContent.assets) {
          try {
            const assetBuffer = await scraper.downloadAsset(asset.url);
            const filename = asset.url.split('/').pop() || `asset-${Date.now()}`;
            zip.addFile(`${assetsDir}/${filename}`, assetBuffer);
          } catch {
            // Skip failed assets
            console.warn(`Failed to download asset: ${asset.url}`);
          }
        }
      }

      const zipBuffer = zip.toBuffer();

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
    // Always close the browser in serverless environments to free resources
    await scraper.close();
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
