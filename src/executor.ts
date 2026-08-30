import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TradeSignal, ExecutionResult, AccountBalance, ActionType } from './types.js';
import { isUpAction, isDownAction } from './types.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { balanceManager } from './balance.js';

let globalContext: BrowserContext | null = null;

/**
 * ═══════════════════════════════════════════════════════════════════
 * MARKET STATE MANAGEMENT
 * ═══════════════════════════════════════════════════════════════════
 * Verified cache auto-expires after 60 seconds to guarantee DOM truth.
 */
let currentActiveMarket: string | null = null;
let lastVerifiedAt: number = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

export function getActiveMarket(): string | null {
  if (currentActiveMarket && (Date.now() - lastVerifiedAt) > CACHE_TTL_MS) {
    return null;
  }
  return currentActiveMarket;
}

export function setActiveMarket(market: string | null): void {
  currentActiveMarket = market;
  lastVerifiedAt = market ? Date.now() : 0;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * SECTOR-AWARE TICKER & ALIAS ENGINE
 * ═══════════════════════════════════════════════════════════════════
 * Covers all asset classes: Forex, Crypto, Commodities, Stocks, Indices.
 */
export const TICKER_ALIASES: Record<string, string[]> = {
  // Commodities
  GOLD: ['XAU', 'XAUUSD', 'GOLD'],
  SILVER: ['XAG', 'XAGUSD', 'SILVER'],
  UKBRENT: ['BRENT', 'BRENTCRUDE', 'UKBRENT'],
  USCRUDE: ['WTI', 'CRUDE', 'CRUDEOIL', 'USCRUDE', 'WTICRUDE'],
  NATURALGAS: ['NGAS', 'NATGAS', 'NATURALGAS'],
  // Crypto
  BTCUSD: ['BTC', 'BITCOIN', 'BTCUSD'],
  ETHUSD: ['ETH', 'ETHEREUM', 'ETHUSD'],
  SOLUSD: ['SOL', 'SOLANA', 'SOLUSD'],
  XRPUSD: ['XRP', 'RIPPLE', 'XRPUSD'],
  DOGEUSD: ['DOGE', 'DOGECOIN', 'DOGEUSD'],
  LTCUSD: ['LTC', 'LITECOIN', 'LTCUSD'],
  BNBUSD: ['BNB', 'BINANCECOIN', 'BNBUSD'],
  ADAUSD: ['ADA', 'CARDANO', 'ADAUSD'],
  DOTUSD: ['DOT', 'POLKADOT', 'DOTUSD'],
  TRXUSD: ['TRX', 'TRON', 'TRXUSD'],
  // Stocks / Equities
  APPLE: ['AAPL', 'APPLE'],
  MICROSOFT: ['MSFT', 'MICROSOFT'],
  GOOGLE: ['GOOGL', 'GOOG', 'ALPHABET', 'GOOGLE'],
  AMAZON: ['AMZN', 'AMAZON'],
  META: ['META', 'FB', 'FACEBOOK'],
  TESLA: ['TSLA', 'TESLA'],
  NVIDIA: ['NVDA', 'NVIDIA'],
  BOEING: ['BA', 'BOEING', 'BOEINGCOMPANY'],
  INTEL: ['INTC', 'INTEL'],
  PFIZER: ['PFE', 'PFIZER'],
  JOHNSONJOHNSON: ['JNJ', 'JOHNSON', 'JOHNSONJOHNSON'],
  MCDONALDS: ['MCD', 'MCDONALDS', 'MCDONALD'],
  COCACOLA: ['KO', 'COCACOLA', 'COKE'],
  VISA: ['V', 'VISA'],
  MASTERCARD: ['MA', 'MASTERCARD'],
  DISNEY: ['DIS', 'DISNEY', 'WALTDISNEY'],
  NETFLIX: ['NFLX', 'NETFLIX'],
  NIKE: ['NKE', 'NIKE'],
  WALMART: ['WMT', 'WALMART'],
  ALIBABA: ['BABA', 'ALIBABA'],
  // Indices
  SP500: ['US500', 'SPX', 'SP500', 'STANDARDPOORS'],
  NASDAQ: ['US100', 'NAS100', 'NDX', 'NASDAQ', 'NASDAQ100'],
  DOWJONES: ['US30', 'DJI', 'DOW', 'DOWJONES'],
  DAX: ['GER40', 'DAX40', 'DAX', 'GERMANY40'],
  FTSE: ['UK100', 'FTSE', 'FTSE100'],
  ASIANCOMPOSITE: ['ASIANCOMPOSITE', 'ASIANCOMPOSITEINDEX'],
  COMMODITYCOMPOSITE: ['COMMODITYCOMPOSITE', 'COMMODITYCOMPOSITEINDEX'],
  CRYPTOCOMPOSITE: ['CRYPTOCOMPOSITE', 'CRYPTOCOMPOSITEINDEX'],
  EUROPECOMPOSITE: ['EUROPECOMPOSITE', 'EUROPECOMPOSITEINDEX'],
  USDINDEX: ['USDINDEX', 'DXY'],
};

/**
 * Strips payout percentages (+87%, 82%, etc.), badges, and linebreaks from DOM text.
 */
export function stripPayoutAndNoise(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\+?\d{1,3}\s*%/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips non-alphanumerics and maps aliases to canonical base representations.
 */
export function canonicalize(ticker: string): string {
  if (!ticker || typeof ticker !== 'string') return '';
  const cleaned = stripPayoutAndNoise(ticker)
    .toUpperCase()
    .replace(/\bOTC\b/g, '')
    .replace(/[^A-Z0-9]/g, '');

  if (!cleaned) return '';

  for (const [canonical, aliases] of Object.entries(TICKER_ALIASES)) {
    if (canonical === cleaned || aliases.includes(cleaned)) {
      return canonical;
    }
  }

  return cleaned;
}

/**
 * Checks whether two ticker representations refer to the same asset.
 * Relaxed OTC checking ensures trades are never blocked by broker display variances.
 */
export function tickersMatch(signalTicker: string, domTicker: string): boolean {
  const a = canonicalize(signalTicker);
  const b = canonicalize(domTicker);
  if (!a || !b) return false;

  // Exact canonical match (with alias normalization)
  if (a === b) return true;

  // Substring matching for multi-word asset names (e.g. "BOEINGCOMPANY" vs "BOEING")
  if (a.length >= 4 && b.length >= 4) {
    if (a.includes(b) || b.includes(a)) return true;
  }

  return false;
}

/**
 * Builds the exact search query to type into Quotex's picker search input.
 * CRITICAL: "OTC" is completely stripped so Quotex search never hides results.
 */
export function buildSearchQuery(rawTicker: string): { query: string; fullName: string } {
  if (!rawTicker || typeof rawTicker !== 'string') return { query: '', fullName: '' };

  let cleaned = stripPayoutAndNoise(rawTicker);

  // Remove timeframe suffixes
  cleaned = cleaned
    .replace(/\b(?:1M|2M|3M|5M|15M|30M|1H|1\s*MIN(?:UTE)?S?|2\s*MIN(?:UTE)?S?|3\s*MIN(?:UTE)?S?|5\s*MIN(?:UTE)?S?|15\s*MIN(?:UTE)?S?|NOW)\b/gi, '')
    .replace(/\(\s*OTC\s*\)/gi, '')
    .replace(/\[\s*OTC\s*\]/gi, '')
    .replace(/\bOTC\b/gi, '')
    .replace(/[\(\)\[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let basePair: string;

  if (cleaned.includes('/')) {
    basePair = cleaned.toUpperCase();
  } else {
    const spaceParts = cleaned.split(/\s+/).filter(Boolean);
    if (spaceParts.length === 2 && spaceParts[0]!.length >= 2 && spaceParts[0]!.length <= 5 && spaceParts[1]!.length >= 2 && spaceParts[1]!.length <= 5) {
      basePair = `${spaceParts[0]}/${spaceParts[1]}`.toUpperCase();
    } else if (cleaned.length === 6 && /^[A-Za-z]+$/.test(cleaned)) {
      basePair = `${cleaned.slice(0, 3)}/${cleaned.slice(3, 6)}`.toUpperCase();
    } else {
      basePair = cleaned.toUpperCase();
    }
  }

  // Translate stock/commodity symbols to friendly search terms if known
  let searchWord = basePair;
  const upperBase = basePair.replace(/[^A-Z0-9]/g, '');
  if (upperBase === 'AAPL') searchWord = 'Apple';
  else if (upperBase === 'MSFT') searchWord = 'Microsoft';
  else if (upperBase === 'GOOGL' || upperBase === 'GOOG') searchWord = 'Google';
  else if (upperBase === 'AMZN') searchWord = 'Amazon';
  else if (upperBase === 'META' || upperBase === 'FB') searchWord = 'Meta';
  else if (upperBase === 'TSLA') searchWord = 'Tesla';
  else if (upperBase === 'NVDA') searchWord = 'Nvidia';
  else if (upperBase === 'BA') searchWord = 'Boeing';
  else if (upperBase === 'INTC') searchWord = 'Intel';
  else if (upperBase === 'PFE') searchWord = 'Pfizer';
  else if (upperBase === 'JNJ') searchWord = 'Johnson';
  else if (upperBase === 'MCD') searchWord = 'McDonald';
  else if (upperBase === 'XAU' || upperBase === 'XAUUSD' || upperBase === 'GOLD') searchWord = 'Gold';
  else if (upperBase === 'XAG' || upperBase === 'XAGUSD' || upperBase === 'SILVER') searchWord = 'Silver';
  else if (upperBase === 'USCRUDE' || upperBase === 'WTI') searchWord = 'Crude';
  else if (upperBase === 'UKBRENT' || upperBase === 'BRENT') searchWord = 'Brent';
  else if (upperBase === 'BTC' || upperBase === 'BTCUSD') searchWord = 'Bitcoin';
  else if (upperBase === 'ETH' || upperBase === 'ETHUSD') searchWord = 'Ethereum';

  return {
    query: searchWord,
    fullName: rawTicker.trim(),
  };
}

/**
 * Generates an ordered list of search candidate queries for Quotex's picker search box.
 * Examples:
 *   "USD COP OTC" -> ["USD/COP", "USD COP", "COP", "USDCOP"]
 *   "EUR USD"     -> ["EUR/USD", "EUR USD", "EURUSD"]
 *   "AAPL"        -> ["Apple", "AAPL"]
 *   "GOLD"        -> ["Gold", "XAU", "XAU/USD"]
 */
export function getSearchQueriesForTicker(rawTicker: string): string[] {
  if (!rawTicker) return [];
  const { query } = buildSearchQuery(rawTicker);
  const queries: string[] = [];
  if (query) queries.push(query);

  const clean = stripPayoutAndNoise(rawTicker)
    .replace(/\(\s*OTC\s*\)/gi, '')
    .replace(/\[\s*OTC\s*\]/gi, '')
    .replace(/\bOTC\b/gi, '')
    .replace(/[^A-Za-z0-9\/\s]/g, '')
    .trim();

  if (clean.includes('/')) {
    const parts = clean.split('/').map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      queries.push(`${parts[0]}/${parts[1]}`);
      queries.push(`${parts[0]} ${parts[1]}`);
      queries.push(`${parts[0]}${parts[1]}`);
      if (parts[1]!.length >= 3 && parts[0]!.toUpperCase() === 'USD') {
        queries.push(parts[1]!);
      }
    }
  } else {
    const spaceParts = clean.split(/\s+/).filter(Boolean);
    if (spaceParts.length === 2 && spaceParts[0]!.length >= 2 && spaceParts[1]!.length >= 2) {
      queries.push(`${spaceParts[0]}/${spaceParts[1]}`);
      queries.push(`${spaceParts[0]} ${spaceParts[1]}`);
      queries.push(`${spaceParts[0]}${spaceParts[1]}`);
      if (spaceParts[1]!.length >= 3 && spaceParts[0]!.toUpperCase() === 'USD') {
        queries.push(spaceParts[1]!);
      }
    } else if (clean.length === 6 && /^[A-Za-z]+$/.test(clean)) {
      const p1 = clean.slice(0, 3);
      const p2 = clean.slice(3, 6);
      queries.push(`${p1}/${p2}`);
      queries.push(`${p1} ${p2}`);
      queries.push(`${p1}${p2}`);
      if (p2.length >= 3 && p1.toUpperCase() === 'USD') {
        queries.push(p2);
      }
    }
  }

  // Stock / Commodity fallbacks
  const upper = clean.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (upper === 'AAPL') queries.push('AAPL');
  else if (upper === 'MSFT') queries.push('MSFT');
  else if (upper === 'BA') queries.push('BA');
  else if (upper === 'NVDA') queries.push('NVDA');
  else if (upper === 'TSLA') queries.push('TSLA');
  else if (upper === 'GOLD' || upper === 'XAU' || upper === 'XAUUSD') queries.push('XAU');

  return Array.from(new Set(queries.filter(Boolean)));
}

function ensureDirectories(): void {
  if (!fs.existsSync(config.screenshotsDir)) {
    fs.mkdirSync(config.screenshotsDir, { recursive: true });
  }
}

async function isContextAlive(): Promise<boolean> {
  if (!globalContext) return false;
  try {
    globalContext.pages();
    return true;
  } catch {
    logger.browser('⚠️ Browser context is no longer alive. Will re-launch.');
    globalContext = null;
    return false;
  }
}

function isOnTargetSite(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    const targetHost = new URL(config.targetUrl).hostname;
    if (url.hostname === targetHost) return true;
    // Quotex / QX broker mirror domains
    if (/quotex|qxbroker|market-qx|qx\.trade/i.test(url.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

async function ensurePageOnTarget(page: Page): Promise<void> {
  if (!isOnTargetSite(page.url())) {
    let defaultAccount: 'Live' | 'Demo' = 'Live';
    try {
      const settingsPath = path.join(process.cwd(), 'cortex-settings.json');
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));
        if (settings.defaultAccount === 'Live' || settings.defaultAccount === 'Demo') {
          defaultAccount = settings.defaultAccount;
        }
      }
    } catch (err: unknown) { logger.debug('Settings parse error', err); }

    let targetUrl = config.targetUrl;
    try {
      const baseUrl = new URL(config.targetUrl).origin;
      targetUrl = defaultAccount === 'Demo' ? `${baseUrl}/en/demo-trade` : `${baseUrl}/en/trade`;
    } catch (err: unknown) { logger.debug('URL parse error', err); }

    logger.browser(`Navigating Chrome to: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.browserTimeoutMs,
    });
  }
}

/**
 * Returns the active browser context and page. 
 * If launchIfNeeded is true, it will launch the browser if it isn't currently open.
 */
async function getBrowserAndPage(launchIfNeeded: boolean = true): Promise<{ context: BrowserContext; page: Page } | null> {
  ensureDirectories();

  const isAlive = await isContextAlive();

  if (!isAlive) {
    if (!launchIfNeeded) {
      return null;
    }

    logger.browser(`Launching specific Cortex Automation Profile: "${config.chromeProfileName}"...`);
    let retryCount = 0;
    while (retryCount < 2) {
      try {
        globalContext = await chromium.launchPersistentContext(config.chromeUserDataDir, {
          executablePath: config.chromeExecutablePath,
          headless: config.headless,
          viewport: null, // Allow default window sizing
          ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'],
          args: [
            `--profile-directory=${config.chromeProfileName}`, // Target the specific profile
            '--disable-blink-features=AutomationControlled', // CRITICAL: Cloudflare stealth bypass
            '--no-first-run',
            '--no-default-browser-check',
            '--test-type' // Suppresses security warning banners
          ]
        });
        
        // CRITICAL: Inject stealth script to hide Playwright from Cloudflare
        await globalContext.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})");
        
        globalContext.setDefaultTimeout(config.browserTimeoutMs);
        
        globalContext.on('close', () => {
          logger.browser('⚠️ Browser context closed externally. Resetting global state.');
          globalContext = null;
        });

        logger.browser('✅ Specific browser profile launched successfully.');
        
        // Enforce default account on startup via URL
        try {
          const settingsPath = path.join(process.cwd(), 'cortex-settings.json');
          let defaultAccount: 'Live' | 'Demo' = 'Live';
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));
            if (settings.defaultAccount === 'Live' || settings.defaultAccount === 'Demo') {
              defaultAccount = settings.defaultAccount;
            }
          }
          
          const startupPage = globalContext.pages()[0] || await globalContext.newPage();
          let targetUrl = config.targetUrl;
          try {
            const baseUrl = new URL(config.targetUrl).origin;
            targetUrl = defaultAccount === 'Demo' ? `${baseUrl}/en/demo-trade` : `${baseUrl}/en/trade`;
          } catch (err: unknown) { logger.debug('Startup URL parse error', err); }
          
          logger.browser(`🔄 Startup check: Opening default ${defaultAccount} Account URL...`);
          await startupPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          await balanceManager.extractAndRecordBalance(startupPage);
        } catch (startupErr) {
          logger.warn('⚠️ Failed to enforce default account on browser startup', startupErr);
        }

        break; // Success, exit retry loop
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (errorMessage.includes('ProcessSingleton') || errorMessage.includes('locked')) {
          retryCount++;
          logger.error(`🚨 BROWSER PROFILE LOCKED. Attempting auto-cleanup (Attempt ${retryCount}/2)...`);
          try {
            // Forcefully terminate zombie Chrome processes for this profile
            if (process.platform === 'win32') {
              try {
                execFileSync('wmic', ['process', 'where', `name='chrome.exe' and commandline like '%${config.chromeProfileName}%'`, 'call', 'terminate'], { stdio: 'ignore' });
              } catch {
                execFileSync('taskkill', ['/IM', 'chrome.exe', '/F'], { stdio: 'ignore' });
              }
            } else {
              execFileSync('pkill', ['-f', `chrome.*${config.chromeProfileName}`], { stdio: 'ignore' });
            }
            logger.browser('✅ Zombie Chrome processes terminated.');
            
            // Delete the SingletonLock file
            const lockPath = path.join(config.chromeUserDataDir, 'SingletonLock');
            if (fs.existsSync(lockPath)) {
              fs.unlinkSync(lockPath);
              logger.browser('✅ SingletonLock file deleted.');
            }
            
            // Wait a moment for OS cleanup before retrying
            await new Promise(res => setTimeout(res, 2000));
            continue; // Retry launch
          } catch (cleanupErr: unknown) {
            logger.error('❌ Auto-cleanup failed.', cleanupErr);
          }
          
          if (retryCount >= 2) {
             throw new Error('Chrome is locked and auto-cleanup failed. Please close it fully via the system tray.');
          }
        } else {
          logger.error('Failed to launch persistent context', err);
          throw err;
        }
      }
    }
  }

  const pages = globalContext!.pages().filter((p) => !p.isClosed());
  let page: Page | undefined;
  
  // 1. Try to find a page already on the target URL
  page = pages.find((p) => isOnTargetSite(p.url()));

  // 2. If not found, reuse the first available page instead of making a new one
  if (!page && pages.length > 0) {
    page = pages[0];
    logger.browser('Reusing existing page to navigate to target.');
  }

  // 3. Only create a new page if absolutely no pages exist
  if (!page) {
    logger.browser('No pages found. Creating a new tab.');
    page = await globalContext!.newPage();
  }

  return { context: globalContext!, page };
}

export async function closeWarmBrowser(): Promise<void> {
  if (globalContext) {
    logger.browser('Closing dedicated Cortex Chrome session...');
    try {
      const browser = globalContext.browser();
      await globalContext.close();
      if (browser) await browser.close();
    } catch (err) {
      logger.error('Error during browser cleanup', err);
    }
    globalContext = null;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MARKET SWITCHING ENGINE — RECREATED FROM SCRATCH
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   1. readActiveMarketFromDOM()  — Reads active asset from Quotex header / active tab
 *   2. switchViaOpenTab()         — Fast-path: clicks already-open tab (<30ms)
 *   3. openMarketPicker()         — Targets exact '+' button (excluding Deposit)
 *   4. searchAndSelectMarket()    — Types clean query (no OTC) & clicks result
 *   5. verifyMarketSwitched()     — Confirms active market via cleaned DOM
 *   6. selectMarket()             — Orchestrates tab fast-path and modal fallback
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Reads the active market name directly from the Quotex header / active tab.
 */
async function readActiveMarketFromDOM(page: Page): Promise<string | null> {
  try {
    const domText = await page.evaluate(() => {
      // 1. Primary: Check document.title which is the most reliable source
      const title = document.title || '';
      if (title.includes('Quotex - Trade ')) {
        const titlePair = title.split('Quotex - Trade ')[1]?.split(' (')[0]?.trim();
        if (titlePair) {
           return titlePair;
        }
      }

      // 1. Primary: Check active tab in top tab bar
      const activeTabSelectors = [
        '#tab-active', // Golden standard for modern Quotex active tab
        '[class*="tab--active"]',
        '[aria-selected="true"]',
      ];

      for (const sel of activeTabSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const raw = el.textContent.trim();
          if (!raw.toLowerCase().includes('deposit')) {
            const clean = raw.replace(/\+?\d{1,3}\s*%/g, '').trim();
            if (clean.length >= 2 && clean.length <= 40 && /[A-Za-z]/.test(clean)) {
              return clean;
            }
          }
        }
      }

      // 2. Secondary: Check header pair title / asset selector
      const headerSelectors = [
        '.current-asset',
        '.pair-name',
        '[class*="current-asset"]',
        '[class*="pair-name"]',
        '.assets-select',
        '[class*="assets-select"]',
        '.trading-pair',
        '[class*="trading-pair"]',
        '.tab__text',
        '.section-deal__asset',
      ];

      for (const sel of headerSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const raw = el.textContent.trim();
          if (!raw.toLowerCase().includes('deposit')) {
            const clean = raw.replace(/\+?\d{1,3}\s*%/g, '').trim();
            if (clean.length >= 2 && clean.length <= 40 && /[A-Za-z]/.test(clean)) {
              return clean;
            }
          }
        }
      }
      return null;
    });
    return domText ? stripPayoutAndNoise(domText) : null;
  } catch {
    return null;
  }
}

/**
 * Fast-path: Checks if target market is already open as a tab in the top tab bar.
 * If already active -> returns true instantly (0ms).
 * If open but inactive -> clicks tab directly (<30ms) without opening picker.
 */
async function switchViaOpenTab(page: Page, targetTicker: string): Promise<boolean> {
  try {
    const targetCanon = canonicalize(targetTicker);
    if (!targetCanon) return false;

    // Ponytail mode: Keep it simple. Use native Playwright locators.
    // Target the specific container (.OK1xf or .Q02Z1), find the element with matching data-symbol, 
    // and specifically target the market name text container (.WRocw).
    const tabNameLocator = page.locator(`.OK1xf [data-symbol*="${targetCanon}" i] .WRocw, .Q02Z1 [data-symbol*="${targetCanon}" i] .WRocw`).first();

    if (await tabNameLocator.isVisible({ timeout: 500 }).catch(() => false)) {
      // Playwright's native click handles scrolling, actionability checks, and dispatches trusted events automatically.
      await tabNameLocator.click();
      logger.browser(`⚡ Switched to "${targetTicker}" instantly via open tab.`);
      await page.waitForTimeout(200);
      setActiveMarket(targetTicker);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.warn('⚠️ Error in switchViaOpenTab:', error);
    return false;
  }
}

/**
 * Opens Quotex asset/market picker modal.
 * Uses exact user '+' button HTML and explicitly avoids the Deposit button.
 */
async function openMarketPicker(page: Page): Promise<boolean> {
  // Strategy A: Click exact '+' add asset button (excluding Deposit button)
  const isOpened = await page.evaluate(() => {
    // 1. Exact button class matching user snippet: CAZSg wupmB BEz9j
    const exactPlus = document.querySelector('button.CAZSg, button.BEz9j, button.wupmB') as HTMLButtonElement | null;
    if (exactPlus && !exactPlus.textContent?.toLowerCase().includes('deposit')) {
      exactPlus.click();
      return true;
    }

    // 2. Scan all buttons for plus icon, strictly excluding Deposit button
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      // Strictly skip Deposit button
      if (text.includes('deposit') || btn.querySelector('span.oQ4Z4')?.textContent?.toLowerCase().includes('deposit')) {
        continue;
      }

      // Check for plus icon
      const hasPlusSvg = btn.querySelector('svg.icon-plus, svg[class*="plus" i], use[*|href*="icon-plus"]');
      if (hasPlusSvg) {
        btn.click();
        return true;
      }
    }

    // 3. Header pair name / current asset button fallback
    const headerOpeners = [
      document.querySelector('.pair-name'),
      document.querySelector('.current-asset'),
      document.querySelector('[class*="current-asset"]'),
      document.querySelector('.assets-select'),
      document.querySelector('[class*="assets-select"]'),
      document.querySelector('.tab--active'),
    ];
    for (const el of headerOpeners) {
      if (el && el instanceof HTMLElement && !el.textContent?.toLowerCase().includes('deposit')) {
        el.click();
        return true;
      }
    }

    return false;
  });

  if (isOpened) {
    await page.waitForTimeout(400);
    const searchVisible = await page
      .locator('input[placeholder*="Search" i], input[type="search"], input[class*="search" i]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);

    if (searchVisible) {
      logger.browser('📂 Market picker modal opened successfully.');
      return true;
    }
  }

  // Strategy B: Playwright locator fallback
  try {
    const plusBtn = page.locator('button.CAZSg, button.BEz9j, button:has(svg.icon-plus):not(:has-text("Deposit"))').first();
    if (await plusBtn.isVisible({ timeout: 400 }).catch(() => false)) {
      await plusBtn.click({ force: true });
      await page.waitForTimeout(400);
      return true;
    }
  } catch {}

  logger.warn('⚠️ Could not open market picker with any opener strategy.');
  return false;
}

/**
 * Types clean search query into picker and clicks the matching market row.
 * Uses exact Quotex search table DOM structure (.yejPg, .R2Rgm, .vPvlJ, span.Z2fyK, .teoXG, .e4qZ6).
 */
async function searchAndSelectMarket(page: Page, targetTicker: string): Promise<boolean> {
  const searchInput = page
    .locator('input[placeholder*="Search" i], input[type="search"], input[class*="search" i]')
    .first();

  const isSearchVisible = await searchInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (!isSearchVisible) {
    logger.warn('⚠️ Search input not found in market picker.');
    return false;
  }

  const queries = getSearchQueriesForTicker(targetTicker);
  const targetCanon = canonicalize(targetTicker);

  for (const searchQuery of queries) {
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.pressSequentially(searchQuery, { delay: 20 });
    
    // Dispatch input & change events for reactive frameworks
    await searchInput.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    });
    
    logger.browser(`🔍 Typed "${searchQuery}" into picker search box`);
    await page.waitForTimeout(400);

    const clicked = await page.evaluate(
      ({ targetCanon }) => {
        function canon(s: string): string {
          return s
            .replace(/\+?\d{1,3}\s*%/g, '')
            .toUpperCase()
            .replace(/\bOTC\b/g, '')
            .replace(/[^A-Z0-9]/g, '');
        }

        // 1. Primary: Exact Quotex Asset Row & Name Selectors (.R2Rgm, .vPvlJ, span.Z2fyK, .teoXG, .e4qZ6)
        const primaryRows = document.querySelectorAll(
          '.yejPg .R2Rgm, .yejPg .vPvlJ, .R2Rgm, .vPvlJ, .teoXG, .e4qZ6, span.Z2fyK'
        );

        for (const el of primaryRows) {
          const nameSpan = el.querySelector('span.Z2fyK, .teoXG span, .e4qZ6 span') || el;
          const text = (nameSpan.textContent || '').trim();
          if (!text) continue;

          const textCanon = canon(text);
          if (textCanon === targetCanon || textCanon.includes(targetCanon) || targetCanon.includes(textCanon)) {
            const targetToClick = (el.querySelector('span.Z2fyK, .teoXG, .e4qZ6') || el) as HTMLElement;
            targetToClick.scrollIntoView({ behavior: 'instant', block: 'center' });
            targetToClick.click();
            return true;
          }
        }

        // 2. Secondary: Generalized Fallback Scanner
        function scoreMatch(el: Element): number {
          const text = (el.textContent || '').trim();
          if (!text) return -1;
          const lower = text.toLowerCase();
          if (lower.includes('deposit') || lower.includes('withdraw') || lower.includes('live account') || lower.includes('demo account')) {
            return -1;
          }

          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || rect.height > 150) return -1;

          const textCanon = canon(text);
          if (!textCanon) return -1;

          if (textCanon === targetCanon) return 100;
          if (textCanon.includes(targetCanon)) return 85;
          if (targetCanon.includes(textCanon) && textCanon.length >= 4) return 75;

          return -1;
        }

        const candidates = document.querySelectorAll(
          'li, a, tr, [class*="item"], [class*="pair"], [class*="asset"], ' +
          '[class*="result"], [class*="option"], [role="option"], [role="row"], button'
        );

        let bestEl: HTMLElement | null = null;
        let bestScore = -1;

        for (const el of candidates) {
          const score = scoreMatch(el);
          if (score > bestScore) {
            bestScore = score;
            bestEl = el as HTMLElement;
          }
        }

        if (bestEl && bestScore > 0) {
          bestEl.scrollIntoView({ behavior: 'instant', block: 'center' });
          bestEl.click();
          return true;
        }

        return false;
      },
      { targetCanon }
    );

    if (clicked) {
      logger.browser(`✅ Clicked search result for "${searchQuery}" directly via DOM`);
      return true;
    }

    // Playwright text locator fallback
    try {
      const textLoc = page.locator('.R2Rgm, .vPvlJ, .yejPg, .teoXG, span.Z2fyK, body').getByText(searchQuery, { exact: false }).first();
      if (await textLoc.isVisible({ timeout: 400 }).catch(() => false)) {
        await textLoc.click({ force: true });
        logger.browser(`✅ Clicked result via Playwright text locator for "${searchQuery}"`);
        return true;
      }
    } catch {}
  }

  logger.warn(`⚠️ Could not find matches for any query: [${queries.join(', ')}] in picker results.`);
  return false;
}

/**
 * Verifies that the market switch happened by polling active DOM state (up to 2500ms).
 */
async function verifyMarketSwitched(page: Page, targetTicker: string, maxWaitMs: number = 2500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const currentMarket = await readActiveMarketFromDOM(page);
    if (currentMarket && tickersMatch(targetTicker, currentMarket)) {
      logger.browser(`✅ VERIFIED: Market is now "${currentMarket}"`);
      setActiveMarket(currentMarket);
      return true;
    }
    await page.waitForTimeout(100);
  }

  const finalCheck = await readActiveMarketFromDOM(page);
  if (finalCheck && tickersMatch(targetTicker, finalCheck)) {
    logger.browser(`✅ VERIFIED: Market is now "${finalCheck}"`);
    setActiveMarket(finalCheck);
    return true;
  }

  logger.warn(`⚠️ Verification: Expected "${targetTicker}", DOM shows "${finalCheck || 'unreadable'}"`);
  return false;
}

/**
 * Main Orchestrator: selectMarket()
 */
async function selectMarket(page: Page, rawTicker: string): Promise<void> {
  const { query: searchQuery, fullName } = buildSearchQuery(rawTicker);
  if (!searchQuery) {
    logger.warn(`selectMarket: Empty search query for "${rawTicker}"`);
    return;
  }

  logger.browser(`🔄 Market switch requested: "${rawTicker}" (target: "${fullName}")`);

  // 1. Check DOM current market
  const currentDomMarket = await readActiveMarketFromDOM(page);
  if (currentDomMarket && tickersMatch(fullName, currentDomMarket)) {
    logger.browser(`⚡ Market "${currentDomMarket}" is already active. Skipping switch.`);
    setActiveMarket(currentDomMarket);
    return;
  }

  // 2. Check fresh memory cache
  const cachedMarket = getActiveMarket();
  if (cachedMarket && tickersMatch(fullName, cachedMarket)) {
    if (!currentDomMarket) {
      logger.browser(`⚡ Market "${cachedMarket}" is active per cache. Skipping switch.`);
      return;
    }
  }

  // 3. Fast-path: Check open tabs in top bar
  const switchedViaTab = await switchViaOpenTab(page, fullName);
  if (switchedViaTab) {
    // CRITICAL: We MUST verify it actually switched. The click might have failed.
    const verified = await verifyMarketSwitched(page, fullName, 1500);
    if (verified) return;
    
    logger.warn(`⚠️ Tab click failed to activate market. Falling back to picker...`);
  }

  // 4. Modal picker flow (with 1 retry)
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      logger.browser('🔁 Retrying market switch (attempt 2/2)...');
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }

    const pickerOpened = await openMarketPicker(page);
    if (!pickerOpened) {
      logger.warn(`⚠️ Failed to open market picker (attempt ${attempt}/2)`);
      continue;
    }

    const resultClicked = await searchAndSelectMarket(page, fullName);

    // Close any lingering modal
    await page.keyboard.press('Escape').catch(() => {});

    if (!resultClicked) {
      logger.warn(`⚠️ Failed to click search result (attempt ${attempt}/2)`);
      continue;
    }

    // Polling verification: returns true as soon as the DOM settles (<2500ms)
    const verified = await verifyMarketSwitched(page, fullName);
    if (verified) {
      logger.browser(`🎯 Market switched to "${fullName}" on attempt ${attempt}`);
      return;
    }
  }

  logger.warn(`❌ Market switch to "${fullName}" unverified after 2 attempts. Proceeding.`);
  await page.keyboard.press('Escape').catch(() => {});
}

export async function fetchLiveBalance(launchIfNeeded: boolean = false): Promise<AccountBalance | null> {
  try {
    // Only fetch if browser is already alive, unless launchIfNeeded is true
    const instance = await getBrowserAndPage(launchIfNeeded);
    if (!instance) {
      return null;
    }
    
    const { page } = instance;
    await ensurePageOnTarget(page);
    return await balanceManager.extractAndRecordBalance(page);
  } catch (err) {
    logger.error('Failed to fetch live balance', err);
    return null;
  }
}

async function handlePrepareTrigger(signal: TradeSignal, startTime: number): Promise<ExecutionResult> {
  logger.browser(`⚡ Received PREPARE trigger ("${signal.rawText}"). Pre-warming Chrome profile...`);

  const instance = await getBrowserAndPage(true);
  if (!instance) {
    throw new Error('Could not acquire browser page');
  }
  const { page } = instance;

  try {
    await ensurePageOnTarget(page);
    await page.bringToFront().catch(() => {});

    // Read and log the current balance via the balance manager
    let balance = await balanceManager.extractAndRecordBalance(page);
    
    const isGenericTicker =
      !signal.ticker ||
      ['ACTIVE', 'CURRENT', 'READY', 'STANDBY', 'ACCOUNT'].includes(signal.ticker.toUpperCase());

    if (!isGenericTicker) {
      await selectMarket(page, signal.ticker);
    }

    const durationMs = Date.now() - startTime;
    logger.browser(`✅ Cortex Browser is ready on standby for orders! (${durationMs}ms)`);

    return {
      success: true,
      signal,
      durationMs,
      details: `Pre-warmed browser on ${config.targetUrl}`,
      balance: balance || undefined,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * INSTANT trade button click for Quotex.
 *
 * The DOM truth is simple:
 *   UP   = <span class="oQ4Z4">Up</span>   inside a <button>
 *   DOWN = <span class="oQ4Z4">Down</span> inside a <button>
 *
 * We find that span, walk up to its parent button, and click it
 * using raw JavaScript .click() inside the browser — zero Playwright
 * overhead, zero network round-trips, zero timeouts. Instant.
 */
export async function clickTradeButton(
  page: Page,
  action: ActionType | string
): Promise<{ success: boolean; selectorUsed: string }> {
  const isUp = isUpAction(action);
  const isDown = isDownAction(action);

  if (!isUp && !isDown) {
    throw new Error(`Invalid trade action: "${action}"`);
  }

  const word = isUp ? 'Up' : 'Down';
  logger.browser(`⚡ INSTANT ${word.toUpperCase()} trade — executing now...`);

  // ─── INSTANT CLICK: runs inside the browser, no round-trips ───
  const result = await page.evaluate((targetWord: string) => {
    // Step 1: Find ALL <span class="oQ4Z4"> elements
    const spans = document.querySelectorAll('span.oQ4Z4');

    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (text.toLowerCase() === targetWord.toLowerCase()) {
        // Step 2: Walk up to the parent <button>
        const button = span.closest('button') as HTMLButtonElement | null;
        if (button) {
          // Step 3: Click it immediately
          button.click();
          return { ok: true, method: 'span.oQ4Z4 → button.click()', classes: button.className };
        }
        // If no parent button, click the span itself
        (span as HTMLElement).click();
        return { ok: true, method: 'span.oQ4Z4.click() direct', classes: '' };
      }
    }

    // Step 4: Semantic and Color Fallbacks for Buttons
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const btnText = (btn.textContent || '').trim().toLowerCase();
      const style = window.getComputedStyle(btn);
      const bg = style.backgroundColor;
      
      // Semantic text match
      if (btnText === targetWord.toLowerCase() || 
          btnText.startsWith(targetWord.toLowerCase()) || 
          (targetWord === 'Up' && (btnText.includes('call') || btnText.includes('higher'))) ||
          (targetWord === 'Down' && (btnText.includes('put') || btnText.includes('lower')))
      ) {
        btn.click();
        return { ok: true, method: 'semantic text fallback', classes: btn.className };
      }
      
      // Color match (Green for UP, Red for DOWN)
      // rgba(0, 178, 89, ...) typically green. rgba(240, 60, 60, ...) typically red
      if (targetWord === 'Up' && (btn.className.includes('success') || btn.className.includes('green') || bg.includes('178, 89'))) {
         btn.click();
         return { ok: true, method: 'color heuristic (green)', classes: btn.className };
      }
      if (targetWord === 'Down' && (btn.className.includes('danger') || btn.className.includes('red') || bg.includes('240, 60'))) {
         btn.click();
         return { ok: true, method: 'color heuristic (red)', classes: btn.className };
      }
    }

    // Debug: report what spans and buttons exist
    const spanTexts = Array.from(spans).map(s => `"${(s.textContent || '').trim()}"`).join(', ');
    const btnTexts = Array.from(buttons).slice(0, 8).map(b => `"${(b.textContent || '').trim().slice(0, 15)}"`).join(', ');
    return { ok: false, method: 'none', classes: '', debug: `spans=[${spanTexts}] buttons=[${btnTexts}]` };
  }, word);

  if (result.ok) {
    logger.browser(`✅ ${word.toUpperCase()} clicked instantly via ${result.method} (${result.classes})`);
    return { success: true, selectorUsed: result.method };
  }

  // If JS click somehow didn't find anything, try Playwright locator as last resort
  logger.browser(`⚠️ JS click missed, trying Playwright locator...`);
  const debug = (result as { debug?: string }).debug || '';
  logger.debug(`DOM state: ${debug}`);

  try {
    const loc = page.locator(`span.oQ4Z4:text-is("${word}")`).first();
    await loc.click({ force: true, timeout: 2000 });
    logger.browser(`✅ ${word.toUpperCase()} clicked via Playwright span locator`);
    return { success: true, selectorUsed: 'playwright_span_locator' };
  } catch {
    // ignore
  }

  try {
    const loc = page.locator(`button:has-text("${word}")`).first();
    await loc.click({ force: true, timeout: 2000 });
    logger.browser(`✅ ${word.toUpperCase()} clicked via Playwright button:has-text`);
    return { success: true, selectorUsed: 'playwright_button_hastext' };
  } catch {
    // ignore
  }

  throw new Error(`Could not find or click ${word} button. ${debug}`);
}

/**
 * Switches the account type between Live and Demo via direct URL navigation.
 */
export async function switchAccountType(page: Page, type: 'Live' | 'Demo'): Promise<boolean> {
  logger.browser(`🔄 Switching account type to ${type} Account via URL...`);
  try {
    let targetUrl = config.targetUrl;
    try {
      const baseUrl = new URL(config.targetUrl).origin;
      targetUrl = type === 'Demo' ? `${baseUrl}/en/demo-trade` : `${baseUrl}/en/trade`;
    } catch {}

    // Avoid unnecessary navigation if already on the correct URL (or a close variant)
    const currentUrl = page.url();
    const isAlreadyCorrect = type === 'Demo' ? currentUrl.includes('/demo-trade') : (currentUrl.includes('/trade') && !currentUrl.includes('/demo-trade'));
    
    if (!isAlreadyCorrect) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
      await page.waitForTimeout(1000); // Give the app a moment to render
    } else {
      logger.browser(`⚡ Already on ${type} Account URL. Skipping navigation.`);
    }

    logger.browser(`✅ Successfully switched to ${type} Account.`);
    return true;
  } catch (error) {
    logger.error(`❌ Failed to switch to ${type} Account`, error);
    return false;
  }
}

export async function executeAutomation(signal: TradeSignal): Promise<ExecutionResult> {
  const startTime = Date.now();
  ensureDirectories();

  if (signal.action === 'PREPARE') {
    try {
      return await handlePrepareTrigger(signal, startTime);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to pre-warm Chrome on PREPARE signal', error);
      return {
        success: false,
        signal,
        durationMs: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  let page: Page | null = null;
  let screenshotPath: string | undefined;

  logger.browser(`Starting automation for [${signal.action} ${signal.ticker}]...`);

  // Watchdog timeout to prevent infinite freezes (30 seconds)
  let watchdogTimer: NodeJS.Timeout;
  const watchdogPromise = new Promise<never>((_, reject) => {
    watchdogTimer = setTimeout(() => reject(new Error('WATCHDOG TIMEOUT: Task execution exceeded 30 seconds and was forcibly aborted.')), 30000);
  });

  const executionPromise = (async () => {
    const instance = await getBrowserAndPage(true);
    if (!instance) {
      throw new Error('Could not acquire browser page');
    }
    page = instance.page;

    await ensurePageOnTarget(page);
    await page.bringToFront().catch(() => {});

    // If it's just a BALANCE check request
    if (signal.action === 'BALANCE') {
      const balance = await balanceManager.extractAndRecordBalance(page);
      return {
        success: true,
        signal,
        durationMs: Date.now() - startTime,
        details: balance ? 'Balance extracted successfully' : 'Balance extraction failed to parse DOM',
        balance: balance || undefined,
      };
    }

    if (signal.action === 'SWITCH_LIVE' || signal.action === 'SWITCH_DEMO') {
      const type = signal.action === 'SWITCH_LIVE' ? 'Live' : 'Demo';
      const switched = await switchAccountType(page, type);
      return {
        success: switched,
        signal,
        durationMs: Date.now() - startTime,
        details: switched ? `Switched to ${type} Account` : `Failed to switch to ${type} Account`,
      };
    }

    const isGenericTicker =
      !signal.ticker ||
      ['ACTIVE', 'CURRENT', 'READY', 'STANDBY', 'ACCOUNT'].includes(signal.ticker.toUpperCase());

    if (!isGenericTicker) {
      await selectMarket(page, signal.ticker);
    }

    if (signal.durationMinutes !== undefined) {
      logger.browser(`Setting trade duration to: ${signal.durationMinutes} minutes`);
      const hours = Math.floor(signal.durationMinutes / 60);
      const minutes = signal.durationMinutes % 60;
      const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;

      const timeInput = page
        .locator('.section-deal__time input, input[name="time"], input[placeholder*="time" i]')
        .first();

      if (await timeInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await timeInput.click();
        // Clear existing value
        await page.keyboard.press('Control+A').catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        // Some brokers require typing slowly or directly filling
        await timeInput.fill(timeString);
        await page.keyboard.press('Enter').catch(() => {});
      } else {
        logger.warn(`Could not find time input to set ${signal.durationMinutes}m`);
      }
    }

    if (signal.action === 'SET_DURATION') {
      return {
        success: true,
        signal,
        durationMs: Date.now() - startTime,
        details: `Updated duration to ${signal.durationMinutes}m`,
      };
    }

    if (signal.action === 'ABORT') {
      logger.browser(`Abort signal received, ignoring previous preparations.`);
      return {
        success: true,
        signal,
        durationMs: Date.now() - startTime,
        details: `Aborted/Ignored as requested`,
      };
    }

    if (signal.price !== undefined) {
      logger.browser(`Entering amount/price: ${signal.price}`);
      const priceInput = page
        .getByRole('spinbutton', { name: /price|amount|investment|stake/i })
        .or(page.locator('input[name="amount"], input[name="investment"], .section-deal__investment input'))
        .first();
      if (await priceInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await priceInput.fill(signal.price.toString());
      }
    }

    // Execute instant UP or DOWN trade click using exact Quotex button selectors
    const clickResult = await clickTradeButton(page, signal.action);
    
    // Extract balance post-trade to capture updates
    await page.waitForTimeout(1000);
    const finalBalance = await balanceManager.extractAndRecordBalance(page);

    const durationMs = Date.now() - startTime;
    logger.browser(
      `Successfully completed automation for [${signal.action} ${signal.ticker}] in ${durationMs}ms (via ${clickResult.selectorUsed}).`
    );

    return {
      success: true,
      signal,
      durationMs,
      details: `Executed live on dedicated Cortex Browser (${clickResult.selectorUsed})`,
      balance: finalBalance || undefined,
    };
  })();

  try {
    // Race the actual execution against the 30-second watchdog
    return await Promise.race([executionPromise, watchdogPromise]);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Browser automation failed for [${signal.action} ${signal.ticker}]`, error);

    if (page && !(page as Page).isClosed()) {
      try {
        const timestamp = Date.now();
        const safeTicker = signal.ticker.replace(/[^a-zA-Z0-9_-]/g, '_');
        screenshotPath = path.resolve(
          config.screenshotsDir,
          `err_${timestamp}_${signal.action}_${safeTicker}.png`
        );
        await (page as Page).screenshot({ path: screenshotPath, fullPage: true });
        logger.error(`Captured error screenshot at: ${screenshotPath}`);
      } catch (screenshotError) {
        logger.error('Failed to capture failure screenshot', screenshotError);
      }
    }

    return {
      success: false,
      signal,
      durationMs,
      screenshotPath,
      error: errorMessage,
    };
  } finally {
    clearTimeout(watchdogTimer!);
  }
}

