import type { ActionType, TradeSignal } from './types.js';
import { logger } from './logger.js';

/**
 * Strips timeframe suffixes and noise from ticker names (e.g. "USD/JPY 1M" -> "USD/JPY")
 */
function cleanTicker(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/\b(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|[0-9]+\s*H(?:OUR)?S?|NOW)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts duration in minutes from raw text (e.g. "5M", "2 MINUTES", "1H")
 */
function extractDurationMinutes(text: string): number | undefined {
  const match = text.match(/\b(?:([0-9]+)\s*(?:M|MIN(?:UTE)?S?)|([0-9]+)\s*H(?:OUR)?S?)\b/i);
  if (match) {
    if (match[1]) return parseInt(match[1], 10);
    if (match[2]) return parseInt(match[2], 10) * 60;
  }
  return undefined;
}



/**
 * Normalizes action strings to canonical ActionType (UP, DOWN, PREPARE, BALANCE, etc.)
 */
function normalizeAction(rawAction?: string | null): ActionType {
  if (!rawAction) return 'UP';
  const upper = rawAction.toUpperCase().trim();
  if (['UP', 'CALL', 'BUY', 'HIGHER', 'GREEN'].includes(upper)) {
    return 'UP';
  }
  if (['DOWN', 'PUT', 'SELL', 'LOWER', 'RED'].includes(upper)) {
    return 'DOWN';
  }
  if (
    [
      'PREPARE',
      'GET READY',
      'STANDBY',
      'STAND BY',
      'WARM UP',
      'WARM-UP',
      'WARMUP',
      'BE READY',
      'ARE YOU READY',
      'OPEN PLATFORM',
      'OPEN YOUR PLATFORM',
    ].includes(upper)
  ) {
    return 'PREPARE';
  }
  if (['BALANCE', 'CHECK BALANCE', 'ACCOUNT BALANCE'].includes(upper)) {
    return 'BALANCE';
  }
  if (['ABORT', 'CANCEL', 'CHANGE', 'STOP', 'IGNORE'].includes(upper)) {
    return 'ABORT';
  }
  throw new Error(`Unknown action type: ${upper}`);
}

const UP_EMOJIS = ['🟢', '🟩', '🔼', '⬆️', '🔺', '📈'];
const DOWN_EMOJIS = ['🔴', '🟥', '🔽', '⬇️', '🔻', '📉'];
const DECORATIVE_EMOJIS = ['🚀', '⚡', '⏱️', '⏰', '📊', '🔍', '🚨', '🔥', '👉', '✨', '‼️', '❗', '•', '🎯', '💰', '💵', '💸'];

/**
 * Words that represent chat, status, results, or actions that must NEVER be parsed as tickers
 */
const NON_SIGNAL_WORDS = new Set([
  'PROFIT', 'WIN', 'WINNER', 'LOSS', 'LOST', 'RESULT', 'RESULTS',
  'CHANGE', 'UPDATE', 'UPDATES', 'SESSION', 'SESSIONS', 'CLOSED',
  'START', 'STARTED', 'STARTING', 'CANCEL', 'CANCELED', 'CANCELLED',
  'TODAY', 'TOMORROW', 'LATER', 'DIRECT', 'OPTION', 'OPTIONS',
  'SIGNAL', 'SIGNALS', 'TARGET', 'TARGETS', 'ACTIVE', 'REPORT',
  'MINUTE', 'MINUTES', 'SECOND', 'SECONDS', 'READY', 'PLATFORM',
  'PERFECT', 'GOOD', 'GREAT', 'THANKS', 'THANK', 'ADMIN', 'TEAM',
  'CONTINUE', 'WAIT', 'DONE', 'TRADE', 'ENTRY', 'ACCOUNT', 'BALANCE',
  'ABOUT', 'AFTER', 'AGAIN', 'CHECK', 'DAILY', 'EARN', 'FIRST',
  'GIVE', 'GROUP', 'GUIDE', 'HAPPY', 'HELLO', 'HOURS', 'LEVEL',
  'MONEY', 'MONTH', 'NIGHT', 'ORDER', 'PEOPLE', 'PRICE', 'QUICK',
  'SHARE', 'SHORT', 'STILL', 'SUPER', 'TAKE', 'TOTAL',
  'TRUST', 'VALUE', 'WATCH', 'WHILE', 'WORLD', 'STANDBY', 'PREPARE'
]);

/**
 * Common Forex, OTC, Crypto & Commodity ticker codes
 */
const VALID_CURRENCY_CODES = new Set([
  // Major, Minor, and OTC Currencies
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD',
  'BRL', 'MXN', 'INR', 'IDR', 'EGP', 'PKR', 'BDT', 'RUB',
  'TRY', 'ZAR', 'CNH', 'CNY', 'SGD', 'HKD', 'SEK', 'NOK',
  'KRW', 'AED', 'COP', 'CLP', 'ARS', 'NGN', 'PHP', 'VND',
  'THB', 'MYR', 'DZD', 'MAD', 'KZT', 'QAR', 'SAR', 'CZK',
  'HUF', 'ILS', 'PLN', 'RON', 'TWD',
  // Crypto & Commodities
  'BTC', 'ETH', 'LTC', 'XRP', 'SOL', 'DOGE', 'BNB',
  'GOLD', 'SILVER', 'OIL', 'BRENT', 'WTI', 'USCRUDE', 'UKBRENT'
]);

/**
 * In-Memory Signal Context State Machine
 * Remembers recent tickers and durations across multi-message signal sequences
 * (e.g. "USD BRL OTC" -> "2 minutes" -> "Down")
 */
interface SignalContextState {
  ticker: string | null;
  durationMinutes: number | undefined;
  timestamp: number;
}

let activeSignalContext: SignalContextState = {
  ticker: null,
  durationMinutes: 1,
  timestamp: 0,
};

const CONTEXT_EXPIRATION_MS = 180_000; // 3 minutes TTL for multi-message context

function getSignalContext(): SignalContextState {
  if (activeSignalContext.ticker && Date.now() - activeSignalContext.timestamp > CONTEXT_EXPIRATION_MS) {
    activeSignalContext.ticker = null;
  }
  return activeSignalContext;
}

function updateSignalContext(partial: Partial<SignalContextState>): void {
  activeSignalContext = {
    ...activeSignalContext,
    ...partial,
    timestamp: Date.now(),
  };
}

function clearSignalContext(): void {
  activeSignalContext = {
    ticker: null,
    durationMinutes: 1,
    timestamp: 0,
  };
}

/**
 * Validates whether a candidate string is a plausible trading asset / ticker.
 */
function isValidTicker(rawTicker?: string | null): boolean {
  if (!rawTicker || typeof rawTicker !== 'string') return false;

  const cleaned = cleanTicker(rawTicker).replace(/OTC/i, '').replace(/[^A-Za-z0-9\/\-\s]/g, '').trim().toUpperCase();
  if (!cleaned) return false;

  // 1. Direct match with blacklisted non-signal word
  if (NON_SIGNAL_WORDS.has(cleaned)) return false;

  // 2. Tickers with explicit separators (e.g. "USD MXN", "USD/MXN", "USD-MXN", "EUR USD")
  const parts = cleaned.split(/[\/\-\s]+/).filter(Boolean);
  if (parts.length === 2) {
    const p1 = parts[0];
    const p2 = parts[1];
    if (!p1 || !p2) return false;
    if (NON_SIGNAL_WORDS.has(p1) || NON_SIGNAL_WORDS.has(p2)) return false;
    if (VALID_CURRENCY_CODES.has(p1) && VALID_CURRENCY_CODES.has(p2)) return true;
    if (p1.length >= 2 && p1.length <= 5 && p2.length >= 2 && p2.length <= 5) return true;
    return false;
  }

  // 3. Single-word tickers
  if (parts.length === 1) {
    const single = parts[0];
    if (!single || NON_SIGNAL_WORDS.has(single)) return false;

    // 6-letter concatenated currency pair (e.g. "EURUSD", "USDJPY", "USDCAD")
    if (single.length === 6) {
      const first3 = single.slice(0, 3);
      const last3 = single.slice(3, 6);
      if (VALID_CURRENCY_CODES.has(first3) && VALID_CURRENCY_CODES.has(last3)) {
        return true;
      }
      return false; // Rejects 6-letter words like PROFIT, CHANGE, etc.
    }

    // Individual valid stock / commodity / crypto ticker (e.g. AAPL, NVDA, TSLA, BTC, ETH, GOLD)
    if (single.length >= 2 && single.length <= 5) {
      return true;
    }

    // OTC tagged symbol
    if (rawTicker.toUpperCase().includes('OTC') && single.length >= 3 && single.length <= 10) {
      return true;
    }
  }

  return false;
}

function cleanMarkdownAndHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ') // Strip HTML tags
    .replace(/[*_~`#]+/g, '') // Strip Markdown symbols (*, _, ~, `, #)
    .replace(/[\uFE00-\uFE0F\u200B-\u200D\uFEFF]/g, '') // Strip zero-width & variation selectors
    .replace(/[«»“”"']/g, ' ') // Strip smart & regular quotes
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Strips and classifies emojis and markdown, returning clean ASCII text and direction flags.
 */
function stripEmojis(text: string): { cleaned: string; foundUp: boolean; foundDown: boolean } {
  let foundUp = false;
  let foundDown = false;

  for (const e of UP_EMOJIS) {
    if (text.includes(e)) {
      foundUp = true;
      text = text.replaceAll(e, ' ');
    }
  }
  for (const e of DOWN_EMOJIS) {
    if (text.includes(e)) {
      foundDown = true;
      text = text.replaceAll(e, ' ');
    }
  }
  for (const d of DECORATIVE_EMOJIS) {
    text = text.replaceAll(d, ' ');
  }

  // Strip all other unicode emojis and pictographs comprehensively (e.g. ⏳, 🔔, 📢, 🔜, 🟡, ⚠️, etc.)
  text = text.replace(/\p{Extended_Pictographic}/gu, ' ');

  const cleaned = cleanMarkdownAndHtml(text);

  return { cleaned, foundUp, foundDown };
}

/**
 * Parses multi-line structured signals (e.g. Asset / Time / Direction, or Get Ready / Pair)
 */
function parseMultiLineSignal(rawText: string): TradeSignal | null {
  const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  let ticker: string | null = null;
  let action: ActionType | null = null;
  let isPrepare = false;

  for (const line of lines) {
    const { cleaned, foundUp, foundDown } = stripEmojis(line);
    if (!cleaned) continue;

    // Check for explicit Get Ready / Prepare trigger line
    if (
      /^(?:GET\s+READY|PREPARE|STANDBY|STAND\s+BY|WARM[\s\-]*UP|WARMUP|BE\s+READY|ARE\s+YOU\s+READY|OPEN\s+(?:YOUR\s+)?PLATFORM)(?:\s+(?:FOR|ON|TO|IN))?(?:\s+(?:NEXT\s+)?(?:SIGNAL|TRADE|SESSION))?(?:\s+(?:GUYS|ALL|TEAM|EVERYONE))?(?:\s+(?:NOW|SOON|[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?))?$/i.test(
        cleaned
      )
    ) {
      isPrepare = true;
      continue;
    }

    // Check for ticker / asset line
    const assetMatch =
      cleaned.match(/(?:ASSET|PAIR|CURRENCY|SYMBOL)\s*[:\-]\s*([A-Z0-9\.\-_\/\s]{3,20})/i) ||
      cleaned.match(/^([A-Z0-9]{2,5}(?:[\s\/-]+[A-Z0-9]{2,5})*(?:\s*OTC)?)$/i);
    if (assetMatch && !ticker) {
      const candidate = assetMatch[1];
      if (isValidTicker(candidate)) {
        ticker = cleanTicker(candidate);
        continue;
      }
    }

    // Check for action / direction line
    const actionMatch =
      cleaned.match(/(?:DIRECTION|ACTION|SIGNAL|CALL\/PUT|ENTRY)\s*[:\-]\s*(UP|DOWN|CALL|PUT|BUY|SELL)/i) ||
      cleaned.match(/^(UP|DOWN|CALL|PUT|BUY|SELL)(?:\s+[0-9]+\s*M|\s+[0-9]+\s*MIN(?:UTE)?S?|\s*NOW)?$/i);
    if (actionMatch && !action) {
      action = normalizeAction(actionMatch[1]);
      continue;
    }

    // Emoji-based line direction
    if (!action) {
      if (foundUp && !foundDown) {
        action = 'UP';
      } else if (foundDown && !foundUp) {
        action = 'DOWN';
      }
    }
  }

  if (action) {
    return {
      action,
      ticker: ticker ? ticker.toUpperCase() : 'ACTIVE',
      rawText,
      timestamp: new Date(),
    };
  }

  // Multi-line PREPARE signal (e.g. GET READY on line 1, ASSET on line 2)
  if (isPrepare) {
    return {
      action: 'PREPARE',
      ticker: ticker ? ticker.toUpperCase() : 'READY',
      rawText,
      timestamp: new Date(),
    };
  }

  return null;
}

/**
 * Supported Single-Line Signal Regex Patterns (Strict and Deterministic)
 */
const SIGNAL_PATTERNS: Array<{
  name: string;
  regex: RegExp;
  extract: (match: RegExpExecArray, rawText: string) => TradeSignal | null;
}> = [
  // Pattern 0: ACCOUNT BALANCE TRIGGER
  {
    name: 'BALANCE_TRIGGER',
    regex: /^(?:CHECK\s+)?BALANCE(?:\s+CHECK)?$/i,
    extract: (_match, rawText) => ({
      action: 'BALANCE',
      ticker: 'ACCOUNT',
      rawText,
      timestamp: new Date(),
    }),
  },
  
  // Pattern 0.5: ABORT / CANCEL / STOP / CHANGE TRIGGER
  {
    name: 'ABORT_TRIGGER',
    regex: /^(?:ABORT|CANCEL|STOP|IGNORE|CHANGE)$/i,
    extract: (_match, rawText) => {
      clearSignalContext();
      return {
        action: 'ABORT',
        ticker: 'ACTIVE',
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 0.6: STANDALONE DURATION TRIGGER (e.g. "2 minutes", "1 minute", "5M", "CHANGE TIME TO 2M")
  {
    name: 'STANDALONE_DURATION',
    regex: /^(?:(?:CHANGE\s+(?:TIME|DURATION)\s+TO\s+)|(?:SET\s+TIME\s+TO\s+)|(?:TIME\s*:\s*))?(?:([0-9]+)\s*M|([0-9]+)\s*MIN(?:UTE)?S?|([0-9]+)\s*H(?:OUR)?S?)$/i,
    extract: (match, rawText) => {
      let durationMinutes = undefined;
      if (match[1]) durationMinutes = parseInt(match[1], 10);
      else if (match[2]) durationMinutes = parseInt(match[2], 10);
      else if (match[3]) durationMinutes = parseInt(match[3], 10) * 60;
      
      if (durationMinutes !== undefined) {
        updateSignalContext({ durationMinutes });
      }

      const ctx = getSignalContext();
      return {
        action: 'SET_DURATION',
        ticker: ctx.ticker || 'ACTIVE',
        durationMinutes,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 1: WARM-UP / GET READY TRIGGER (e.g. "Get ready", "GET READY: EUR/USD", "GET READY EUR/USD", "PREPARE USD CHF OTC", "STANDBY", "Open your Platform")
  {
    name: 'GET_READY_STANDBY_TRIGGER',
    regex:
      /^(?:GET\s+READY|PREPARE|STANDBY|STAND\s+BY|WARM[\s\-]*UP|WARMUP|BE\s+READY|ARE\s+YOU\s+READY|READY\s+TO\s+TRADE|GET\s+READY\s+TO\s+TRADE|OPEN\s+(?:YOUR\s+)?PLATFORM)(?:(?:\s*[:\-@]\s*|\s+(?:FOR|ON|AT)\s+|\s+)([A-Z0-9\.\-_\/\s]{1,25}))?$/i,
    extract: (match, rawText) => {
      const candidate = match[1]?.trim();
      let ticker = 'READY';

      if (candidate) {
        const cleanedCandidate = candidate
          .replace(/^(?:FOR\s+)?(?:NEXT\s+)?(?:SIGNAL|TRADE|SESSION|ENTRY|ORDER)S?/i, '')
          .replace(/\b(?:GUYS|ALL|TEAM|EVERYONE|TRADERS|BRO|MEMBERS|NOW|SOON|TODAY)\b/gi, '')
          .replace(/\b(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|[0-9]+\s*H(?:OUR)?S?)\b/gi, '')
          .trim();

        if (cleanedCandidate && isValidTicker(cleanedCandidate)) {
          ticker = cleanTicker(cleanedCandidate).toUpperCase();
          updateSignalContext({ ticker });
        }
      }

      return {
        action: 'PREPARE',
        ticker,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 1.5: TICKER FIRST WITH GET READY / PREPARE (e.g. "EUR/USD GET READY", "USD CHF OTC PREPARE")
  {
    name: 'TICKER_WITH_PREPARE',
    regex:
      /^([A-Z0-9\.\-_\/]{2,10}(?:\s+[A-Z0-9\.\-_\/]{2,10})*(?:\s*OTC)?)\s+(?:GET\s+READY|PREPARE|STANDBY|STAND\s+BY|WARM[\s\-]*UP|WARMUP|OPEN\s+(?:YOUR\s+)?PLATFORM)$/i,
    extract: (match, rawText) => {
      const rawCandidate = match[1]?.trim();
      if (!isValidTicker(rawCandidate)) return null;

      const ticker = cleanTicker(rawCandidate).toUpperCase();
      updateSignalContext({ ticker });
      return {
        action: 'PREPARE',
        ticker,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 2: STANDALONE DIRECTION (e.g. "Up", "Down", "Call", "Put", "UP 1M", "DOWN NOW", "1M UP", "1 MIN CALL")
  {
    name: 'STANDALONE_UP_DOWN',
    regex:
      /^(?:(UP|DOWN|CALL|PUT|BUY|SELL)(?:\s+(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|M[0-9]+|NOW))?|(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|M[0-9]+)\s+(UP|DOWN|CALL|PUT|BUY|SELL))$/i,
    extract: (match, rawText) => {
      const action = normalizeAction(match[1] || match[2]);
      const ctx = getSignalContext();
      const ticker = ctx.ticker || 'ACTIVE';
      const durationMinutes = extractDurationMinutes(rawText) || ctx.durationMinutes || 1;

      return {
        action,
        ticker,
        durationMinutes,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 2.5: DIRECTION LABEL FORMAT (e.g. "DIRECTION: UP", "SIGNAL: CALL", "ACTION: UP 1M")
  {
    name: 'DIRECTION_LABEL_FORMAT',
    regex:
      /^(?:DIRECTION|SIGNAL|ACTION|TRADE|ENTRY|CALL\/PUT)\s*[:\-]\s*(UP|DOWN|CALL|PUT|BUY|SELL)(?:\s+(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|NOW))?$/i,
    extract: (match, rawText) => {
      const action = normalizeAction(match[1]);
      const ctx = getSignalContext();
      const ticker = ctx.ticker || 'ACTIVE';
      const durationMinutes = extractDurationMinutes(rawText) || ctx.durationMinutes || 1;

      return {
        action,
        ticker,
        durationMinutes,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 3: ACTION WITH TICKER (e.g. "UP EUR/USD", "DOWN USD CHF OTC", "CALL USD/JPY 1M", "BUY AAPL @ 150")
  {
    name: 'ACTION_WITH_TICKER',
    regex:
      /^(UP|DOWN|CALL|PUT|BUY|SELL)\s+([A-Z0-9\.\-_\/]{2,10}(?:\s+[A-Z0-9\.\-_\/]{2,10})*(?:\s*OTC)?)(?:\s+(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|NOW))?(?:\s*@\s*(\d+(?:\.\d+)?))?$/i,
    extract: (match, rawText) => {
      const rawCandidate = match[2];
      if (!isValidTicker(rawCandidate)) return null;

      const action = normalizeAction(match[1]);
      const ticker = cleanTicker(rawCandidate)?.toUpperCase();
      const rawPrice = match[3];
      if (!ticker) return null;

      updateSignalContext({ ticker });
      return {
        action,
        ticker,
        price: rawPrice ? Number.parseFloat(rawPrice) : undefined,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 4: TICKER WITH ACTION (e.g. "EUR/USD UP", "USD CHF OTC DOWN", "EUR USD 1M UP", "USD/CAD 5M PUT", "USD/JPY 2 MIN PUT")
  {
    name: 'TICKER_WITH_ACTION',
    regex:
      /^([A-Z0-9\.\-_\/]{2,10}(?:\s+[A-Z0-9\.\-_\/]{2,10})*(?:\s*OTC)?)(?:\s+(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?))?\s+(UP|DOWN|CALL|PUT|BUY|SELL)(?:\s+(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|NOW))?$/i,
    extract: (match, rawText) => {
      const rawCandidate = match[1];
      if (!isValidTicker(rawCandidate)) return null;

      const ticker = cleanTicker(rawCandidate)?.toUpperCase();
      const action = normalizeAction(match[2]);
      if (!ticker) return null;

      updateSignalContext({ ticker });
      return {
        action,
        ticker,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 5: SIGNAL PREFIX FORMAT (e.g. "UP SIGNAL: EUR/USD", "SIGNAL: DOWN USD/CHF", "BUY SIGNAL: AAPL @ 180")
  {
    name: 'SIGNAL_PREFIX_FORMAT',
    regex:
      /^(?:SIGNAL\s*:\s*(UP|DOWN|CALL|PUT|BUY|SELL)\s+([A-Z0-9\.\-_\/\s]{1,20}?)|(UP|DOWN|CALL|PUT|BUY|SELL)\s+SIGNAL\s*:\s*([A-Z0-9\.\-_\/\s]{1,20}?))(?:\s*@\s*(\d+(?:\.\d+)?))?$/i,
    extract: (match, rawText) => {
      const rawAction = match[1] || match[3];
      const rawCandidate = match[2] || match[4];
      if (!isValidTicker(rawCandidate)) return null;

      const ticker = cleanTicker(rawCandidate)?.toUpperCase();
      const rawPrice = match[5];
      if (!rawAction || !ticker) return null;

      updateSignalContext({ ticker });
      return {
        action: normalizeAction(rawAction),
        ticker,
        price: rawPrice ? Number.parseFloat(rawPrice) : undefined,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 6: VIP ADVANCED FORMAT (e.g. "BUY AMZN ENTRY: 180 TP: 200 SL: 170")
  {
    name: 'VIP_ADVANCED_FORMAT',
    regex:
      /^(UP|DOWN|CALL|PUT|BUY|SELL)\s+([A-Z0-9\.\-_\/\s]{1,20}?)(?:\s+ENTRY:\s*(\d+(?:\.\d+)?))?(?:\s+(?:TP|TARGET):\s*(\d+(?:\.\d+)?))?(?:\s+SL:\s*(\d+(?:\.\d+)?))?$/i,
    extract: (match, rawText) => {
      const rawCandidate = match[2];
      if (!isValidTicker(rawCandidate)) return null;

      const action = normalizeAction(match[1]);
      const ticker = cleanTicker(rawCandidate)?.toUpperCase();
      const entryPrice = match[3];
      const takeProfit = match[4];
      const stopLoss = match[5];
      if (!ticker) return null;

      updateSignalContext({ ticker });
      return {
        action,
        ticker,
        price: entryPrice ? Number.parseFloat(entryPrice) : undefined,
        takeProfit: takeProfit ? Number.parseFloat(takeProfit) : undefined,
        stopLoss: stopLoss ? Number.parseFloat(stopLoss) : undefined,
        rawText,
        timestamp: new Date(),
      };
    },
  },

  // Pattern 7: STANDALONE RAW TICKER (e.g. "USD MXN OTC", "USD BRL OTC", "EUR/USD", "USDJPY", "CAD CHF OTC", "USD INR OTC")
  {
    name: 'RAW_TICKER_PREPARE',
    regex: /^([A-Z0-9]{2,5}(?:[\s\/-]+[A-Z0-9]{2,5})+(?:\s*OTC)?|[A-Z]{3,10}(?:\s*OTC)|[A-Z]{6})$/i,
    extract: (match, rawText) => {
      const rawCandidate = match[1]?.trim();
      if (!rawCandidate || !isValidTicker(rawCandidate)) return null;

      const ticker = cleanTicker(rawCandidate)?.toUpperCase();
      if (!ticker) return null;

      // Update signal context so subsequent "2 minutes" and "Up" inherit this ticker!
      updateSignalContext({ ticker });

      return {
        action: 'PREPARE',
        ticker,
        rawText,
        timestamp: new Date(),
      };
    },
  },
];

/**
 * Strictly parses raw message text into a validated TradeSignal.
 * Returns null if the message does not match any recognized deterministic signal format.
 */
export function parseSignal(rawMessage: string): TradeSignal | null {
  if (!rawMessage || typeof rawMessage !== 'string') {
    logger.debug('Received empty or non-string message. Dropping.');
    return null;
  }

  const cleanRaw = rawMessage.trim();
  if (!cleanRaw) return null;

  // Multi-line structured signal check
  if (cleanRaw.includes('\n')) {
    const multiLineSignal = parseMultiLineSignal(cleanRaw);
    if (multiLineSignal) {
      const durationMinutes = extractDurationMinutes(cleanRaw);
      multiLineSignal.durationMinutes = durationMinutes;
      if (multiLineSignal.ticker && multiLineSignal.ticker !== 'READY' && multiLineSignal.ticker !== 'ACTIVE') {
        updateSignalContext({ ticker: multiLineSignal.ticker });
      }
      logger.info(
        `Successfully parsed ${multiLineSignal.action} signal for ${multiLineSignal.ticker} using [STRUCTURED_MULTILINE]`
      );
      return multiLineSignal;
    }
  }

  // Preprocess single-line message
  const { cleaned, foundUp, foundDown } = stripEmojis(cleanRaw);

  const durationMinutes = extractDurationMinutes(cleanRaw);

  // If message was pure emoji or emoji + timeframe (e.g., "🟢", "🔴 1M", "🔼 NOW")
  if (foundUp && !foundDown && (!cleaned || /^(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|NOW)$/i.test(cleaned))) {
    const ctx = getSignalContext();
    const ticker = ctx.ticker || 'ACTIVE';
    const dur = durationMinutes || ctx.durationMinutes || 1;
    logger.info(`Successfully parsed UP signal for ${ticker} using [EMOJI_DIRECTION]`);
    return {
      action: 'UP',
      ticker,
      durationMinutes: dur,
      rawText: cleanRaw,
      timestamp: new Date(),
    };
  }

  if (foundDown && !foundUp && (!cleaned || /^(?:[0-9]+\s*M|[0-9]+\s*MIN(?:UTE)?S?|NOW)$/i.test(cleaned))) {
    const ctx = getSignalContext();
    const ticker = ctx.ticker || 'ACTIVE';
    const dur = durationMinutes || ctx.durationMinutes || 1;
    logger.info(`Successfully parsed DOWN signal for ${ticker} using [EMOJI_DIRECTION]`);
    return {
      action: 'DOWN',
      ticker,
      durationMinutes: dur,
      rawText: cleanRaw,
      timestamp: new Date(),
    };
  }

  // Try deterministic single-line patterns against cleaned string
  for (const pattern of SIGNAL_PATTERNS) {
    const match = pattern.regex.exec(cleaned);
    if (match) {
      const signal = pattern.extract(match, cleanRaw);
      if (signal) {
        if (signal.ticker.length >= 1 && signal.ticker.length <= 30) {
          if (durationMinutes !== undefined && signal.durationMinutes === undefined) {
            signal.durationMinutes = durationMinutes;
          }
          logger.info(
            `Successfully parsed ${signal.action} signal for ${signal.ticker} using [${pattern.name}]`
          );
          return signal;
        }
      }
    }
  }

  logger.warn(
    `Unrecognized message format. Dropping task. Raw Content: "${cleanRaw.slice(0, 100)}"`
  );
  return null;
}
