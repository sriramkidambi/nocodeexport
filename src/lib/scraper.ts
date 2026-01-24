import puppeteer, { Browser, Page } from 'puppeteer';
import axios from 'axios';

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

export class NoCodeScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async initialize(): Promise<void> {
    if (this.browser) return;

    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
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
      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
        // Allow these as we need them
        req.continue();
      } else {
        req.continue();
      }
    });
  }

  async scrape(url: string): Promise<ScrapedContent> {
    if (!this.page) {
      await this.initialize();
    }

    if (!this.page) {
      throw new Error('Failed to initialize browser');
    }

    // Normalize URL
    const normalizedUrl = this.normalizeUrl(url);

    try {
      // Navigate to the page and wait for it to fully render
      await this.page.goto(normalizedUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // Wait a bit more for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get the rendered HTML
      const html = await this.page.content();
      const title = await this.page.title();

      // Extract all assets
      const assets = await this.extractAssets(this.page);

      return {
        html,
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

  private async extractAssets(page: Page): Promise<Asset[]> {
    const assets: Asset[] = [];

    // Extract images
    const images = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.map(img => ({
        type: 'image' as const,
        url: img.src || img.currentSrc,
        srcset: img.srcset,
      }));
    });

    for (const img of images) {
      if (img.url && !img.url.startsWith('data:')) {
        assets.push({
          type: 'image',
          url: img.url,
        });
      }
    }

    // Extract stylesheets
    const stylesheets = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      return links.map(link => ({
        type: 'stylesheet' as const,
        url: (link as HTMLLinkElement).href,
      }));
    });

    for (const sheet of stylesheets) {
      assets.push(sheet);
    }

    // Extract scripts
    const scripts = await page.evaluate(() => {
      const scriptTags = Array.from(document.querySelectorAll('script[src]'));
      return scriptTags.map(script => ({
        type: 'script' as const,
        url: (script as HTMLScriptElement).src,
      }));
    });

    for (const script of scripts) {
      assets.push(script);
    }

    return assets;
  }

  async downloadAsset(url: string): Promise<Buffer> {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
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
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Singleton instance
let scraperInstance: NoCodeScraper | null = null;

export function getScraper(): NoCodeScraper {
  if (!scraperInstance) {
    scraperInstance = new NoCodeScraper();
  }
  return scraperInstance;
}
