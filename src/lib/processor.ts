import * as cheerio from 'cheerio';
import { URL } from 'url';

export type Platform = 'auto' | 'framer' | 'wix' | 'webflow' | 'carrd';

export interface ProcessorOptions {
  platform?: Platform;
  removeWatermark?: boolean;
  removeRedirects?: boolean;
  removeAnalytics?: boolean;
  inlineCss?: boolean;
  minify?: boolean;
}

export class NoCodeProcessor {
  private $: cheerio.CheerioAPI;
  private html: string;
  private baseUrl: string;

  constructor(html: string, url: string) {
    this.$ = cheerio.load(html);
    this.html = html;
    this.baseUrl = url;
  }

  process(options: ProcessorOptions = {}): string {
    const {
      platform = 'auto',
      removeWatermark = true,
      removeRedirects = true,
      removeAnalytics = true,
      inlineCss = false,
      minify = false,
    } = options;

    // Detect platform if auto
    const detectedPlatform = platform === 'auto' ? this.detectPlatform() : platform;

    // Platform-specific cleanup
    if (detectedPlatform === 'framer' || platform === 'auto') {
      this.removeFramerWatermarks();
      this.removeFramerRedirects();
      this.removeFramerScripts();
      this.removeFramerDomains();
      this.removeFramerMetadata();
    }

    if (detectedPlatform === 'wix' || platform === 'auto') {
      this.removeWixWatermarks();
      this.removeWixRedirects();
      this.removeWixScripts();
      this.removeWixDomains();
    }

    // General cleanup (applies to all platforms)
    if (removeAnalytics) {
      this.removeAnalytics();
    }
    this.removeMetaRefresh();
    this.cleanAttributes(detectedPlatform);

    // Normalize Wix lazy-loaded and proprietary image URLs
    if (detectedPlatform === 'wix') {
      this.normalizeWixImages();
    }

    this.makeLinksAbsolute();

    // Inline CSS if requested
    if (inlineCss) {
      this.inlineStylesheets();
    }

    const result = this.$.html();

    return minify ? this.minifyHtml(result) : result;
  }

  /**
   * Auto-detect the platform based on HTML content and URL
   */
  private detectPlatform(): Platform {
    const html = this.html.toLowerCase();
    const url = this.baseUrl.toLowerCase();

    // Framer detection
    if (
      url.includes('framer.website') ||
      url.includes('framer.com') ||
      html.includes('data-framer') ||
      html.includes('__framer') ||
      html.includes('framer-watermark')
    ) {
      return 'framer';
    }

    // Wix detection
    if (
      url.includes('.wix.com') ||
      url.includes('.wixsite.com') ||
      url.includes('.wixstudio.io') ||
      url.includes('editor.wix.com') ||
      html.includes('wix-') ||
      html.includes('data-mesh-id') ||
      html.includes('_wix') ||
      html.includes('wixui') ||
      html.includes('santa-') ||
      html.includes('thunderbolt-') ||
      html.includes('wix-thunderbolt') ||
      html.includes('corvid-') ||
      html.includes('data-testid="mesh-container-content"')
    ) {
      return 'wix';
    }

    // Webflow detection (for future expansion)
    if (
      url.includes('.webflow.io') ||
      html.includes('data-wf-') ||
      html.includes('webflow')
    ) {
      return 'webflow';
    }

    // Carrd detection (for future expansion)
    if (
      url.includes('.carrd.co') ||
      html.includes('data-carrd')
    ) {
      return 'carrd';
    }

    return 'auto'; // Unknown platform, apply general cleanup
  }

  /**
   * Remove Framer watermark elements
   * Aggressively removes all Framer branding, badges, watermarks, and hidden elements
   */
  private removeFramerWatermarks(): void {
    const watermarkSelectors = [
      '.framer-watermark',
      '.__framer-badge',
      '#framer-watermark',
      '[data-framer-watermark]',
      '[data-framer-embed]',
      '.framer-branding',
      '.__framer',
      'a[href*="framer.website"]',
      'a[href*="framer.com"]',
      'div[class*="framer-watermark"]',
      'div[class*="framer-badge"]',
      'div[id*="framer-watermark"]',
      // Additional aggressive selectors
      '[class*="framer-badge"]',
      '[id*="framer-badge"]',
      '[class*="__framer-badge"]',
      '[data-framer-name="badge"]',
      '[data-framer-name="Watermark"]',
      '[data-framer-name="watermark"]',
      '[data-framer-name="Badge"]',
      '[data-framer-name="Framer Badge"]',
      'a[href*="framer.com/projects"]',
      'a[href*="framer.com/?utm"]',
    ];

    watermarkSelectors.forEach(selector => {
      this.$(selector).remove();
    });

    // Remove iframes containing Framer branding
    this.$('iframe').each((_, el) => {
      const src = this.$(el).attr('src') || '';
      if (src.includes('framer') || src.includes('watermark') || src.includes('badge')) {
        this.$(el).remove();
      }
    });

    // Remove any element whose text content is a "Made in Framer" / "Built with Framer" badge
    this.$('a, div, span, p, footer').each((_, el) => {
      const text = this.$(el).text().trim().toLowerCase();
      const href = this.$(el).attr('href') || '';
      if (
        (text === 'made in framer' ||
         text === 'built with framer' ||
         text === 'powered by framer' ||
         text === 'made with framer' ||
         text === 'framer' ||
         text === 'built in framer') &&
        (href.includes('framer') || text.length < 30)
      ) {
        this.$(el).remove();
      }
    });

    // Remove SVG icons that link to Framer (the Framer logo badge)
    this.$('a svg, div svg').each((_, el) => {
      const parent = this.$(el).parent();
      const href = parent.attr('href') || '';
      const parentClass = parent.attr('class') || '';
      if (
        href.includes('framer.com') ||
        href.includes('framer.website') ||
        parentClass.includes('framer-badge') ||
        parentClass.includes('framer-watermark')
      ) {
        parent.remove();
      }
    });
  }

  /**
   * Remove Framer redirect scripts
   * Framer adds scripts that redirect to framer.website or similar domains
   */
  private removeFramerRedirects(): void {
    // Remove redirect scripts
    this.$('script').each((_, el) => {
      const scriptContent = this.$(el).html() || '';
      const src = this.$(el).attr('src') || '';

      // Check for redirect patterns
      const redirectPatterns = [
        /window\.location\s*=\s*['"]https?:\/\/(?:www\.)?framer\.website/i,
        /window\.location\.href\s*=\s*['"]https?:\/\/(?:www\.)?framer/i,
        /window\.location\.replace\s*\(\s*['"]https?:\/\/(?:www\.)?framer/i,
        /location\.href\s*=\s*['"]https?:\/\/(?:www\.)?framer/i,
        /top\.location\s*=/i,
        /\.framer\.website/i,
        /\.framer\.com\/redirect/i,
      ];

      const isRedirectScript = redirectPatterns.some(pattern =>
        pattern.test(scriptContent) || pattern.test(src)
      );

      if (isRedirectScript) {
        this.$(el).remove();
      }
    });

    // Remove meta refresh redirects to Framer
    this.$('meta[http-equiv="refresh"]').each((_, el) => {
      const content = this.$(el).attr('content') || '';
      if (content.includes('framer.website') || content.includes('framer.com')) {
        this.$(el).remove();
      }
    });
  }

  /**
   * Remove Framer-specific scripts, widgets, and runtime code
   */
  private removeFramerScripts(): void {
    this.$('script').each((_, el) => {
      const src = this.$(el).attr('src') || '';
      const scriptContent = this.$(el).html() || '';

      const framerPatterns = [
        /framer\.com\/scripts/,
        /framer\.website\/scripts/,
        /framer\.unbounce/,
        /framer\.metrics/,
        /__framer/,
        /framerAnalytics/,
        /framer-analytics/,
        /framer\.com\/api/,
        /framer\.com\/embed/,
        /events\.framer\.com/,
        /collect\.framer\.com/,
        /router\.framer\.com/,
      ];

      const isFramerScript = framerPatterns.some(pattern =>
        pattern.test(src) || pattern.test(scriptContent)
      );

      if (isFramerScript) {
        this.$(el).remove();
      }
    });

    // Remove Framer widget containers
    this.$('[data-framer-component], [data-framer-widget], .framer-widget').remove();
  }

  /**
   * Remove analytics and tracking scripts
   */
  private removeAnalytics(): void {
    const analyticsSelectors = [
      'script[src*="analytics"]',
      'script[src*="tracking"]',
      'script[src*="gtag"]',
      'script[src*="gtm"]',
      'script[src*="facebook.net"]',
      'script[src*="fbq"]',
      'script[src*="hotjar"]',
      'script[src*="mixpanel"]',
      'script[src*="segment"]',
      'noscript:has(iframe[src*="facebook"])',
      'noscript:has(iframe[src*="gtm"])',
    ];

    analyticsSelectors.forEach(selector => {
      this.$(selector).remove();
    });

    // Remove inline analytics scripts
    this.$('script').each((_, el) => {
      const content = this.$(el).html() || '';
      if (
        content.includes('gtag') ||
        content.includes('ga(') ||
        content.includes('fbq(') ||
        content.includes('_gaq') ||
        content.includes('hj(') ||
        content.includes('analytics')
      ) {
        this.$(el).remove();
      }
    });
  }

  /**
   * Aggressively remove all Framer domain references and metadata
   */
  private removeFramerDomains(): void {
    // Remove canonical links pointing to Framer
    this.$('link[rel="canonical"]').each((_, el) => {
      const href = this.$(el).attr('href') || '';
      if (href.includes('framer.website') || href.includes('framer.com') || href.includes('.framer.')) {
        this.$(el).remove();
      }
    });

    // Remove OG tags pointing to Framer
    this.$('meta[property*="og:"]').each((_, el) => {
      const content = this.$(el).attr('content') || '';
      if (content.includes('framer.website') || content.includes('framer.com') || content.includes('.framer.')) {
        this.$(el).remove();
      }
    });

    // Remove generator meta tag
    this.$('meta[name="generator"]').each((_, el) => {
      const content = this.$(el).attr('content') || '';
      if (content.toLowerCase().includes('framer')) {
        this.$(el).remove();
      }
    });

    // Remove any meta tag whose name or content references Framer
    this.$('meta').each((_, el) => {
      const name = (this.$(el).attr('name') || '').toLowerCase();
      const content = (this.$(el).attr('content') || '').toLowerCase();
      const property = (this.$(el).attr('property') || '').toLowerCase();
      if (
        name.includes('framer') ||
        (content.includes('framer.com') || content.includes('framer.website') || content.includes('.framer.')) ||
        property.includes('framer')
      ) {
        this.$(el).remove();
      }
    });

    // Remove link[rel="alternate"] / link[rel="preconnect"] / link[rel="dns-prefetch"] to Framer domains
    this.$('link').each((_, el) => {
      const href = (this.$(el).attr('href') || '').toLowerCase();
      if (href.includes('framer.com') || href.includes('framer.website') || href.includes('.framer.')) {
        this.$(el).remove();
      }
    });

    // Remove HTML comments containing Framer references
    this.$('*').contents().each((_, node) => {
      if (node.type === 'comment') {
        const commentText = (node.data || '').toLowerCase();
        if (commentText.includes('framer')) {
          this.$(node).remove();
        }
      }
    });

    // Strip "framer" from <html> class or data attributes
    const $html = this.$('html');
    const htmlClass = $html.attr('class') || '';
    if (htmlClass.includes('framer')) {
      $html.attr('class', htmlClass.replace(/\bframer\S*/gi, '').trim() || undefined as unknown as string);
      if (!$html.attr('class')) $html.removeAttr('class');
    }

    // Strip Framer from <body> class
    const $body = this.$('body');
    const bodyClass = $body.attr('class') || '';
    if (bodyClass.includes('framer')) {
      $body.attr('class', bodyClass.replace(/\bframer\S*/gi, '').trim() || undefined as unknown as string);
      if (!$body.attr('class')) $body.removeAttr('class');
    }
  }

  /**
   * Final aggressive pass to remove any remaining Framer metadata.
   * Catches anything the other methods might have missed via string-level checks.
   */
  private removeFramerMetadata(): void {
    // Remove <noscript> blocks that contain Framer references
    this.$('noscript').each((_, el) => {
      const content = (this.$(el).html() || '').toLowerCase();
      if (content.includes('framer')) {
        this.$(el).remove();
      }
    });

    // Remove JSON-LD / structured data that references Framer
    this.$('script[type="application/ld+json"]').each((_, el) => {
      const content = this.$(el).html() || '';
      if (content.toLowerCase().includes('framer')) {
        try {
          const json = JSON.parse(content);
          const cleaned = this.removeFramerFromObject(json);
          this.$(el).html(JSON.stringify(cleaned));
        } catch {
          // If unparseable and contains framer, remove entirely
          this.$(el).remove();
        }
      }
    });

    // Remove style blocks that are purely Framer badge/watermark styles
    this.$('style').each((_, el) => {
      const content = (this.$(el).html() || '').toLowerCase();
      if (
        content.includes('framer-watermark') ||
        content.includes('framer-badge') ||
        content.includes('__framer-badge')
      ) {
        // Remove only the Framer-specific rules, not the whole block
        let updated = this.$(el).html() || '';
        updated = updated.replace(/[^{}]*framer-watermark[^}]*\{[^}]*\}/gi, '');
        updated = updated.replace(/[^{}]*framer-badge[^}]*\{[^}]*\}/gi, '');
        updated = updated.replace(/[^{}]*__framer-badge[^}]*\{[^}]*\}/gi, '');
        if (updated.trim()) {
          this.$(el).html(updated);
        } else {
          this.$(el).remove();
        }
      }
    });

    // Remove title tag content if it's just "Framer" or contains the default Framer title
    const title = this.$('title').text().trim();
    if (title.toLowerCase() === 'framer' || title.toLowerCase() === 'made in framer') {
      this.$('title').text('');
    }
  }

  /**
   * Recursively remove Framer references from JSON-LD objects
   */
  private removeFramerFromObject(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return obj.replace(/framer\.com|framer\.website/gi, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.removeFramerFromObject(item));
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key.toLowerCase().includes('framer')) continue;
        result[key] = this.removeFramerFromObject(value);
      }
      return result;
    }
    return obj;
  }

  // ============================================
  // WIX & WIX STUDIO SPECIFIC METHODS
  // ============================================

  /**
   * Remove Wix watermark elements
   * Wix adds various watermarks, badges, and branding elements:
   * - WixAds (legacy)
   * - Free site banners
   * - Wix branding in footer
   * - Editor X/Wix Studio watermarks
   */
  private removeWixWatermarks(): void {
    const wixWatermarkSelectors = [
      // Legacy Wix Ads
      '#WIX_ADS',
      '#SITE_FOOTER [data-testid*="wix-ads"]',
      '[id*="WIX_ADS"]',
      '.wix-ads',
      '[class*="wix-ads"]',
      
      // Wix branding badges
      '.wixui-rich-text__text a[href*="wix.com/free-website"]',
      'a[href*="wix.com/lpviral"]',
      'a[href*="wix.com/free-website"]',
      'a[data-testid="linkElement"][href*="wix.com"]',
      
      // Wix promotion banners
      '[data-hook="wix-ads"]',
      '[data-hook="top-banner"]',
      '[data-testid="wix-ads-banner"]',
      '.top-banner',
      '#top-banner',
      
      // Free site watermark
      '[class*="free-site-watermark"]',
      '[id*="free-site-watermark"]',
      
      // Wix Studio / Editor X watermarks
      '[data-testid="editor-x-watermark"]',
      '.studio-watermark',
      '.editorx-watermark',
      
      // Generic Wix promotion elements
      '[class*="WixAd"]',
      '[id*="WixAd"]',
      '.promoted-by-wix',
      '#promoted-by-wix',
      
      // Footer branding
      'footer a[href*="wix.com"]',
      '[data-testid="siteFooter"] a[href*="wix.com/free"]',
    ];

    wixWatermarkSelectors.forEach(selector => {
      try {
        this.$(selector).remove();
      } catch {
        // Skip invalid selectors
      }
    });

    // Remove Wix branding iframes
    this.$('iframe').each((_, el) => {
      const src = this.$(el).attr('src') || '';
      const id = this.$(el).attr('id') || '';
      if (
        src.includes('wix.com') ||
        src.includes('wixstatic.com') ||
        id.includes('wix-ads') ||
        id.includes('WIX_ADS')
      ) {
        this.$(el).remove();
      }
    });

    // Remove hidden Wix promotional divs
    this.$('div').each((_, el) => {
      const style = this.$(el).attr('style') || '';
      const innerHTML = this.$(el).html() || '';
      if (
        innerHTML.includes('wix.com/free-website') ||
        innerHTML.includes('Create a Free Website')
      ) {
        // Check if it's a small promo element
        if (innerHTML.length < 500) {
          this.$(el).remove();
        }
      }
    });
  }

  /**
   * Remove Wix redirect scripts
   * Wix may add scripts that redirect to wix.com or show upgrade prompts
   */
  private removeWixRedirects(): void {
    this.$('script').each((_, el) => {
      const scriptContent = this.$(el).html() || '';
      const src = this.$(el).attr('src') || '';

      const wixRedirectPatterns = [
        /window\.location\s*=\s*['"]https?:\/\/(?:www\.)?wix\.com/i,
        /window\.location\.href\s*=\s*['"]https?:\/\/(?:www\.)?wix/i,
        /location\.href\s*=\s*['"]https?:\/\/(?:www\.)?wix/i,
        /wix\.com\/lpviral/i,
        /premium\.wix\.com/i,
        /manage\.wix\.com/i,
        /users\.wix\.com/i,
      ];

      const isWixRedirect = wixRedirectPatterns.some(pattern =>
        pattern.test(scriptContent) || pattern.test(src)
      );

      if (isWixRedirect) {
        this.$(el).remove();
      }
    });

    // Remove meta refresh redirects to Wix
    this.$('meta[http-equiv="refresh"]').each((_, el) => {
      const content = this.$(el).attr('content') || '';
      if (content.includes('wix.com') || content.includes('wixsite.com')) {
        this.$(el).remove();
      }
    });
  }

  /**
   * Remove Wix-specific scripts and tracking
   * Wix uses various internal scripts for their platform
   */
  private removeWixScripts(): void {
    this.$('script').each((_, el) => {
      const src = this.$(el).attr('src') || '';
      const scriptContent = this.$(el).html() || '';
      const id = this.$(el).attr('id') || '';

      // Wix platform scripts to remove
      const wixScriptPatterns = [
        /static\.parastorage\.com.*?wix-perf-measure/i,
        /static\.parastorage\.com.*?bi-module/i,
        /static\.parastorage\.com.*?wix-bi/i,
        /static\.wixstatic\.com.*?bi\//i,
        /frog\.wix\.com/i,
        /users\.wix\.com/i,
        /editor\.wix\.com/i,
        /manage\.wix\.com/i,
        /promote\.wix\.com/i,
        /wix-code-adi/i,
        /wixAnalytics/i,
        /wix-perf/i,
        /bi-module/i,
        /fedops/i,
        /wix-recorder/i,
      ];

      const isWixScript = wixScriptPatterns.some(pattern =>
        pattern.test(src) || pattern.test(scriptContent) || pattern.test(id)
      );

      if (isWixScript) {
        this.$(el).remove();
      }

      // Remove Wix BI (Business Intelligence) tracking
      if (
        scriptContent.includes('wixBiSession') ||
        scriptContent.includes('fedops') ||
        scriptContent.includes('wix-perf-measure') ||
        scriptContent.includes('bi.wixapis.com') ||
        scriptContent.includes('frog.wix.com')
      ) {
        this.$(el).remove();
      }
    });

    // Remove Wix widget containers and components
    const wixComponentSelectors = [
      '[data-testid="wix-ads-widget"]',
      '[data-hook="wix-code-sdk"]',
    ];

    wixComponentSelectors.forEach(selector => {
      try {
        this.$(selector).remove();
      } catch {
        // Skip invalid selectors
      }
    });
  }

  /**
   * Remove Wix domain references
   */
  private removeWixDomains(): void {
    // Remove canonical links pointing to Wix
    this.$('link[rel="canonical"]').each((_, el) => {
      const href = this.$(el).attr('href') || '';
      if (
        href.includes('wixsite.com') ||
        href.includes('wix.com') ||
        href.includes('wixstudio.io') ||
        href.includes('editorx.io')
      ) {
        this.$(el).remove();
      }
    });

    // Remove OG tags pointing to Wix
    this.$('meta[property*="og:"]').each((_, el) => {
      const content = this.$(el).attr('content') || '';
      if (
        content.includes('wixsite.com') ||
        content.includes('wix.com') ||
        content.includes('wixstatic.com')
      ) {
        // Only remove URL-related OG tags, not images
        const property = this.$(el).attr('property') || '';
        if (property === 'og:url') {
          this.$(el).remove();
        }
      }
    });

    // Clean up Wix-specific meta tags
    this.$('meta[name*="wix"]').remove();
    this.$('meta[name="generator"]').each((_, el) => {
      const content = this.$(el).attr('content') || '';
      if (content.toLowerCase().includes('wix')) {
        this.$(el).remove();
      }
    });
  }

  /**
   * Normalize Wix lazy-loaded images and proprietary wix:image:// URLs
   */
  private normalizeWixImages(): void {
    // Fix <img> tags with placeholder src and real data-src
    this.$('img').each((_, el) => {
      const $el = this.$(el);
      let src = $el.attr('src') || '';
      const dataSrc = $el.attr('data-src') || $el.attr('data-image-src') || '';

      if ((!src || src.startsWith('data:')) && dataSrc) {
        src = dataSrc;
      }
      src = this.normalizeWixAssetUrl(src);
      if (src) $el.attr('src', src);

      const srcset = $el.attr('srcset') || '';
      if (srcset && srcset.includes('wix:image://')) {
        $el.attr('srcset', srcset.replace(/wix:image:\/\/v1\/[^,\s]+/g, m => this.normalizeWixAssetUrl(m)));
      }
    });

    // Fix background-image URLs in inline styles
    this.$('[style]').each((_, el) => {
      const $el = this.$(el);
      const style = $el.attr('style') || '';
      if (style.includes('wix:image://') || style.includes('wix:vector://')) {
        const updated = style.replace(
          /wix:(image|vector):\/\/v1\/([^"')\s#]+)([^"')\s]*)/g,
          (full) => this.normalizeWixAssetUrl(full)
        );
        $el.attr('style', updated);
      }
    });
  }

  /**
   * Convert wix:image:// and wix:vector:// URLs to static.wixstatic.com URLs
   */
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

  /**
   * Remove all meta refresh redirects
   */
  private removeMetaRefresh(): void {
    this.$('meta[http-equiv="refresh"]').each((_, el) => {
      this.$(el).remove();
    });
  }

  /**
   * Clean up unnecessary attributes
   */
  private cleanAttributes(platform: Platform): void {
    this.$('*').each((_, el) => {
      const attrs = this.$(el).attr();
      if (attrs) {
        Object.keys(attrs).forEach(attr => {
          if (attr.startsWith('data-framer')) {
            this.$(el).removeAttr(attr);
          }
          if (platform === 'wix') {
            // Wix: only remove tracking attributes; keep layout-critical ones
            if (attr.startsWith('data-bi')) {
              this.$(el).removeAttr(attr);
            }
          } else {
            if (
              attr.startsWith('data-testid') ||
              attr.startsWith('data-hook') ||
              attr.startsWith('data-bi') ||
              attr.startsWith('data-comp-id') ||
              attr.startsWith('data-packed')
            ) {
              this.$(el).removeAttr(attr);
            }
          }
        });
      }
    });
  }

  /**
   * Make all links absolute using the base URL
   */
  private makeLinksAbsolute(): void {
    // Make images absolute
    this.$('img').each((_, el) => {
      const src = this.$(el).attr('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:')) {
        try {
          const absoluteUrl = new URL(src, this.baseUrl).href;
          this.$(el).attr('src', absoluteUrl);
        } catch {
          // Invalid URL, leave as is
        }
      }
    });

    // Make links absolute
    this.$('a').each((_, el) => {
      const href = this.$(el).attr('href');
      if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
        try {
          const absoluteUrl = new URL(href, this.baseUrl).href;
          this.$(el).attr('href', absoluteUrl);
        } catch {
          // Invalid URL, leave as is
        }
      }
    });

    // Make stylesheet links absolute
    this.$('link[rel="stylesheet"]').each((_, el) => {
      const href = this.$(el).attr('href');
      if (href && !href.startsWith('http')) {
        try {
          const absoluteUrl = new URL(href, this.baseUrl).href;
          this.$(el).attr('href', absoluteUrl);
        } catch {
          // Invalid URL, leave as is
        }
      }
    });
  }

  /**
   * Inline stylesheets into the HTML
   */
  private inlineStylesheets(): void {
    // For now, just keep external stylesheets
    // A full implementation would fetch and inline them
    // This is a placeholder for future enhancement
  }

  /**
   * Minify HTML by removing unnecessary whitespace
   */
  private minifyHtml(html: string): string {
    return html
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .replace(/\s+>/g, '>')
      .replace(/<\s+/g, '<')
      .trim();
  }

  /**
   * Get statistics about what was removed
   */
  getStats(): { removed: string[] } {
    return {
      removed: [],
    };
  }
}

export function processHtml(html: string, url: string, options?: ProcessorOptions): string {
  const processor = new NoCodeProcessor(html, url);
  return processor.process(options);
}
