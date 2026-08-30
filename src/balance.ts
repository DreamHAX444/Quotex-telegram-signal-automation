import type { Page } from 'playwright';
import type { AccountBalance, BalanceHistoryEntry } from './types.js';
import { logger } from './logger.js';

/**
 * Currency symbols and codes recognition dictionary
 */
const KNOWN_CURRENCIES: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
  '₱': 'PHP',
  'R$': 'BRL',
  'zł': 'PLN',
  '₫': 'VND',
  '฿': 'THB',
  'USDT': 'USDT',
  'USD': 'USD',
  'EUR': 'EUR',
  'GBP': 'GBP',
  'INR': 'INR',
  'BRL': 'BRL',
  'RUB': 'RUB',
  'IDR': 'IDR',
  'BDT': 'BDT',
  'PKR': 'PKR',
  'NGN': 'NGN',
};

/**
 * Robust parsing utility for extracting currency symbol, code, and numeric float value
 * from localized monetary strings (e.g. "$10,450.20", "€ 1.250,50", "10 000.00 USD", "₹85,000.00").
 */
export function parseCurrencyAndNumber(raw: string): {
  numericValue: number;
  currency: string;
  formatted: string;
} | null {
  if (!raw || typeof raw !== 'string') return null;

  // Normalize unicode non-breaking spaces and trim
  const cleaned = raw.replace(/[\u00A0\u1680\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]/g, ' ').trim();
  if (!cleaned) return null;

  // 1. Detect Currency Symbol or Code (checking longer symbols first so R$ or USDT matches before $)
  const sortedCurrencies = Object.keys(KNOWN_CURRENCIES).sort((a, b) => b.length - a.length);
  let detectedCurrency = '$';
  for (const symbol of sortedCurrencies) {
    if (cleaned.toUpperCase().includes(symbol.toUpperCase())) {
      detectedCurrency = symbol;
      break;
    }
  }

  // 2. Extract numeric component
  // Matches patterns like "10,450.20", "10 450.20", "1.250,50", "10450", "10450.2"
  const numberMatch = cleaned.match(/[\d]+(?:[\s,.]\d{3})*(?:[.,]\d+)?/);
  if (!numberMatch) return null;

  const rawNumberStr = numberMatch[0].trim();

  // Normalize number string for parseFloat:
  // E.g. "10,450.20" -> "10450.20", "1.250,50" -> "1250.50", "10 000,00" -> "10000.00"
  let normalizedNum = rawNumberStr.replace(/\s+/g, '');

  if (normalizedNum.includes(',') && normalizedNum.includes('.')) {
    // Determine which is decimal and which is thousands separator
    const lastComma = normalizedNum.lastIndexOf(',');
    const lastDot = normalizedNum.lastIndexOf('.');
    if (lastComma > lastDot) {
      // European format: 1.250,50 -> 1250.50
      normalizedNum = normalizedNum.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 1,250.50 -> 1250.50
      normalizedNum = normalizedNum.replace(/,/g, '');
    }
  } else if (normalizedNum.includes(',')) {
    // E.g. "1250,50" or "10,000"
    const parts = normalizedNum.split(',');
    if (parts.length === 2 && parts[1] && parts[1].length <= 2) {
      normalizedNum = normalizedNum.replace(',', '.');
    } else {
      normalizedNum = normalizedNum.replace(/,/g, '');
    }
  }

  const numericValue = Number.parseFloat(normalizedNum);
  if (Number.isNaN(numericValue)) return null;

  // Format clean display balance
  const formatted = cleaned;

  return {
    numericValue,
    currency: detectedCurrency,
    formatted,
  };
}

/**
 * Multi-Strategy Balance Extractor executed in browser page context
 */
export async function extractBalanceFromPage(page: Page): Promise<AccountBalance | null> {
  try {
    // Wait briefly for UI elements to render if page just loaded
    await page.waitForLoadState('domcontentloaded').catch(e => logger.warn('waitForLoadState error', e));
    await page.waitForTimeout(600);

    const rawData = await page.evaluate(() => {
      // -------------------------------------------------------------
      // STRATEGY 1: Quotex / QX Broker Dedicated Selectors
      // -------------------------------------------------------------
      const quotexBalanceEl = document.querySelector('.usermenu__info-balance');
      if (quotexBalanceEl && quotexBalanceEl.textContent?.trim()) {
        const quotexTypeEl = document.querySelector('.usermenu__info-name, .usermenu__info-level');
        const typeText = quotexTypeEl?.textContent?.trim() || '';
        let accountType: 'Live' | 'Demo' | 'Unknown' = 'Unknown';
        if (/demo/i.test(typeText)) accountType = 'Demo';
        else if (/live|real|standard/i.test(typeText)) accountType = 'Live';

        return {
          rawBalance: quotexBalanceEl.textContent.trim(),
          rawType: typeText,
          accountType,
          source: 'Quotex Dedicated Selector (.usermenu__info-balance)',
        };
      }

      // Generic Broker Class Patterns
      const balanceClassSelectors = [
        '[class*="usermenu__info-balance"]',
        '[class*="user-balance"]',
        '[class*="header__balance"]',
        '[class*="balance-info"]',
        '[class*="balance-block"]',
        '[data-balance]',
        '[data-test="balance"]',
        '.header-balance',
        '.account-balance',
      ];

      for (const sel of balanceClassSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent?.trim() && /\d/.test(el.textContent)) {
          const parent = el.closest('[class*="usermenu"], [class*="header"], [class*="account"]') || el.parentElement;
          const parentText = parent?.textContent || '';
          let accountType: 'Live' | 'Demo' | 'Unknown' = 'Unknown';
          if (/demo/i.test(parentText)) accountType = 'Demo';
          else if (/live|real/i.test(parentText)) accountType = 'Live';

          return {
            rawBalance: el.textContent.trim(),
            rawType: parentText,
            accountType,
            source: `Selector (${sel})`,
          };
        }
      }

      // -------------------------------------------------------------
      // STRATEGY 2: Account Label Anchoring & Sibling/Parent Traversal
      // -------------------------------------------------------------
      const allElements = Array.from(
        document.querySelectorAll('header *, nav *, .usermenu *, [class*="header"] *, [class*="topbar"] *, [class*="account"] *, [class*="balance"] *')
      ).filter(el => ['DIV', 'SPAN', 'P', 'A', 'BUTTON', 'B', 'STRONG'].includes(el.tagName));
      const accountLabelRegex = /^(?:demo|live|real|standard|practice)\s*account$/i;

      for (const el of allElements) {
        const text = (el.textContent || '').trim();
        if (accountLabelRegex.test(text)) {
          const accountType: 'Live' | 'Demo' | 'Unknown' = /demo|practice/i.test(text) ? 'Demo' : 'Live';

          // Check direct next sibling
          const next = el.nextElementSibling;
          if (next && next.textContent && /\d/.test(next.textContent)) {
            return {
              rawBalance: next.textContent.trim(),
              rawType: text,
              accountType,
              source: 'Account Label Next-Sibling Anchor',
            };
          }

          // Check parent's child nodes for numbers / currency
          if (el.parentElement) {
            const siblings = Array.from(el.parentElement.children);
            for (const sib of siblings) {
              if (sib !== el && sib.textContent && /[\d]+(?:[.,]\d+)?/.test(sib.textContent)) {
                return {
                  rawBalance: sib.textContent.trim(),
                  rawType: text,
                  accountType,
                  source: 'Account Label Parent-Container Anchor',
                };
              }
            }
          }
        }
      }

      // -------------------------------------------------------------
      // STRATEGY 3: Header / Topbar Monetary Regex Search
      // -------------------------------------------------------------
      const headerContainers = Array.from(
        document.querySelectorAll('header, nav, [class*="header"], [class*="topbar"], [class*="usermenu"], [class*="navbar"]')
      );

      for (const container of headerContainers) {
        const textNodes: Element[] = Array.from(container.querySelectorAll('*'));
        for (const node of textNodes) {
          // Leaf nodes only
          if (node.children.length === 0) {
            const content = (node.textContent || '').trim();
            if (
              content.length < 30 &&
              /[$€£₹¥₱]|USD|EUR|GBP|INR|USDT/i.test(content) &&
              /\d/.test(content)
            ) {
              const fullContainerText = container.textContent || '';
              let accountType: 'Live' | 'Demo' | 'Unknown' = 'Unknown';
              if (/demo/i.test(fullContainerText)) accountType = 'Demo';
              else if (/live|real/i.test(fullContainerText)) accountType = 'Live';

              return {
                rawBalance: content,
                rawType: fullContainerText.slice(0, 50),
                accountType,
                source: 'Header Currency Heuristic Search',
              };
            }
          }
        }
      }

      return null;
    });

    if (!rawData || !rawData.rawBalance) {
      logger.debug('Balance elements not detected on active page. Ensure the user is logged in and the page is fully loaded.');
      return null;
    }

    const parsed = parseCurrencyAndNumber(rawData.rawBalance);
    if (!parsed) {
      logger.debug(`Could not parse monetary numbers from string: "${rawData.rawBalance}". Check currency symbols.`);
      return null;
    }

    const result: AccountBalance = {
      accountType: rawData.accountType,
      formattedBalance: parsed.formatted,
      numericValue: parsed.numericValue,
      currency: parsed.currency,
      updatedAt: new Date().toISOString(),
      source: rawData.source,
    };

    return result;
  } catch (err) {
    logger.debug('Error extracting balance from page', err);
    return null;
  }
}

/**
 * Central In-Memory Balance State Store & Manager
 */
class BalanceManager {
  private currentBalance: AccountBalance | null = null;
  private history: BalanceHistoryEntry[] = [];
  private readonly maxHistoryLength = 50;

  /**
   * Returns the current known account balance
   */
  public getCurrentBalance(): AccountBalance | null {
    return this.currentBalance;
  }

  /**
   * Returns recent balance history snapshots
   */
  public getBalanceHistory(): BalanceHistoryEntry[] {
    return [...this.history];
  }

  /**
   * Updates the internal balance state, computes delta change, and logs formatted summary
   */
  public recordBalance(newBalance: AccountBalance): void {
    const prev = this.currentBalance;
    const change = prev ? Number((newBalance.numericValue - prev.numericValue).toFixed(2)) : undefined;

    this.currentBalance = newBalance;

    const historyEntry: BalanceHistoryEntry = {
      timestamp: newBalance.updatedAt,
      accountType: newBalance.accountType,
      formattedBalance: newBalance.formattedBalance,
      numericValue: newBalance.numericValue,
      currency: newBalance.currency,
      change,
    };

    this.history.unshift(historyEntry);
    if (this.history.length > this.maxHistoryLength) {
      this.history.pop();
    }

    this.printBalanceBox(newBalance, change);
  }

  /**
   * Extracts balance directly from a live Playwright page and records it
   */
  public async extractAndRecordBalance(page: Page): Promise<AccountBalance | null> {
    const balance = await extractBalanceFromPage(page);
    if (balance) {
      this.recordBalance(balance);
    }
    return balance;
  }

  /**
   * Prints rich, structured terminal box with current balance details
   */
  public printBalanceBox(balance: AccountBalance, change?: number): void {
    const line = '═'.repeat(58);

    const typeBadge =
      balance.accountType === 'Live'
        ? '🟢 LIVE ACCOUNT'
        : balance.accountType === 'Demo'
        ? '🟡 DEMO ACCOUNT'
        : '⚪ ACCOUNT';

    let changeText = '';
    if (change !== undefined && change !== 0) {
      const sign = change > 0 ? '+' : '';
      changeText = ` (${sign}${change} ${balance.currency})`;
    }

    console.log(`\n╔${line}╗`);
    console.log(`║${'ACCOUNT BALANCE SNAPSHOT'.padStart(38).padEnd(58)}║`);
    console.log(`╠${line}╣`);
    console.log(`║ Account Type:  ${typeBadge.padEnd(42)}║`);
    console.log(`║ Balance:       ${(balance.formattedBalance + changeText).padEnd(42)}║`);
    console.log(`║ Numeric Value: ${balance.numericValue.toLocaleString(undefined, { minimumFractionDigits: 2 }).padEnd(42)}║`);
    console.log(`║ Currency:      ${balance.currency.padEnd(42)}║`);
    console.log(`║ Strategy:      ${balance.source.slice(0, 40).padEnd(42)}║`);
    console.log(`║ Updated At:    ${new Date(balance.updatedAt).toLocaleTimeString().padEnd(42)}║`);
    console.log(`╚${line}╝\n`);

    logger.info(`💰 ${balance.accountType} Balance: ${balance.formattedBalance}${changeText}`);
  }
}

export const balanceManager = new BalanceManager();
