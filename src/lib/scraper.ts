import puppeteer, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Platform } from './processor';

export interface ScrapedContent {
  html: string;
  url: string;
  title: string;
  assets: Asset[];
}

export interface Asset {
  type: 'image' | 'stylesheet' | 'script' | 'font';
  url: string;
  content?: string;
  localPath?: string;
}

export interface ScraperOptions {
  usePuppeteer?: boolean;
  timeout?: number;
  maxAssets?: number;
  platformHint?: Platform;
}

// Simple in-memory cache for same-container requests
interface CacheEntry {
  data: ScrapedContent;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export class NoCodeScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private browserInitializing: boolean = false;
  private requestCount: number = 0;
  private readonly MAX_REQUESTS_PER_BROWSER = 10; // Recreate browser after N requests to prevent memory leaks

  async initialize(): Promise<void> {
    if (this.browser) {
      this.requestCount++;
      return;
    }

    if (this.browserInitializing) {
      // Wait for initialization to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.initialize();
    }

    this.browserInitializing = true;

    try {
      // Use @sparticuz/chromium for serverless environments (Vercel)
      const executablePath = await chromium.executablePath();

      this.browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
        executablePath,
        headless: true,
      });

      this.page = await this.browser.newPage();

      // Set user agent to avoid bot detection
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Block unnecessary resources for faster loading
      await this.page.setRequestInterception(true);
      this.page.on('request', (req) => {
        const resourceType = req.resourceType();
        const url = req.url();

        // Block tracking, analytics, and unnecessary resources
        if (
          url.includes('analytics') ||
          url.includes('tracking') ||
          url.includes('gtm') ||
          url.includes('gtag') ||
          url.includes('facebook.net') ||
          url.includes('fbq') ||
          url.includes('hotjar') ||
          url.includes('mixpanel') ||
          resourceType === 'media' ||
          resourceType === 'websocket'
        ) {
          req.abort();
        } else {
          req.continue();
        }
      });

      this.requestCount = 1;
      this.browserInitializing = false;
    } catch (error) {
      this.browserInitializing = false;
      throw error;
    }
  }

  private async recreateBrowserIfNeeded(): Promise<void> {
    if (this.requestCount >= this.MAX_REQUESTS_PER_BROWSER) {
      await this.close();
      await this.initialize();
    }
  }

  async scrape(url: string, options: ScraperOptions = {}): Promise<ScrapedContent> {
    const {
      usePuppeteer = true,
      timeout = 8000, // Vercel free tier safe margin (10s limit)
      maxAssets = 50, // Limit assets to prevent memory issues
    } = options;

    // Check cache first
    const cacheKey = `${url}-${usePuppeteer}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    // Try lightweight scraping first with cheerio (no JS rendering)
    let scrapedContent: ScrapedContent;

    const isWixSite = options.platformHint === 'wix' ||
      /wixsite\.com|\.wix\.com|wixstudio\.io|editorx\.io/.test(this.normalizeUrl(url));

    if (!usePuppeteer && !isWixSite) {
      scrapedContent = await this.scrapeWithCheerio(url, maxAssets, options.platformHint);
    } else if (!usePuppeteer && isWixSite) {
      // Wix requires JS rendering; try cheerio first, auto-fallback to Puppeteer
      try {
        scrapedContent = await this.scrapeWithCheerio(url, maxAssets, options.platformHint);
      } catch {
        await this.initialize();
        await this.recreateBrowserIfNeeded();
        if (!this.page) throw new Error('Failed to initialize browser');
        scrapedContent = await this.scrapeWithPuppeteer(url, options);
      }
    } else {
      await this.initialize();
      await this.recreateBrowserIfNeeded();
      if (!this.page) throw new Error('Failed to initialize browser');
      scrapedContent = await this.scrapeWithPuppeteer(url, options);
    }

    // Cache the result
    cache.set(cacheKey, {
      data: scrapedContent,
      timestamp: Date.now(),
    });

    // Clean up old cache entries
    this.cleanupCache();

    return scrapedContent;
  }

  // Lightweight scraping without JS rendering (much faster)
  private async scrapeWithCheerio(url: string, maxAssets: number, platformHint?: Platform): Promise<ScrapedContent> {
    const normalizedUrl = this.normalizeUrl(url);
    const isWix = platformHint === 'wix' || /wixsite\.com|\.wix\.com|wixstudio\.io|editorx\.io/.test(normalizedUrl);

    try {
      const response = await axios.get(normalizedUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Dest': 'document',
        },
        maxRedirects: 5,
        validateStatus: (s: number) => s >= 200 && s < 500,
      });

      const bodyText = String(response.data ?? '');

      // Detect bot blocking
      const looksBlocked =
        response.status === 403 || response.status === 429 ||
        /captcha|bot.detection|access.denied|unusual.traffic/i.test(bodyText) ||
        (isWix && bodyText.length < 5000);

      if (looksBlocked) {
        throw new Error(`Site returned blocked response (status ${response.status}); retry with Puppeteer`);
      }

      const $ = cheerio.load(bodyText);
      const title = $('title').text() || 'untitled';
      const assets: Asset[] = [];

      // Extract images (including Wix lazy-loaded)
      $('img').each((_, el) => {
        if (assets.length >= maxAssets) return false;
        const src = $(el).attr('src');
        const dataSrc = $(el).attr('data-src') || $(el).attr('data-image-src');
        let imgUrl = src;
        if ((!imgUrl || imgUrl.startsWith('data:')) && dataSrc) {
          imgUrl = dataSrc;
        }
        if (imgUrl) {
          imgUrl = this.normalizeWixAssetUrl(imgUrl);
          if (imgUrl && !imgUrl.startsWith('data:')) {
            assets.push({ type: 'image', url: imgUrl });
          }
        }
        return true;
      });

      // Extract stylesheets
      $('link[rel="stylesheet"]').each((_, el) => {
        if (assets.length >= maxAssets) return false;
        const href = $(el).attr('href');
        if (href) {
          assets.push({ type: 'stylesheet', url: href });
        }
        return true;
      });

      return {
        html: $.html(),
        url: normalizedUrl,
        title,
        assets,
      };
    } catch (error) {
      throw new Error(`Failed to scrape ${normalizedUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async scrapeWithPuppeteer(url: string, options: ScraperOptions): Promise<ScrapedContent> {
    const { timeout = 8000, maxAssets = 50 } = options;
    const normalizedUrl = this.normalizeUrl(url);

    if (!this.page) throw new Error('Browser page not initialized');

    const isWix = options.platformHint === 'wix' ||
      /wixsite\.com|\.wix\.com|wixstudio\.io|editorx\.io/.test(normalizedUrl);

    await this.page.goto(normalizedUrl, {
      waitUntil: isWix ? 'networkidle2' : 'domcontentloaded',
      timeout,
    });

    if (isWix) {
      await this.page.waitForSelector('#SITE_CONTAINER, #site-root, [id="SITE_CONTAINER"]', {
        timeout: Math.min(4000, timeout),
      }).catch(() => {});
      await this.page.waitForFunction(() => {
        const el = document.querySelector('#SITE_CONTAINER, #site-root') as HTMLElement | null;
        return !!el && (el.innerText || '').trim().length > 50;
      }, { timeout: Math.min(3000, timeout) }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const html = await this.page.content();
    const title = await this.page.title();
    const assets = await this.extractAssets(this.page, maxAssets);

    return { html, url: normalizedUrl, title, assets };
  }

  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Ensure protocol is https
      urlObj.protocol = 'https:';
      return urlObj.toString();
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  private async extractAssets(page: Page, maxAssets: number): Promise<Asset[]> {
    const assets: Asset[] = [];

    try {
      const extractedAssets = await page.evaluate((maxAssets: number) => {
        const results: any[] = [];
        const seen = new Set<string>();

        function addUrl(type: string, url: string) {
          if (!url || url.startsWith('data:') || url.startsWith('blob:') || seen.has(url) || results.length >= maxAssets) return;
          // Normalize wix:image:// URLs
          let normalized = url;
          if (url.startsWith('wix:image://v1/') || url.startsWith('wix:vector://v1/')) {
            const withoutScheme = url.replace(/^wix:(image|vector):\/\/v1\//, '');
            const path = withoutScheme.split('#')[0].split('?')[0];
            normalized = `https://static.wixstatic.com/media/${path}`;
          }
          if (seen.has(normalized)) return;
          seen.add(normalized);
          results.push({ type, url: normalized });
        }

        // Extract images - including Wix lazy-loaded variants
        document.querySelectorAll('img').forEach((img: any) => {
          addUrl('image', img.currentSrc || img.src);
          addUrl('image', img.getAttribute('data-src'));
          addUrl('image', img.getAttribute('data-pin-media'));
          addUrl('image', img.getAttribute('data-image-src'));

          const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
          if (srcset) {
            srcset.split(',').forEach((part: string) => {
              const u = part.trim().split(/\s+/)[0];
              if (u) addUrl('image', u);
            });
          }
        });

        // Extract background images from inline styles
        document.querySelectorAll<HTMLElement>('[style]').forEach(el => {
          const style = el.style.backgroundImage || el.getAttribute('style') || '';
          const matches = style.match(/url\(["']?([^"')]+)["']?\)/gi);
          if (matches) {
            matches.forEach(m => {
              const u = m.replace(/url\(["']?|["']?\)/gi, '');
              addUrl('image', u);
            });
          }
        });

        // Extract stylesheets
        if (results.length < maxAssets) {
          document.querySelectorAll('link[rel="stylesheet"]').forEach((link: any) => {
            addUrl('stylesheet', link.href);
          });
        }

        // Extract scripts (limited for performance)
        if (results.length < maxAssets) {
          document.querySelectorAll('script[src]').forEach((script: any) => {
            const url = script.src;
            if (url && !url.includes('analytics') && !url.includes('tracking') &&
                !url.includes('bi-module') && !url.includes('fedops') &&
                !url.includes('frog.wix.com')) {
              addUrl('script', url);
            }
          });
        }

        return results;
      }, maxAssets);

      assets.push(...extractedAssets);
    } catch (error) {
      console.warn('Failed to extract assets:', error);
    }

    return assets;
  }

  private normalizeWixAssetUrl(url: string): string {
    if (!url) return url;
    const u = url.trim();
    if (u.startsWith('wix:image://v1/') || u.startsWith('wix:vector://v1/')) {
      const withoutScheme = u.replace(/^wix:(image|vector):\/\/v1\//, '');
      const path = withoutScheme.split('#')[0].split('?')[0];
      return `https://static.wixstatic.com/media/${path}`;
    }
    return u;
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp > CACHE_TTL) {
        cache.delete(key);
      }
    }
  }

  async downloadAsset(url: string): Promise<Buffer> {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 3000, // Short timeout for assets
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      return Buffer.from(response.data);
    } catch {
      throw new Error(`Failed to download asset: ${url}`);
    }
  }

  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      this.requestCount = 0;
      this.browserInitializing = false;
    } catch (error) {
      // Force cleanup even if close fails
      this.page = null;
      this.browser = null;
      this.requestCount = 0;
      this.browserInitializing = false;
    }
  }

  // Static method to get instance (not singleton for serverless)
  static create(): NoCodeScraper {
    return new NoCodeScraper();
  }
}

// Factory function instead of singleton (better for serverless)
export function createScraper(): NoCodeScraper {
  return new NoCodeScraper();
}

// Legacy singleton support (deprecated for serverless)
let scraperInstance: NoCodeScraper | null = null;

export function getScraper(): NoCodeScraper {
  if (!scraperInstance) {
    scraperInstance = new NoCodeScraper();
  }
  return scraperInstance;
}
