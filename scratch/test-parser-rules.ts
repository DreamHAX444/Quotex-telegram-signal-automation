import { parseSignal, extractDurationMinutes, isValidTicker } from '../src/parser.js';

const testMessages = [
  "Get ready",
  "Open your Platform",
  "USD BRL OTC",
  "2 minutes",
  "Down",
  "Profit 🚀",
  "USD BRL OTC",
  "2 minutes",
  "Up",
  "USD INR OTC",
  "2 minutes",
  "Down",
  "Change",
  "CAD CHF OTC",
  "2 minutes",
  "Up",
  "EUR USD OTC",
  "1 minute",
  "Down",
  "EUR/USD 1M CALL",
  "USD/JPY 2 MIN PUT",
  "Profit 🚀🚀",
  "Let's start in 90 minutes",
  "Good session... Let's continue later 🚀🚀"
];

console.log('Testing Parser on Channel Messages:\n');
for (const msg of testMessages) {
  const parsed = parseSignal(msg);
  console.log(`[RAW] "${msg}"`);
  console.log(` ↳ [PARSED]`, parsed ? `${parsed.action} | Ticker: ${parsed.ticker} | Dur: ${parsed.durationMinutes || 'N/A'}` : 'NULL (Chat/Noise)');
}
