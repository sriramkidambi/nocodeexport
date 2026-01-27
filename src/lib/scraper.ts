import puppeteer, { Browser, Page } from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';

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
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-first-run',
          '--no-zygote',
          '--single-process', // Run in single process for serverless
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
          '--disable-breakpad',
          '--disable-component-update',
        ],
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

    if (!usePuppeteer) {
      // Fast path: cheerio-only scraping (no JS rendering)
      scrapedContent = await this.scrapeWithCheerio(url, maxAssets);
    } else {
      // Full rendering with Puppeteer
      await this.initialize();
      await this.recreateBrowserIfNeeded();

      if (!this.page) {
        throw new Error('Failed to initialize browser');
      }

      // Normalize URL
      const normalizedUrl = this.normalizeUrl(url);

      try {
        // Navigate to the page with timeout optimized for Vercel
        await this.page.goto(normalizedUrl, {
          waitUntil: 'domcontentloaded', // Faster than networkidle0
          timeout,
        });

        // Reduced wait time for Vercel free tier
        await new Promise(resolve => setTimeout(resolve, 500));

        // Get the rendered HTML
        const html = await this.page.content();
        const title = await this.page.title();

        // Extract limited assets to prevent memory issues
        const assets = await this.extractAssets(this.page, maxAssets);

        scrapedContent = {
          html,
          url: normalizedUrl,
          title,
          assets,
        };
      } catch (error) {
        // Fallback to cheerio if Puppeteer fails
        console.warn('Puppeteer scraping failed, falling back to cheerio:', error);
        scrapedContent = await this.scrapeWithCheerio(url, maxAssets);
      }
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
  private async scrapeWithCheerio(url: string, maxAssets: number): Promise<ScrapedContent> {
    const normalizedUrl = this.normalizeUrl(url);

    try {
      const response = await axios.get(normalizedUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const $ = cheerio.load(response.data);
      const title = $('title').text() || 'untitled';
      const assets: Asset[] = [];

      // Extract images (limited)
      $('img').each((_, el) => {
        if (assets.length >= maxAssets) return false;
        const src = $(el).attr('src');
        if (src && !src.startsWith('data:')) {
          assets.push({ type: 'image', url: src });
        }
        return true;
      });

      // Extract stylesheets (limited)
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
      // Extract all assets in one evaluation for performance
      const extractedAssets = await page.evaluate((maxAssets: number) => {
        const results: any[] = [];

        // Extract images
        document.querySelectorAll('img').forEach((img: any) => {
          if (results.length >= maxAssets) return false;
          const url = img.src || img.currentSrc;
          if (url && !url.startsWith('data:')) {
            results.push({ type: 'image', url });
          }
          return true;
        });

        // Extract stylesheets
        if (results.length < maxAssets) {
          document.querySelectorAll('link[rel="stylesheet"]').forEach((link: any) => {
            if (results.length >= maxAssets) return false;
            const url = link.href;
            if (url) {
              results.push({ type: 'stylesheet', url });
            }
            return true;
          });
        }

        // Extract scripts (limited for performance)
        if (results.length < maxAssets) {
          document.querySelectorAll('script[src]').forEach((script: any) => {
            if (results.length >= maxAssets) return false;
            const url = script.src;
            if (url && !url.includes('analytics') && !url.includes('tracking')) {
              results.push({ type: 'script', url });
            }
            return true;
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
