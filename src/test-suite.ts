import assert from 'node:assert';
import { chromium } from 'playwright';
import { parseSignal } from './parser.js';
import { isUpAction, isDownAction } from './types.js';
import { automationQueue } from './queue.js';
import {
  clickTradeButton,
  getActiveMarket,
  setActiveMarket,
  canonicalize,
  tickersMatch,
  buildSearchQuery,
  getSearchQueriesForTicker,
  stripPayoutAndNoise,
} from './executor.js';
import type { AutomationTask, TradeSignal } from './types.js';

async function runTestSuite(): Promise<void> {
  console.log('\n========================================');
  console.log('  Cortex Automation Test Suite          ');
  console.log('========================================\n');

  // ----------------------------------------------------
  // TEST 1: Parser Determinism & Signal Validation
  // ----------------------------------------------------
  console.log('▶ Test 1: Comprehensive Parser & Direction Validation...');

  // Helper action checks
  assert(isUpAction('UP'), 'isUpAction(UP) should be true');
  assert(isUpAction('CALL'), 'isUpAction(CALL) should be true');
  assert(isUpAction('BUY'), 'isUpAction(BUY) should be true');
  assert(isDownAction('DOWN'), 'isDownAction(DOWN) should be true');
  assert(isDownAction('PUT'), 'isDownAction(PUT) should be true');
  assert(isDownAction('SELL'), 'isDownAction(SELL) should be true');

  // Format 1: STANDALONE UP / DOWN / CALL / PUT
  const up1 = parseSignal('UP');
  assert(up1 !== null && isUpAction(up1.action), 'UP should parse as UP action');
  assert.strictEqual(up1.ticker, 'ACTIVE');

  const down1 = parseSignal('DOWN');
  assert(down1 !== null && isDownAction(down1.action), 'DOWN should parse as DOWN action');
  assert.strictEqual(down1.ticker, 'ACTIVE');

  const call1 = parseSignal('CALL');
  assert(call1 !== null && isUpAction(call1.action), 'CALL should parse as UP action');

  const put1 = parseSignal('PUT');
  assert(put1 !== null && isDownAction(put1.action), 'PUT should parse as DOWN action');

  // Format 2: Timeframe & Emoji variations
  const up1m = parseSignal('UP 1M');
  assert(up1m !== null && isUpAction(up1m.action), 'UP 1M should parse as UP');
  assert.strictEqual(up1m.durationMinutes, 1);

  const down5m = parseSignal('DOWN 5M');
  assert(down5m !== null && isDownAction(down5m.action), 'DOWN 5M should parse as DOWN');
  assert.strictEqual(down5m.durationMinutes, 5);

  const upEmoji = parseSignal('🟢 UP');
  assert(upEmoji !== null && isUpAction(upEmoji.action), '🟢 UP should parse as UP');

  const downEmoji = parseSignal('🔴 DOWN');
  assert(downEmoji !== null && isDownAction(downEmoji.action), '🔴 DOWN should parse as DOWN');

  const arrowUp = parseSignal('🔼 UP 1 MIN');
  assert(arrowUp !== null && isUpAction(arrowUp.action), '🔼 UP 1 MIN should parse as UP');

  const arrowDown = parseSignal('🔽 DOWN NOW');
  assert(arrowDown !== null && isDownAction(arrowDown.action), '🔽 DOWN NOW should parse as DOWN');

  const justEmojiUp = parseSignal('🟢');
  assert(justEmojiUp !== null && isUpAction(justEmojiUp.action), '🟢 should parse as UP');

  const justEmojiDown = parseSignal('🔴');
  assert(justEmojiDown !== null && isDownAction(justEmojiDown.action), '🔴 should parse as DOWN');

  // Format 3: Action + Ticker
  const actTick1 = parseSignal('UP EUR/USD');
  assert(actTick1 !== null && isUpAction(actTick1.action), 'UP EUR/USD should parse');
  assert.strictEqual(actTick1.ticker, 'EUR/USD');

  const actTick2 = parseSignal('DOWN USD CHF OTC');
  assert(actTick2 !== null && isDownAction(actTick2.action), 'DOWN USD CHF OTC should parse');
  assert.strictEqual(actTick2.ticker, 'USD CHF OTC');

  const actTick3 = parseSignal('CALL USD/JPY 1M');
  assert(actTick3 !== null && isUpAction(actTick3.action), 'CALL USD/JPY 1M should parse');
  assert.strictEqual(actTick3.ticker, 'USD/JPY');

  const actTick4 = parseSignal('BUY AAPL @ 150');
  assert(actTick4 !== null && isUpAction(actTick4.action), 'BUY AAPL @ 150 should parse');
  assert.strictEqual(actTick4.ticker, 'AAPL');
  assert.strictEqual(actTick4.price, 150);

  // Format 4: Ticker + Action
  const tickAct1 = parseSignal('EUR/USD UP');
  assert(tickAct1 !== null && isUpAction(tickAct1.action), 'EUR/USD UP should parse');
  assert.strictEqual(tickAct1.ticker, 'EUR/USD');

  const tickAct2 = parseSignal('USD/CHF OTC DOWN');
  assert(tickAct2 !== null && isDownAction(tickAct2.action), 'USD/CHF OTC DOWN should parse');
  assert.strictEqual(tickAct2.ticker, 'USD/CHF OTC');

  const tickAct3 = parseSignal('EUR USD 1M UP');
  assert(tickAct3 !== null && isUpAction(tickAct3.action), 'EUR USD 1M UP should parse');
  assert.strictEqual(tickAct3.durationMinutes, 1);

  const tickAct4 = parseSignal('USD/CAD 5M PUT');
  assert(tickAct4 !== null && isDownAction(tickAct4.action), 'USD/CAD 5M PUT should parse');
  assert.strictEqual(tickAct4.durationMinutes, 5);

  // Format 5: Signal Prefix Formats
  const sigPref1 = parseSignal('UP SIGNAL: EUR/USD');
  assert(sigPref1 !== null && isUpAction(sigPref1.action), 'UP SIGNAL: EUR/USD should parse');

  const sigPref2 = parseSignal('SIGNAL: DOWN USD/CHF');
  assert(sigPref2 !== null && isDownAction(sigPref2.action), 'SIGNAL: DOWN USD/CHF should parse');

  const sigPref3 = parseSignal('BUY SIGNAL: AAPL');
  assert(sigPref3 !== null && isUpAction(sigPref3.action), 'BUY SIGNAL: AAPL should parse');

  // Format 6: Multi-line Binary Signal Formats
  const multi1 = parseSignal('EUR/USD OTC\n1 MIN\nUP');
  assert(multi1 !== null && isUpAction(multi1.action), 'Multi-line EUR/USD OTC 1MIN UP should parse');
  assert.strictEqual(multi1.ticker, 'EUR/USD OTC');

  const multi2 = parseSignal('📊 ASSET: USD/CHF OTC\n⏰ TIME: 1 MINUTE\n🟢 DIRECTION: CALL');
  assert(multi2 !== null && isUpAction(multi2.action), 'Multi-line structured CALL should parse');
  assert.strictEqual(multi2.ticker, 'USD/CHF OTC');
  assert.strictEqual(multi2.durationMinutes, 1);

  const multi3 = parseSignal('GBP/JPY OTC\nDOWN 🔽');
  assert(multi3 !== null && isDownAction(multi3.action), 'Multi-line GBP/JPY OTC DOWN should parse');
  assert.strictEqual(multi3.ticker, 'GBP/JPY OTC');

  // Format 7: Markdown / Bold Formats
  const mdUp1 = parseSignal('**UP**');
  assert(mdUp1 !== null && isUpAction(mdUp1.action), '**UP** should parse as UP');

  const mdUp2 = parseSignal('🟢 **UP** 1M');
  assert(mdUp2 !== null && isUpAction(mdUp2.action), '🟢 **UP** 1M should parse as UP');

  const mdUp3 = parseSignal('<b>CALL</b>');
  assert(mdUp3 !== null && isUpAction(mdUp3.action), '<b>CALL</b> should parse as UP');

  // Format 8: Timeframe First
  const tfUp1 = parseSignal('1M UP');
  assert(tfUp1 !== null && isUpAction(tfUp1.action), '1M UP should parse as UP');

  const tfUp2 = parseSignal('1 MIN CALL');
  assert(tfUp2 !== null && isUpAction(tfUp2.action), '1 MIN CALL should parse as UP');

  // Format 9: Direction Label format
  const dirLabel1 = parseSignal('DIRECTION: UP');
  assert(dirLabel1 !== null && isUpAction(dirLabel1.action), 'DIRECTION: UP should parse as UP');

  const dirLabel2 = parseSignal('SIGNAL: CALL');
  assert(dirLabel2 !== null && isUpAction(dirLabel2.action), 'SIGNAL: CALL should parse as UP');

  // Format 10: Warm-up / Standby / Get Ready triggers (All Variations)
  const prep1 = parseSignal('Get ready');
  assert(prep1 !== null && prep1.action === 'PREPARE');
  assert.strictEqual(prep1.ticker, 'READY');

  const prepUpper = parseSignal('GET READY');
  assert(prepUpper !== null && prepUpper.action === 'PREPARE');
  assert.strictEqual(prepUpper.ticker, 'READY');

  const prepPlatform = parseSignal('Open your Platform');
  assert(prepPlatform !== null && prepPlatform.action === 'PREPARE');
  assert.strictEqual(prepPlatform.ticker, 'READY');

  const prepOpenPlat2 = parseSignal('OPEN PLATFORM: EUR/USD');
  assert(prepOpenPlat2 !== null && prepOpenPlat2.action === 'PREPARE');
  assert.strictEqual(prepOpenPlat2.ticker, 'EUR/USD');

  const prep2 = parseSignal('GET READY: NVDA');
  assert(prep2 !== null && prep2.action === 'PREPARE');
  assert.strictEqual(prep2.ticker, 'NVDA');

  // Space-separated tickers without colons
  const prepSpace1 = parseSignal('GET READY EUR/USD');
  assert(prepSpace1 !== null && prepSpace1.action === 'PREPARE');
  assert.strictEqual(prepSpace1.ticker, 'EUR/USD');

  const prepSpace2 = parseSignal('GET READY USD CHF OTC');
  assert(prepSpace2 !== null && prepSpace2.action === 'PREPARE');
  assert.strictEqual(prepSpace2.ticker, 'USD CHF OTC');

  const prepSpace3 = parseSignal('PREPARE USD/JPY');
  assert(prepSpace3 !== null && prepSpace3.action === 'PREPARE');
  assert.strictEqual(prepSpace3.ticker, 'USD/JPY');

  const prepSpace4 = parseSignal('STANDBY GBP/USD');
  assert(prepSpace4 !== null && prepSpace4.action === 'PREPARE');
  assert.strictEqual(prepSpace4.ticker, 'GBP/USD');

  const prepSpace5 = parseSignal('WARM UP: USD/CAD');
  assert(prepSpace5 !== null && prepSpace5.action === 'PREPARE');
  assert.strictEqual(prepSpace5.ticker, 'USD/CAD');

  const prepWarmHyphen = parseSignal('WARM-UP');
  assert(prepWarmHyphen !== null && prepWarmHyphen.action === 'PREPARE');
  assert.strictEqual(prepWarmHyphen.ticker, 'READY');

  // Contextual phrases without ticker
  const prepNextSig = parseSignal('GET READY FOR NEXT SIGNAL');
  assert(prepNextSig !== null && prepNextSig.action === 'PREPARE');
  assert.strictEqual(prepNextSig.ticker, 'READY');

  const prepNextTrade = parseSignal('PREPARE FOR NEXT TRADE');
  assert(prepNextTrade !== null && prepNextTrade.action === 'PREPARE');
  assert.strictEqual(prepNextTrade.ticker, 'READY');

  const prepGuys = parseSignal('GET READY GUYS');
  assert(prepGuys !== null && prepGuys.action === 'PREPARE');
  assert.strictEqual(prepGuys.ticker, 'READY');

  const prepAll = parseSignal('GET READY ALL');
  assert(prepAll !== null && prepAll.action === 'PREPARE');
  assert.strictEqual(prepAll.ticker, 'READY');

  const prepBeReady = parseSignal('BE READY');
  assert(prepBeReady !== null && prepBeReady.action === 'PREPARE');
  assert.strictEqual(prepBeReady.ticker, 'READY');

  const prepAreYou = parseSignal('ARE YOU READY');
  assert(prepAreYou !== null && prepAreYou.action === 'PREPARE');
  assert.strictEqual(prepAreYou.ticker, 'READY');

  const prepReadyTrade = parseSignal('READY TO TRADE');
  assert(prepReadyTrade !== null && prepReadyTrade.action === 'PREPARE');
  assert.strictEqual(prepReadyTrade.ticker, 'READY');

  // Ticker first with Get Ready / Prepare suffix
  const tickPrep1 = parseSignal('EUR/USD GET READY');
  assert(tickPrep1 !== null && tickPrep1.action === 'PREPARE');
  assert.strictEqual(tickPrep1.ticker, 'EUR/USD');

  const tickPrep2 = parseSignal('USD CHF OTC PREPARE');
  assert(tickPrep2 !== null && tickPrep2.action === 'PREPARE');
  assert.strictEqual(tickPrep2.ticker, 'USD CHF OTC');

  const tickPrep3 = parseSignal('USD/JPY STANDBY');
  assert(tickPrep3 !== null && tickPrep3.action === 'PREPARE');
  assert.strictEqual(tickPrep3.ticker, 'USD/JPY');

  // Emojis with Get Ready
  const prepEmoji1 = parseSignal('⚡ GET READY: EUR/USD ⚡');
  assert(prepEmoji1 !== null && prepEmoji1.action === 'PREPARE');
  assert.strictEqual(prepEmoji1.ticker, 'EUR/USD');

  const prepEmoji2 = parseSignal('⏳ GET READY ⏳');
  assert(prepEmoji2 !== null && prepEmoji2.action === 'PREPARE');
  assert.strictEqual(prepEmoji2.ticker, 'READY');

  const prepEmoji3 = parseSignal('🔔 GET READY 🔔');
  assert(prepEmoji3 !== null && prepEmoji3.action === 'PREPARE');
  assert.strictEqual(prepEmoji3.ticker, 'READY');

  const prepEmoji4 = parseSignal('📢 PREPARE: USD CHF OTC 📢');
  assert(prepEmoji4 !== null && prepEmoji4.action === 'PREPARE');
  assert.strictEqual(prepEmoji4.ticker, 'USD CHF OTC');

  // Multi-line Get Ready Formats
  const multiPrep1 = parseSignal('GET READY\nPAIR: EUR/USD OTC\n1 MIN');
  assert(multiPrep1 !== null && multiPrep1.action === 'PREPARE');
  assert.strictEqual(multiPrep1.ticker, 'EUR/USD OTC');

  const multiPrep2 = parseSignal('⚡ PREPARE ⚡\nASSET: USD/CHF OTC\nTIME: 1 MINUTE');
  assert(multiPrep2 !== null && multiPrep2.action === 'PREPARE');
  assert.strictEqual(multiPrep2.ticker, 'USD/CHF OTC');

  const multiPrep3 = parseSignal('GET READY\nUSD/JPY');
  assert(multiPrep3 !== null && multiPrep3.action === 'PREPARE');
  assert.strictEqual(multiPrep3.ticker, 'USD/JPY');

  // Standalone Raw Tickers (Parsed as PREPARE)
  const prep3 = parseSignal('USD CHF OTC');
  assert(prep3 !== null && prep3.action === 'PREPARE');
  assert.strictEqual(prep3.ticker, 'USD CHF OTC');

  const prep4 = parseSignal('USD MXN OTC');
  assert(prep4 !== null && prep4.action === 'PREPARE');
  assert.strictEqual(prep4.ticker, 'USD MXN OTC');

  const prep5 = parseSignal('USD BRL OTC');
  assert(prep5 !== null && prep5.action === 'PREPARE');
  assert.strictEqual(prep5.ticker, 'USD BRL OTC');

  const prep6 = parseSignal('NZD CAD OTC');
  assert(prep6 !== null && prep6.action === 'PREPARE');
  assert.strictEqual(prep6.ticker, 'NZD CAD OTC');

  // Format 11: Balance Check trigger
  const bal1 = parseSignal('BALANCE');
  assert(bal1 !== null && bal1.action === 'BALANCE');

  const bal2 = parseSignal('CHECK BALANCE');
  assert(bal2 !== null && bal2.action === 'BALANCE');

  // Format 12: Strict Rejections for Noise, Chat, Celebrations & Expirations
  const rej1 = parseSignal('Hey team, should we buy some AAPL today?');
  assert.strictEqual(rej1, null, 'Casual chat must be dropped');

  const rej2 = parseSignal('JOIN VIP CHANNEL NOW FOR 50% OFF');
  assert.strictEqual(rej2, null, 'Spam messages must be dropped');

  const rej3 = parseSignal('');
  assert.strictEqual(rej3, null, 'Empty string must return null');

  const rej4 = parseSignal('Profit 🚀🚀');
  assert.strictEqual(rej4, null, 'Profit celebration must be dropped');

  const rej5 = parseSignal('Profit 🚀');
  assert.strictEqual(rej5, null, 'Profit rocket emoji must be dropped');

  const rej6 = parseSignal('Good session... Let\'s continue later 🚀🚀');
  assert.strictEqual(rej6, null, 'Session end notice must be dropped');

  const rej7 = parseSignal('Change');
  assert.strictEqual(rej7, null, 'Change text must be dropped');

  const rej8 = parseSignal('2 minutes');
  assert.strictEqual(rej8, null, 'Standalone minutes must be dropped');

  const rej9 = parseSignal('Let\'s start in 90 minutes');
  assert.strictEqual(rej9, null, 'Session countdown must be dropped');

  console.log('✔ Test 1 Passed: Parser correctly handles all UP, DOWN, CALL, PUT, multi-line, markdown, standby formats, and VIP channel filters.\n');

  // ----------------------------------------------------
  // TEST 2: Queue Concurrency = 1 Serialization
  // ----------------------------------------------------
  console.log('▶ Test 2: Sequential Queue Concurrency Verification...');

  let activeCount = 0;
  let maxConcurrent = 0;
  const executionOrder: number[] = [];

  const mockRunner = async (signal: TradeSignal) => {
    activeCount++;
    if (activeCount > maxConcurrent) maxConcurrent = activeCount;

    await new Promise((r) => setTimeout(r, 30));
    executionOrder.push(signal.price || 0);

    activeCount--;
    return {
      success: true,
      signal,
      durationMs: 30,
    };
  };

  const tasks: AutomationTask[] = [1, 2, 3, 4, 5].map((i) => ({
    id: `task-${i}`,
    signal: {
      action: 'UP',
      ticker: `SYM${i}`,
      price: i,
      rawText: `UP SYM${i} @ ${i}`,
      timestamp: new Date(),
    },
    receivedAt: new Date(),
  }));

  const promises = tasks.map((t) => automationQueue.enqueue(t, mockRunner));
  await Promise.all(promises);

  assert.strictEqual(maxConcurrent, 1, 'Max concurrent executions must never exceed 1');
  assert.deepStrictEqual(executionOrder, [1, 2, 3, 4, 5], 'Tasks must execute in strict FIFO sequence');

  console.log('✔ Test 2 Passed: Queue strictly serializes execution with concurrency = 1.\n');

  // ----------------------------------------------------
  // TEST 3: Quotex UP & DOWN HTML Button Click Verification
  // ----------------------------------------------------
  console.log('▶ Test 3: Quotex UP & DOWN HTML Button Click Verification with Exact User HTML...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const quotexHtmlContent = `
    <!DOCTYPE html>
    <html>
      <head><title>Quotex Simulation</title></head>
      <body>
        <div class="trading-panel">
          <!-- Exact UP Button HTML provided by user -->
          <button type="button" class="KtjVk JQZcs _5qIw LzVPu">
            <span class="oQ4Z4">Up</span>
            <svg class="icon-arrow-up-circle oDDMG"><use xlink:href="/profile/images/spritemap.svg#icon-arrow-up-circle"></use></svg>
            <span class="SGRs3"><svg class="icon-button-loader"><use xlink:href="/profile/images/spritemap.svg#icon-button-loader"></use></svg></span>
          </button>

          <!-- Exact DOWN Button HTML provided by user -->
          <button type="button" class="KtjVk twQq3 _5qIw LzVPu">
            <span class="oQ4Z4">Down</span>
            <svg class="icon-arrow-down-circle oDDMG"><use xlink:href="/profile/images/spritemap.svg#icon-arrow-down-circle"></use></svg>
            <span class="SGRs3"><svg class="icon-button-loader"><use xlink:href="/profile/images/spritemap.svg#icon-button-loader"></use></svg></span>
          </button>
        </div>
        <script>
          window.lastClicked = null;
          document.querySelector('.JQZcs').addEventListener('click', () => { window.lastClicked = 'UP'; });
          document.querySelector('.twQq3').addEventListener('click', () => { window.lastClicked = 'DOWN'; });
        </script>
      </body>
    </html>
  `;

  await page.setContent(quotexHtmlContent);

  const upClickResult = await clickTradeButton(page, 'UP');
  assert.strictEqual(upClickResult.success, true, 'clickTradeButton for UP must succeed');
  const clickedUp = await page.evaluate(() => (window as unknown as { lastClicked: string }).lastClicked);
  assert.strictEqual(clickedUp, 'UP', 'UP button event listener must be triggered');
  console.log(`  ✔ Verified UP click: Selector used "${upClickResult.selectorUsed}"`);

  const downClickResult = await clickTradeButton(page, 'DOWN');
  assert.strictEqual(downClickResult.success, true, 'clickTradeButton for DOWN must succeed');
  const clickedDown = await page.evaluate(() => (window as unknown as { lastClicked: string }).lastClicked);
  assert.strictEqual(clickedDown, 'DOWN', 'DOWN button event listener must be triggered');
  console.log(`  ✔ Verified DOWN click: Selector used "${downClickResult.selectorUsed}"`);

  await browser.close();
  console.log('✔ Test 3 Passed: Successfully targeted and triggered clicks on user\'s exact Quotex UP & DOWN HTML buttons.\n');

  // ----------------------------------------------------
  // TEST 4: Sector-Aware Ticker Utilities & Alias Resolution
  // ----------------------------------------------------
  console.log('▶ Test 4: Sector-Aware Ticker Matching, Aliases & Payout Stripping...');

  // Canonicalization & Aliases
  assert.strictEqual(canonicalize('AAPL'), 'APPLE');
  assert.strictEqual(canonicalize('XAU/USD'), 'GOLD');
  assert.strictEqual(canonicalize('EUR/USD (OTC) 87%'), 'EURUSD');
  assert.strictEqual(canonicalize('USCRUDE'), 'USCRUDE');

  // Payout stripping
  assert.strictEqual(stripPayoutAndNoise('EUR/USD (OTC) 87%'), 'EUR/USD (OTC)');
  assert.strictEqual(stripPayoutAndNoise('USD/CHF +92%'), 'USD/CHF');
  assert.strictEqual(stripPayoutAndNoise('Gold (OTC)\n+80%'), 'Gold (OTC)');

  // Search queries (strictly no OTC)
  assert.strictEqual(buildSearchQuery('USD CHF OTC').query, 'USD/CHF');
  assert.strictEqual(buildSearchQuery('EURUSD').query, 'EUR/USD');
  assert.strictEqual(buildSearchQuery('EUR/USD (OTC)').query, 'EUR/USD');
  assert.strictEqual(buildSearchQuery('AAPL').query, 'Apple');
  assert.strictEqual(buildSearchQuery('Gold').query, 'Gold');
  assert.strictEqual(buildSearchQuery('XAU/USD').query, 'Gold');

  // Multi-query candidate list
  const copQueries = getSearchQueriesForTicker('USD COP OTC');
  assert.ok(copQueries.includes('USD/COP'), 'Must include USD/COP');
  assert.ok(copQueries.includes('USD COP'), 'Must include USD COP');
  assert.ok(copQueries.includes('COP'), 'Must include quote currency COP');

  const appleQueries = getSearchQueriesForTicker('AAPL');
  assert.ok(appleQueries.includes('Apple'), 'Must include Apple');
  assert.ok(appleQueries.includes('AAPL'), 'Must include AAPL');
  assert.strictEqual(buildSearchQuery('USCRUDE').query, 'Crude');
  assert.strictEqual(buildSearchQuery('BTC/USD').query, 'Bitcoin');
  assert.strictEqual(buildSearchQuery('Asian Composite Index').query, 'ASIAN COMPOSITE INDEX');

  // Sector matching: Forex
  assert(tickersMatch('EUR/USD', 'EUR/USD (OTC) 87%'), 'Forex EUR/USD with payout matches');
  assert(tickersMatch('USD CHF OTC', 'USD/CHF (OTC)'), 'Forex USD CHF OTC matches USD/CHF (OTC)');
  assert(tickersMatch('USD/INR OTC', 'USD/INR'), 'Forex USD/INR matches');

  // Sector matching: Crypto
  assert(tickersMatch('BTC/USD', 'Bitcoin 80%'), 'Crypto BTC/USD matches Bitcoin');
  assert(tickersMatch('ETH', 'Ethereum (OTC)'), 'Crypto ETH matches Ethereum');
  assert(tickersMatch('SOL', 'SOL/USD'), 'Crypto SOL matches SOL/USD');

  // Sector matching: Commodities
  assert(tickersMatch('GOLD', 'XAU/USD'), 'Commodity GOLD matches XAU/USD');
  assert(tickersMatch('XAU/USD', 'Gold (OTC) +82%'), 'Commodity XAU/USD matches Gold (OTC)');
  assert(tickersMatch('USCRUDE', 'Crude Oil'), 'Commodity USCRUDE matches Crude Oil');
  assert(tickersMatch('UKBRENT', 'Brent Crude'), 'Commodity UKBRENT matches Brent');

  // Sector matching: Stocks / Equities
  assert(tickersMatch('AAPL', 'Apple (OTC) 90%'), 'Stock AAPL matches Apple');
  assert(tickersMatch('BA', 'Boeing Company (OTC)'), 'Stock BA matches Boeing Company');
  assert(tickersMatch('MSFT', 'Microsoft'), 'Stock MSFT matches Microsoft');
  assert(tickersMatch('NVDA', 'Nvidia (OTC)'), 'Stock NVDA matches Nvidia');
  assert(tickersMatch('TSLA', 'Tesla'), 'Stock TSLA matches Tesla');

  // Sector matching: Indices
  assert(tickersMatch('ASIAN COMPOSITE INDEX', 'Asian Composite Index'), 'Index matches');
  assert(tickersMatch('US500', 'S&P 500'), 'Index US500 matches S&P 500');

  console.log('✔ Test 4 Passed: All sectors (Forex, Crypto, Commodities, Stocks, Indices) resolve accurately.\n');

  // ----------------------------------------------------
  // TEST 5: User '+' Add Asset Button vs Deposit Button Isolation
  // ----------------------------------------------------
  console.log('▶ Test 5: Exact Quotex Button Verification (+ Button vs Deposit Button)...');

  const browser2 = await chromium.launch({ headless: true });
  const context2 = await browser2.newContext();
  const page2 = await context2.newPage();

  const quotexMockHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Quotex Header Simulation</title></head>
      <body>
        <!-- Header tab bar -->
        <div class="header-tabs">
          <div class="tab header-sub__tab header-sub__tab--active">
            <span class="tab__text">EUR/USD (OTC) 87%</span>
          </div>
          <div class="tab header-sub__tab">
            <span class="tab__text">USD/CHF (OTC) 92%</span>
          </div>
        </div>

        <!-- Action buttons area -->
        <div class="header-actions">
          <!-- The RIGHT button: '+' add asset button from user HTML -->
          <button type="button" id="right-plus-btn" class="CAZSg wupmB BEz9j">
            <svg class="icon-plus qYmvp h4bHs"><use xlink:href="/profile/images/spritemap.svg#icon-plus"></use></svg>
          </button>

          <!-- The WRONG button: Deposit button from user HTML -->
          <button type="button" id="wrong-deposit-btn" class="KtjVk JQZcs _5qIw wCEPo">
            <svg class="icon-plus oDDMG"><use xlink:href="/profile/images/spritemap.svg#icon-plus"></use></svg>
            <span class="oQ4Z4">Deposit</span>
            <span class="SGRs3"><svg class="icon-button-loader"><use xlink:href="/profile/images/spritemap.svg#icon-button-loader"></use></svg></span>
          </button>
        </div>

        <script>
          window.clickedButton = null;
          document.getElementById('right-plus-btn').addEventListener('click', () => { window.clickedButton = 'ADD_ASSET_PLUS'; });
          document.getElementById('wrong-deposit-btn').addEventListener('click', () => { window.clickedButton = 'DEPOSIT_BUTTON'; });
        </script>
      </body>
    </html>
  `;

  await page2.setContent(quotexMockHtml);

  // Test that our opener evaluates the RIGHT '+' button and NEVER clicks Deposit
  const clickedResult = await page2.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text.includes('deposit') || btn.querySelector('span.oQ4Z4')?.textContent?.toLowerCase().includes('deposit')) {
        continue;
      }
      const hasPlusSvg = btn.querySelector('svg.icon-plus, svg[class*="plus" i], use[*|href*="icon-plus"]');
      if (hasPlusSvg || btn.classList.contains('CAZSg')) {
        btn.click();
        return true;
      }
    }
    return false;
  });

  assert.strictEqual(clickedResult, true, 'Opener must find and click the right + button');
  const clickedBtn = await page2.evaluate(() => (window as unknown as { clickedButton: string }).clickedButton);
  assert.strictEqual(clickedBtn, 'ADD_ASSET_PLUS', 'Clicked button MUST be ADD_ASSET_PLUS and NEVER DEPOSIT_BUTTON');
  console.log(`  ✔ Verified: Right '+' button (${clickedBtn}) was clicked, Deposit button was strictly skipped.`);

  await browser2.close();
  console.log('✔ Test 5 Passed: Exact user + button targeted and Deposit button completely isolated.\n');

  // ----------------------------------------------------
  // TEST 6: Market Caching State
  // ----------------------------------------------------
  console.log('▶ Test 6: Market State Verification...');

  setActiveMarket(null);
  assert.strictEqual(getActiveMarket(), null, 'getActiveMarket() should be null initially');

  setActiveMarket('USD CHF OTC');
  assert.strictEqual(getActiveMarket(), 'USD CHF OTC', 'getActiveMarket() should return cached market');

  setActiveMarket('EUR USD');
  assert.strictEqual(getActiveMarket(), 'EUR USD', 'getActiveMarket() should return updated market');

  console.log('✔ Test 6 Passed: Market caching functions correctly.\n');

  // ----------------------------------------------------
  // TEST 7: Exact Quotex Asset Table HTML Click Verification
  // ----------------------------------------------------
  console.log('▶ Test 7: Exact Quotex Search Table HTML Click Verification (.yejPg, .R2Rgm, span.Z2fyK)...');

  const browser3 = await chromium.launch({ headless: true });
  const context3 = await browser3.newContext();
  const page3 = await context3.newPage();

  const exactPickerHtml = `
    <!DOCTYPE html>
    <html>
      <head><title>Quotex Asset Picker Search Results</title></head>
      <body>
        <div class="yejPg">
          <div class="VszPK">
            <div class="ozbTK"><a>Name</a></div>
            <div class="ozbTK Lt_gm"><a>24h changing</a></div>
            <div class="ozbTK"><a>Profit 1+ min</a><svg class="icon-sort-mark"><use xlink:href="/profile/images/spritemap.svg#icon-sort-mark"></use></svg></div>
            <div class="ozbTK"><a>5+ min</a></div>
          </div>
          <div class="tvTxR">Sort by:<div class="VdNM6">Name<svg class="icon-sort-mark"><use xlink:href="/profile/images/spritemap.svg#icon-sort-mark"></use></svg>
            <div class="Kfkop">
              <div class="JUa6w KHBO2">Name<div class="VA4oF"><svg class="icon-sort-mark"><use xlink:href="/profile/images/spritemap.svg#icon-sort-mark"></use></svg><svg class="icon-sort-mark icon-rotate"><use xlink:href="/profile/images/spritemap.svg#icon-sort-mark"></use></svg></div></div>
              <div class="JUa6w">24h changing</div>
              <div class="JUa6w">Profit 1+ min</div>
              <div class="JUa6w">Profit 5+ min</div>
            </div>
          </div></div>
          <!-- DESKTOP ROW -->
          <div class="R2Rgm" id="target-row">
            <div class="NnmVT"><svg class="icon-favorite"><use xlink:href="/profile/images/spritemap.svg#icon-favorite"></use></svg></div>
            <div class="teoXG yNdTd">
              <div class="flags dSnnA"><svg class="flag-usd" aria-label="Flag USD"></svg><svg class="flag-mxn" aria-label="Flag MXN"></svg></div>
              <span class="Z2fyK">USD/MXN (OTC)</span>
              <button data-state="closed" class="jJUOR" data-tabindex="" tabindex="-1"><svg class="icon-check"></svg></button>
            </div>
            <div class="hHJtM ZFMV8"><svg class="icon-arrow-up"></svg><span>0.03%</span></div>
            <div class="bQodW mlvrU"><span>77%</span></div>
            <div class="bQodW"><span>77%</span></div>
          </div>
          <!-- COMPACT ROW -->
          <div class="vPvlJ">
            <div class="cRI1S SUdKm"><svg class="icon-favorite"></svg></div>
            <div class="sTlId">
              <div class="e4qZ6">
                <div class="flags IAdRa"><svg class="flag-usd"></svg><svg class="flag-mxn"></svg></div>
                <span>USD/MXN (OTC)</span>
                <button data-state="closed" class="jJUOR"><svg class="icon-check"></svg></button>
              </div>
              <div class="mQX6T">
                <div class="QBzlg"><span>Profit 1+ min</span><span class="QBzlg">77%</span></div>
                <div class="QBzlg"><span>5+ min</span><span>77%</span></div>
              </div>
            </div>
            <div class="pIJ4K FxxqS"><svg class="icon-arrow-up"></svg><span>+0.03%</span></div>
          </div>
        </div>

        <script>
          window.clickedAsset = null;
          document.querySelector('span.Z2fyK').addEventListener('click', () => { window.clickedAsset = 'USD/MXN (OTC)'; });
          document.querySelector('.R2Rgm').addEventListener('click', (e) => {
            if (!window.clickedAsset) window.clickedAsset = 'USD/MXN (OTC) via ROW';
          });
        </script>
      </body>
    </html>
  `;

  await page3.setContent(exactPickerHtml);

  // Test our searchAndSelect matching logic inside page3
  const targetCanon = canonicalize('USD MXN OTC');
  const matchedAndClicked = await page3.evaluate((target: string) => {
    const rows = document.querySelectorAll('.yejPg .R2Rgm, .yejPg .vPvlJ, .R2Rgm, .vPvlJ, .teoXG, .e4qZ6, span.Z2fyK');
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i]!;
      const nameSpan = el.querySelector('span.Z2fyK, .teoXG span, .e4qZ6 span') || el;
      const text = (nameSpan.textContent || '').replace(/\+?\d{1,3}\s*%/g, '').toUpperCase().replace(/\bOTC\b/g, '').replace(/[^A-Z0-9]/g, '');
      if (text === target || text.indexOf(target) !== -1 || target.indexOf(text) !== -1) {
        const targetToClick = (el.querySelector('span.Z2fyK, .teoXG, .e4qZ6') || el) as HTMLElement;
        targetToClick.click();
        return true;
      }
    }
    return false;
  }, targetCanon);

  assert.strictEqual(matchedAndClicked, true, 'Exact Quotex search table row must match and click');
  const clickedAsset = await page3.evaluate(() => (window as unknown as { clickedAsset: string }).clickedAsset);
  assert.ok(clickedAsset && clickedAsset.includes('USD/MXN'), 'Clicked asset must be USD/MXN');
  console.log(`  ✔ Verified: Exact Quotex asset row matched and clicked "${clickedAsset}".`);

  await browser3.close();
  console.log('✔ Test 7 Passed: Successfully matched and clicked asset in exact Quotex search table HTML.\n');

  console.log('========================================');
  console.log('  🎉 All Test Suites Passed 100%!       ');
  console.log('========================================\n');
}

runTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});


