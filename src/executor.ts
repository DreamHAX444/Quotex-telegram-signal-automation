import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { TradeSignal, ExecutionResult, AccountBalance, ActionType } from './types.js';
import { isUpAction, isDownAction } from './types.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { balanceManager } from './balance.js';

let globalContext: BrowserContext | null = null;

/**
 * ═══════════════════════════════════════════════════════════════════
 * MARKET STATE MANAGEMENT (Rebuilt from scratch)
 * ═══════════════════════════════════════════════════════════════════
 * The cache is ONLY updated after a verified DOM read confirms the
 * market actually changed. It auto-expires after 60 seconds so we
 * never trust a stale value when the user might have switched
 * manually inside Chrome.
 */
let currentActiveMarket: string | null = null;
let lastVerifiedAt: number = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

export function getActiveMarket(): string | null {
  if (currentActiveMarket && (Date.now() - lastVerifiedAt) > CACHE_TTL_MS) {
    // Cache expired — force re-check from DOM on next selectMarket call
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
 * TICKER UTILITIES (Rebuilt from scratch)
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * Strips ALL non-alphanumeric characters and uppercases for comparison.
 * "EUR/USD (OTC)" → "EURUSDOTC"
 * "USD CHF OTC"   → "USDCHFOTC"
 * "EURUSD"        → "EURUSD"
 */
function canonicalize(ticker: string): string {
  return ticker.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Fuzzy-matches two ticker representations.
 * Handles all the ways Quotex might display a market vs how the signal
 * sender types it:
 *   "EUR/USD OTC"     ↔ "EUR/USD (OTC)"   ✅
 *   "USD CHF OTC"     ↔ "USD/CHF (OTC)"   ✅
 *   "EURUSD"          ↔ "EUR/USD"          ✅
 *   "GOLD"            ↔ "Gold"             ✅
 *   "EUR/USD"         ↔ "EUR/USD (OTC)"    ❌ (different market!)
 */
function tickersMatch(signalTicker: string, domTicker: string): boolean {
  const a = canonicalize(signalTicker);
  const b = canonicalize(domTicker);
  if (!a || !b) return false;

  // Exact canonical match
  if (a === b) return true;

  // Check OTC mismatch: if one has OTC and the other doesn't, they're different markets
  const aHasOtc = a.includes('OTC');
  const bHasOtc = b.includes('OTC');
  if (aHasOtc !== bHasOtc) return false;

  // Strip OTC from both and compare the base pair
  const aBase = a.replace('OTC', '');
  const bBase = b.replace('OTC', '');
  return aBase === bBase;
}

/**
 * Converts a raw ticker from the signal parser into:
 *   - query:    The text to type into Quotex's search box (NEVER includes "OTC"
 *               because Quotex search doesn't support it — it just hides all results)
 *   - wantsOtc: Whether the original signal asked for the OTC variant
 *   - fullName: The complete ticker with OTC for logging / matching
 *
 * Examples:
 *   "USD CHF OTC" → { query: "USD/CHF", wantsOtc: true,  fullName: "USD/CHF OTC" }
 *   "EUR USD"     → { query: "EUR/USD", wantsOtc: false, fullName: "EUR/USD" }
 *   "EURUSD"      → { query: "EUR/USD", wantsOtc: false, fullName: "EUR/USD" }
 *   "GOLD"        → { query: "GOLD",    wantsOtc: false, fullName: "GOLD" }
 *   "EUR/USD OTC" → { query: "EUR/USD", wantsOtc: true,  fullName: "EUR/USD OTC" }
 */
function buildSearchQuery(rawTicker: string): { query: string; wantsOtc: boolean; fullName: string } {
  if (!rawTicker || typeof rawTicker !== 'string') return { query: '', wantsOtc: false, fullName: '' };

  let cleaned = rawTicker.trim();

  // Remove timeframe suffixes (1M, 5M, 1 MIN, etc.)
  cleaned = cleaned
    .replace(/\b(?:1M|2M|3M|5M|15M|30M|1\s*MIN(?:UTE)?S?|2\s*MIN(?:UTE)?S?|3\s*MIN(?:UTE)?S?|5\s*MIN(?:UTE)?S?|15\s*MIN(?:UTE)?S?|NOW)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract and strip OTC flag
  const wantsOtc = /\bOTC\b/i.test(cleaned);
  const withoutOtc = cleaned.replace(/\bOTC\b/gi, '').trim();

  let basePair: string;

  // If it already has a slash, keep it as-is
  if (withoutOtc.includes('/')) {
    basePair = withoutOtc.toUpperCase();
  }
  // Space-separated pair: "USD CHF" → "USD/CHF"
  else {
    const spaceParts = withoutOtc.split(/\s+/).filter(Boolean);
    if (spaceParts.length === 2 && spaceParts[0]!.length >= 2 && spaceParts[0]!.length <= 5 && spaceParts[1]!.length >= 2 && spaceParts[1]!.length <= 5) {
      basePair = `${spaceParts[0]}/${spaceParts[1]}`.toUpperCase();
    }
    // Concatenated 6-letter pair: "EURUSD" → "EUR/USD"
    else if (withoutOtc.length === 6 && /^[A-Za-z]+$/.test(withoutOtc)) {
      basePair = `${withoutOtc.slice(0, 3)}/${withoutOtc.slice(3, 6)}`.toUpperCase();
    }
    // Single ticker (GOLD, BTC, AAPL, etc.)
    else {
      basePair = withoutOtc.toUpperCase();
    }
  }

  return {
    query: basePair,              // What goes into the search box (NO OTC)
    wantsOtc,                     // Whether to prefer the OTC result
    fullName: wantsOtc ? `${basePair} OTC` : basePair,  // For logging & matching
  };
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
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings.defaultAccount === 'Live' || settings.defaultAccount === 'Demo') {
          defaultAccount = settings.defaultAccount;
        }
      }
    } catch {}

    let targetUrl = config.targetUrl;
    try {
      const baseUrl = new URL(config.targetUrl).origin;
      targetUrl = defaultAccount === 'Demo' ? `${baseUrl}/en/demo-trade` : `${baseUrl}/en/trade`;
    } catch {}

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
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (settings.defaultAccount === 'Live' || settings.defaultAccount === 'Demo') {
              defaultAccount = settings.defaultAccount;
            }
          }
          
          const startupPage = globalContext.pages()[0] || await globalContext.newPage();
          let targetUrl = config.targetUrl;
          try {
            const baseUrl = new URL(config.targetUrl).origin;
            targetUrl = defaultAccount === 'Demo' ? `${baseUrl}/en/demo-trade` : `${baseUrl}/en/trade`;
          } catch {}
          
          logger.browser(`🔄 Startup check: Opening default ${defaultAccount} Account URL...`);
          await startupPage.goto(targetUrl, { waitUntil: 'domcontentloaded' });
          await balanceManager.extractAndRecordBalance(startupPage);
        } catch (startupErr) {
          logger.warn('⚠️ Failed to enforce default account on browser startup', startupErr);
        }

        break; // Success, exit retry loop
      } catch (err: any) {
        const errorMessage = err?.message || String(err);
        if (errorMessage.includes('ProcessSingleton') || errorMessage.includes('locked')) {
          retryCount++;
          logger.error(`🚨 BROWSER PROFILE LOCKED. Attempting auto-cleanup (Attempt ${retryCount}/2)...`);
          try {
            // Forcefully terminate zombie Chrome processes for this profile
            if (process.platform === 'win32') {
              try {
                execSync(`wmic process where "name='chrome.exe' and commandline like '%${config.chromeProfileName}%'" call terminate`, { stdio: 'ignore' });
              } catch {
                execSync('taskkill /IM chrome.exe /F', { stdio: 'ignore' });
              }
            } else {
              execSync(`pkill -f "chrome.*${config.chromeProfileName}"`, { stdio: 'ignore' });
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
          } catch (cleanupErr) {
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
 * MARKET SWITCHING ENGINE — REBUILT FROM SCRATCH
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   1. readActiveMarketFromDOM()  — Reads what Quotex currently shows
 *   2. openMarketPicker()         — Opens the asset picker reliably
 *   3. searchAndSelectMarket()    — Types query & clicks correct result
 *   4. verifyMarketSwitched()     — Confirms the switch happened
 *   5. selectMarket()             — Orchestrates the full flow
 *
 * Every step has its own timeout, fallback strategy, and error handling.
 * The memory cache is ONLY updated after DOM verification confirms success.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Step 1: Reads the currently active market name directly from the Quotex DOM.
 * Returns the raw text shown on screen (e.g. "EUR/USD (OTC)", "Gold", "BTC/USD").
 * Returns null if it can't read it.
 */
async function readActiveMarketFromDOM(page: Page): Promise<string | null> {
  try {
    const domText = await page.evaluate(() => {
      // Quotex displays the active asset name in the trading header area.
      // We try multiple known selector patterns from most specific to generic.
      const selectors = [
        // Quotex-specific: the clickable pair name in the header
        '.pair-name',
        '.current-asset',
        '[class*="current-asset"]',
        '.assets-select',
        '[class*="assets-select"]',
        '.trading-pair',
        // Generic fallback: any element that looks like an asset display
        '[class*="pair-name"]',
        '[class*="trading-pair"]',
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const text = el.textContent.trim();
          // Sanity check: a valid market name is 3-30 chars and contains letters
          if (text.length >= 3 && text.length <= 30 && /[A-Za-z]/.test(text)) {
            return text;
          }
        }
      }
      return null;
    });
    return domText;
  } catch {
    return null;
  }
}

/**
 * Step 2: Opens the Quotex asset/market picker modal.
 * Tries multiple strategies and waits for the picker to actually appear.
 * Returns true if the picker was successfully opened.
 */
async function openMarketPicker(page: Page): Promise<boolean> {
  // Strategy A: Click known opener elements via Playwright locators
  const openerSelectors = [
    '.pair-name',
    '.current-asset',
    '[class*="current-asset"]',
    '.assets-select',
    '[class*="assets-select"]',
    '.trading-pair',
    '[class*="pair-name"]',
    '[class*="trading-pair"]',
  ];

  for (const sel of openerSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 400 }).catch(() => false)) {
        await btn.click({ force: true });
        // Wait briefly for picker animation
        await page.waitForTimeout(400);

        // Check if a search input appeared (strong signal the picker is open)
        const hasSearch = await page
          .locator('input[placeholder*="Search" i], input[type="search"], input[class*="search" i]')
          .first()
          .isVisible({ timeout: 1500 })
          .catch(() => false);

        if (hasSearch) {
          logger.browser(`📂 Market picker opened via: ${sel}`);
          return true;
        }
      }
    } catch {
      // Try next selector
    }
  }

  // Strategy B: JavaScript fallback — click via DOM query
  const jsOpened = await page.evaluate(() => {
    const candidates = [
      document.querySelector('[class*="current-asset"]'),
      document.querySelector('[class*="assets-select"]'),
      document.querySelector('.pair-name'),
      document.querySelector('.trading-pair'),
      document.querySelector('[class*="pair-name"]'),
      document.querySelector('[class*="trading-pair"]'),
    ];
    for (const el of candidates) {
      if (el && el instanceof HTMLElement) {
        el.click();
        return true;
      }
    }
    return false;
  });

  if (jsOpened) {
    await page.waitForTimeout(600);
    // Check if search input appeared
    const hasSearch = await page
      .locator('input[placeholder*="Search" i], input[type="search"], input[class*="search" i]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (hasSearch) {
      logger.browser('📂 Market picker opened via JS fallback');
      return true;
    }
  }

  // Strategy C: Try clicking a "+" button that some Quotex versions use
  try {
    // Exclude the "Deposit" button which also has a plus icon
    const plusBtn = page.locator('button:has(svg[class*="plus"]):not(:has-text("Deposit")), button:has(svg[class*="Plus"]):not(:has-text("Deposit"))').first();
    if (await plusBtn.isVisible({ timeout: 400 }).catch(() => false)) {
      await plusBtn.click({ force: true });
      await page.waitForTimeout(500);
      logger.browser('📂 Market picker opened via plus button');
      return true;
    }
  } catch {
    // Continue
  }

  logger.warn('⚠️ Could not open market picker with any strategy');
  return false;
}

/**
 * Step 3: Types the search query into the picker and clicks the best matching result.
 * Results are STRICTLY scoped to the picker container — never clicks random page elements.
 * Returns true if a result was clicked.
 */
async function searchAndSelectMarket(page: Page, searchQuery: string, wantsOtc: boolean): Promise<boolean> {
  // Find the search input inside the picker
  const searchInput = page
    .locator('input[placeholder*="Search" i], input[type="search"], input[class*="search" i]')
    .first();

  const isSearchVisible = await searchInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (!isSearchVisible) {
    logger.warn('⚠️ Search input not found in market picker');
    return false;
  }

  // CRITICAL: Only type the base pair name (e.g. "EUR/USD"), NEVER "OTC".
  // Quotex search doesn't understand "OTC" and will show zero results.
  // We use the wantsOtc flag in the scoring logic to pick the right variant.
  await searchInput.click();
  await searchInput.fill('');
  await page.waitForTimeout(100);
  await searchInput.fill(searchQuery);
  logger.browser(`🔍 Typed "${searchQuery}" into picker search box (wantsOtc=${wantsOtc})`);

  // Wait for search results to render
  await page.waitForTimeout(800);

  // Attempt to click the best matching result using scoped DOM search
  const searchCanonical = canonicalize(searchQuery);
  const hasOtcInQuery = wantsOtc;

  const clicked = await page.evaluate(
    ({ searchCanonical, hasOtcInQuery }) => {
      /**
       * Helper: Canonicalize inside the browser context
       */
      function canon(s: string): string {
        return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
      }

      /**
       * Helper: Check if an element is inside a picker/modal/dropdown container
       */
      function isInsidePicker(el: Element): boolean {
        const container = el.closest(
          '[class*="modal"], [class*="picker"], [class*="dropdown"], ' +
          '[class*="popup"], [class*="overlay"], [class*="dialog"], ' +
          '[class*="list"], [class*="search-result"], [class*="select"], ' +
          '[role="dialog"], [role="listbox"], [role="menu"]'
        );
        return container !== null;
      }

      /**
       * Helper: Score how well a DOM element matches our target
       * Higher score = better match. -1 = no match.
       */
      function scoreMatch(el: Element): number {
        const text = (el.textContent || '').trim();
        if (!text || text.length < 3 || text.length > 50) return -1;

        const textCanon = canon(text);
        if (!textCanon) return -1;

        // Must be inside a picker, not random page content
        if (!isInsidePicker(el)) return -1;

        // Must be a reasonably-sized clickable element (not a giant container)
        const rect = el.getBoundingClientRect();
        if (rect.height > 100 || rect.height < 10 || rect.width < 30) return -1;

        // Exact canonical match: highest score
        if (textCanon === searchCanonical) return 100;

        // Check OTC consistency: if query has OTC, result must have OTC and vice versa
        const resultHasOtc = textCanon.includes('OTC');
        if (hasOtcInQuery !== resultHasOtc) return -1;

        // Base pair match (strip OTC from both)
        const queryBase = searchCanonical.replace('OTC', '');
        const resultBase = textCanon.replace('OTC', '');
        if (queryBase === resultBase) return 90;

        // Partial match: query is contained in result
        if (textCanon.includes(searchCanonical)) return 70;

        // Partial match: result starts with query
        if (textCanon.startsWith(searchCanonical.replace('OTC', ''))) return 50;

        return -1;
      }

      // Scan all potentially clickable elements inside the picker
      const candidates = document.querySelectorAll(
        'li, a, [class*="item"], [class*="pair"], [class*="asset"], ' +
        '[class*="result"], [class*="option"], [role="option"], ' +
        '[class*="row"], button'
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
        bestEl.click();
        return true;
      }

      // Broader fallback: scan ALL elements but only inside picker containers
      const allElements = document.querySelectorAll('div, span');
      for (const el of allElements) {
        const score = scoreMatch(el);
        if (score >= 70) {
          (el as HTMLElement).click();
          return true;
        }
      }

      return false;
    },
    { searchCanonical, hasOtcInQuery }
  );

  if (clicked) {
    logger.browser(`✅ Clicked search result for "${searchQuery}"`);
    // Wait for picker to close and market to load
    await page.waitForTimeout(500);
    return true;
  }

  // Playwright text locator fallback (scoped attempts)
  try {
    const textLoc = page.getByText(searchQuery, { exact: false }).first();
    if (await textLoc.isVisible({ timeout: 800 }).catch(() => false)) {
      await textLoc.click({ force: true });
      logger.browser(`✅ Clicked result via Playwright text locator for "${searchQuery}"`);
      await page.waitForTimeout(500);
      return true;
    }
  } catch {
    // Ignore
  }

  logger.warn(`⚠️ Could not find "${searchQuery}" in picker search results`);
  return false;
}

/**
 * Step 4: Verifies the market switch actually happened by re-reading the DOM.
 * Returns true if the currently displayed market matches our target.
 */
async function verifyMarketSwitched(page: Page, targetTicker: string): Promise<boolean> {
  // Give the UI a moment to settle after the switch
  await page.waitForTimeout(300);

  const currentMarket = await readActiveMarketFromDOM(page);
  if (!currentMarket) {
    logger.warn('⚠️ Could not read current market from DOM for verification');
    return false;
  }

  if (tickersMatch(targetTicker, currentMarket)) {
    logger.browser(`✅ VERIFIED: Market is now "${currentMarket}"`);
    setActiveMarket(currentMarket);
    return true;
  }

  logger.warn(`⚠️ Verification failed: Expected "${targetTicker}", but DOM shows "${currentMarket}"`);
  return false;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MAIN ORCHESTRATOR: selectMarket()
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Full flow:
 *   1. Build the search query (preserves OTC, formats pair correctly)
 *   2. Check DOM for current market (never trust cache alone)
 *   3. If already on the correct market → skip
 *   4. Open the asset picker
 *   5. Search and click the target market
 *   6. Verify the switch happened
 *   7. If verification fails → retry once
 *   8. Close any lingering picker modals
 */
async function selectMarket(page: Page, rawTicker: string): Promise<void> {
  // Build the search query — strips OTC from search text but tracks it as a flag
  const { query: searchQuery, wantsOtc, fullName } = buildSearchQuery(rawTicker);
  if (!searchQuery) {
    logger.warn(`selectMarket: Empty search query from raw ticker "${rawTicker}"`);
    return;
  }

  logger.browser(`🔄 Market switch requested: "${rawTicker}" → search: "${searchQuery}" (OTC: ${wantsOtc})`);

  // ── Step 1: Check if already on the correct market via DOM ──────────
  const currentDomMarket = await readActiveMarketFromDOM(page);
  if (currentDomMarket && tickersMatch(fullName, currentDomMarket)) {
    logger.browser(`⚡ Market "${currentDomMarket}" is already active (verified from DOM). Skipping switch!`);
    setActiveMarket(currentDomMarket);
    return;
  }

  // ── Step 2: Also check memory cache (but only if fresh) ────────────
  const cachedMarket = getActiveMarket();
  if (cachedMarket && tickersMatch(fullName, cachedMarket)) {
    // Cache says it matches, but let's trust it only if DOM check was inconclusive
    if (!currentDomMarket) {
      logger.browser(`⚡ Market "${cachedMarket}" is active per memory cache (DOM unreadable). Skipping switch!`);
      return;
    }
  }

  // ── Step 3: Open picker, search, and select (with 1 retry) ─────────
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) {
      logger.browser('🔁 Retrying market switch (attempt 2/2)...');
      // Close any lingering modals before retry
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }

    // Open the picker
    const pickerOpened = await openMarketPicker(page);
    if (!pickerOpened) {
      logger.warn(`⚠️ Failed to open market picker (attempt ${attempt}/2)`);
      continue;
    }

    // Search and click
    const resultClicked = await searchAndSelectMarket(page, searchQuery, wantsOtc);

    // Close any lingering picker
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});

    if (!resultClicked) {
      logger.warn(`⚠️ Failed to click search result (attempt ${attempt}/2)`);
      continue;
    }

    // Verify the switch
    const verified = await verifyMarketSwitched(page, fullName);
    if (verified) {
      logger.browser(`🎯 Market successfully switched to "${fullName}" on attempt ${attempt}`);
      return;
    }
  }

  // Both attempts failed — log but don't crash the trade
  logger.warn(`❌ Market switch to "${fullName}" could not be verified after 2 attempts. Proceeding with current market.`);
  // Close any remaining modals
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
  const debug = (result as any).debug || '';
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
