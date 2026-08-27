import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import type { TradeSignal, ExecutionResult, AccountBalance, ActionType } from './types.js';
import { isUpAction, isDownAction } from './types.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { normalizeTicker } from './parser.js';
import { balanceManager } from './balance.js';

let globalContext: BrowserContext | null = null;

// getActiveMarket / setActiveMarket kept as no-ops for test compatibility
export function getActiveMarket(): string | null {
  return null;
}

export function setActiveMarket(_market: string | null): void {
  // no-op: we always switch market, never cache
}

function ensureDirectories(): void {
  const authDir = path.dirname(config.authStoragePath);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
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
    logger.browser(`Navigating Chrome to: ${config.targetUrl}`);
    await page.goto(config.targetUrl, {
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
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      if (errorMessage.includes('ProcessSingleton') || errorMessage.includes('locked')) {
        logger.error('===============================================================');
        logger.error('🚨 CHROME AUTOMATION FAILED - BROWSER ALREADY RUNNING 🚨');
        logger.error('===============================================================');
        logger.error(`The bot is trying to automate your specific Chrome Profile: "${config.chromeProfileName}"`);
        logger.error('But Chrome is currently open in the background! Playwright needs exclusive access.');
        logger.error('');
        logger.error('👉 HOW TO FIX:');
        logger.error('1. Fully close ALL Google Chrome windows.');
        logger.error('2. IMPORTANT: Check your system tray (bottom right corner, near the clock).');
        logger.error('   Right-click the Chrome icon there and click "Exit".');
        logger.error('3. If it still fails, run this in your terminal:  taskkill /IM chrome.exe /F');
        logger.error('4. Then run `npm run dev` again.');
        logger.error('===============================================================');
        throw new Error('Chrome is already running in the background. Please close it fully via the system tray or taskkill.');
      }
      logger.error('Failed to launch persistent context', err);
      throw err;
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
    await globalContext.close().catch(() => {});
    globalContext = null;
  }
}

/**
 * ALWAYS switches to the specified market — no caching, no "already active" skip.
 * Every time a signal includes a ticker, this runs the full switch sequence.
 *
 * Flow:
 *   1. Click the asset/pair selector to open the market picker
 *   2. Clear and type the ticker into the search box
 *   3. Click the first matching result
 *   4. Close the picker via Escape
 */
async function selectMarket(page: Page, rawTicker: string): Promise<void> {
  // Normalize: "USD CHF OTC" → "USD/CHF", "eur usd" → "EUR/USD"
  const searchName = normalizeTicker(rawTicker);
  if (!searchName) {
    logger.warn(`selectMarket called with empty ticker: "${rawTicker}"`);
    return;
  }

  logger.browser(`🔄 Switching market: "${rawTicker}" → "${searchName}"`);

  // Step 1: Open the market picker
  // Try multiple selectors for the asset/pair selector button
  const openerSelectors = [
    'button:has(svg.icon-plus):not(:has-text("Deposit"))',
    '.current-asset',
    '[class*="current-asset"]',
    '.assets-select',
    '[class*="assets-select"]',
    'button.icon-plus',
  ];

  let pickerOpened = false;
  for (const sel of openerSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        await btn.click({ force: true });
        pickerOpened = true;
        break;
      }
    } catch {}
  }

  if (!pickerOpened) {
    // Fallback: try clicking via JS on any element that looks like the asset picker
    await page.evaluate(() => {
      const el =
        document.querySelector('[class*="current-asset"]') ||
        document.querySelector('[class*="assets-select"]') ||
        document.querySelector('.trading-pair') ||
        document.querySelector('.pair-name');
      if (el) (el as HTMLElement).click();
    });
  }

  // Brief wait for picker animation
  await page.waitForTimeout(300);

  // Step 2: Find search input, clear it, type ticker
  const searchInput = page
    .locator('input[placeholder*="Search" i], input[type="search"], input[class*="search" i]')
    .or(page.getByPlaceholder(/search/i))
    .first();

  if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchInput.click();
    await searchInput.fill(''); // Clear first
    await searchInput.fill(searchName);
    logger.browser(`🔍 Typed "${searchName}" into search box`);

    // Wait for search results to load
    await page.waitForTimeout(500);

    // Step 3: Click the first matching market result
    // Try exact text match first, then partial
    let clicked = false;

    // Try via JS for speed — find any element in the results containing our search text
    clicked = await page.evaluate((search) => {
      // Look for result items in the picker that contain our ticker
      const allElements = document.querySelectorAll(
        '[class*="pair"], [class*="asset"], [class*="item"], [class*="result"], li, a, span, div'
      );

      for (const el of allElements) {
        const textClean = (el.textContent || '').toUpperCase().replace(/[\s\/\-_\(\)]/g, '');
        const searchClean = search.toUpperCase().replace(/[\s\/\-_\(\)]/g, '');

        if (textClean.includes(searchClean) || (el.textContent || '').toUpperCase().includes(search.toUpperCase())) {
          // Make sure it's inside a list/picker, not the header
          const isInPicker =
            el.closest('[class*="modal"]') ||
            el.closest('[class*="picker"]') ||
            el.closest('[class*="dropdown"]') ||
            el.closest('[class*="popup"]') ||
            el.closest('[class*="list"]') ||
            el.closest('[class*="search"]') ||
            el.closest('[class*="select"]');

          if (isInPicker && el instanceof HTMLElement) {
            el.click();
            return true;
          }
        }
      }
      return false;
    }, searchName);

    if (!clicked) {
      // Playwright fallback: try locator text match
      const resultLoc = page.locator(`text="${searchName}"`).or(page.getByText(searchName)).first();
      if (await resultLoc.isVisible({ timeout: 1000 }).catch(() => false)) {
        await resultLoc.click({ force: true });
        clicked = true;
      }
    }

    if (clicked) {
      logger.browser(`✅ Market switched to ${searchName}`);
    } else {
      logger.warn(`⚠️ Could not find "${searchName}" in search results — market may not have switched`);
    }
  } else {
    logger.warn('⚠️ Search input not found in market picker');
  }

  // Step 4: Close picker — Escape always works
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {}); // Double Escape for nested modals
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
    const balance = await balanceManager.extractAndRecordBalance(page);

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

    // Fallback: search every button for matching text content
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const btnText = (btn.textContent || '').trim().toLowerCase();
      if (btnText === targetWord.toLowerCase() || btnText.startsWith(targetWord.toLowerCase())) {
        btn.click();
        return { ok: true, method: 'button text fallback', classes: btn.className };
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

  try {
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

    const isGenericTicker =
      !signal.ticker ||
      ['ACTIVE', 'CURRENT', 'READY', 'STANDBY', 'ACCOUNT'].includes(signal.ticker.toUpperCase());

    if (!isGenericTicker) {
      await selectMarket(page, signal.ticker);
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
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Browser automation failed for [${signal.action} ${signal.ticker}]`, error);

    if (page && !page.isClosed()) {
      try {
        const timestamp = Date.now();
        const safeTicker = signal.ticker.replace(/[^a-zA-Z0-9_-]/g, '_');
        screenshotPath = path.resolve(
          config.screenshotsDir,
          `err_${timestamp}_${signal.action}_${safeTicker}.png`
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
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
  }
}
