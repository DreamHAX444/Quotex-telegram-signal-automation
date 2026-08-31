# Cortex Automation - Telegram UserBot & Playwright Engine

A deterministic, high-reliability Telegram UserBot built with TypeScript, GramJS, Playwright, and a custom `AutomationQueue`. It monitors a specific private VIP Telegram channel, extracts strictly formatted commands/signals, and triggers sequential browser automation tasks.

---

## Key Features & "Max Potential" Upgrades

1. **Deterministic Execution (Zero AI / Heuristics):** All parsing relies on strict regular expressions with boundary anchors. If an incoming message is casual chatter or malformed, it is immediately discarded.
2. **"Get ready" Browser Pre-warming (Zero Cold-Start Latency):** When the channel broadcasts `"Get ready"` or `"PREPARE: [TICKER]"`, the bot pre-opens the browser with previous session cookies/storage (or your personal Chrome profile), pre-loads the trading interface, and stands by. When the subsequent `BUY`/`SELL` order arrives, execution happens instantly (~15ms) on the active page!
3. **Browser Context & User Profile Persistence:** Playwright automatically stores and loads `storageState` in `./.auth/storageState.json` (or can launch your personal Chrome profile via `CHROME_USER_DATA_DIR`). This eliminates repetitive login screens, 2FA prompts, and anti-bot CAPTCHAs.
4. **Automated Telegram Debug Alerts:** If a browser automation step crashes or times out, Playwright takes a full-page failure screenshot and the bot automatically forwards it to your Telegram **"Saved Messages" (`me`)** along with the error stack and timestamp.
5. **Strict Concurrency Control (`concurrency: 1`):** Uses a custom `AutomationQueue` to lock execution to exactly one browser instance at a time. Rapid-fire signals from the VIP channel are queued FIFO, preventing server CPU/RAM exhaustion and zombie browser processes.
6. **Graceful Teardown Lifecycle:** Handlers for `SIGINT` and `SIGTERM` ensure that when stopping or restarting the bot, any warm browser session is closed, the queue is drained/paused, the GramJS MTProto client disconnects cleanly, and all Playwright instances are closed.
7. **Structured Timestamped Logging:** Standardized log outputs (`[YYYY-MM-DD HH:mm:ss.SSS] [LEVEL]`) covering Telegram events, queue status, and browser steps.

8. **Multi-Strategy Real-time Balance Engine:** Automatically extracts, parses, and normalizes live account balances across diverse currencies (`$`, `€`, `£`, `₹`, `USDT`, `BRL`, `INR`, etc.) using multi-layer DOM selectors, account label anchoring, and heuristic currency parsing. Tracks balance changes across trade executions and powers the real-time web dashboard.

---

## System Architecture

```
                                  Telegram MTProto Network
                                             │
                                             ▼
                                     ┌───────────────┐
                                     │    bot.ts     │
                                     │ (GramJS Client)
                                     └───────┬───────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │ Is peerId.channelId === VIP_CHANNEL_ID?   │
                       └─────────────────────┬─────────────────────┘
                                      YES    │    NO ──> [Drop & Ignore]
                                             ▼
                                     ┌───────────────┐
                                     │   parser.ts   │
                                     │(Strict Regex) │
                                     └───────┬───────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │ Valid TradeSignal / Command format?       │
                       └─────────────────────┬─────────────────────┘
                                      YES    │    NO ──> [Log Warning & Drop]
                                             ▼
                                     ┌───────────────┐
                                     │   queue.ts    │
                                     │(PQueue conc:1)│
                                     └───────┬───────┘
                                             │ FIFO Task Dispatch
                                             ▼
                                     ┌───────────────┐
                                     │  executor.ts  │
                                     │ (Playwright)  │
                                     └───────┬───────┘
                       ┌─────────────────────┼─────────────────────┐
                       ▼                     ▼                     ▼
               [BALANCE / PREPARE]     [BUY / SELL]            [FAILURE]
                       │                     │                     │
               Extract & Record        Execute Order &         Screenshot &
               in BalanceManager       Extract Post-Trade      Telegram Alert
                       │                     │                     │
                       └───────────┬─────────┘                     │
                                   ▼                               │
                       Update Dashboard API & UI                   │
```

---

## Directory Structure

```text
cortex-automation/
├── .env                  # API keys, channel ID, and session string
├── .env.example          # Environment variables template
├── package.json          # Node dependencies and execution scripts
├── tsconfig.json         # Strict TypeScript compiler options
├── screenshots/          # Local storage for error debug screenshots
├── .auth/                # Ignored in git; stores browser cookies & localStorage
└── src/
    ├── types.ts          # Centralized interfaces (TradeSignal, AccountBalance, Task, AppConfig)
    ├── logger.ts         # Structured, timestamped logger
    ├── config.ts         # Environment validation and BigInt channel ID normalization
    ├── balance.ts        # Multi-strategy balance extractor & state store
    ├── parser.ts         # Deterministic regex matching & strict validation
    ├── executor.ts       # Playwright worker with storageState & balance capture
    ├── queue.ts          # PQueue sequential task queue manager
    ├── server.ts         # HTTP dashboard & REST API server (/api/balance)
    ├── bot.ts            # Main entry point, Telegram listener & alert feedback loop
    ├── generate.ts       # Interactive CLI tool for generating StringSession
    └── test-suite.ts     # Automated unit & integration verification tests
```

---

## Getting Started

### 1. Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **Telegram Account**: With access to https://my.telegram.org

---

### 2. Installation

1. Clone or open this repository directory:
   ```bash
   cd "cortex automation"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Install Playwright browser binaries:
   ```bash
   npx playwright install chromium
   ```

---

### 3. Telegram API Credentials & Session String

1. Visit [https://my.telegram.org](https://my.telegram.org) and log in with your phone number.
2. Navigate to **API development tools** and create an application (if you haven't already) to get:
   - `App api_id`
   - `App api_hash`
3. Update your `.env` file with `API_ID` and `API_HASH`.
4. Run the interactive session generator:
   ```bash
   npm run generate-session
   ```
   Follow the prompts to enter your phone number, 2FA password (if applicable), and Telegram login code. The script will output your `SESSION_STRING` and automatically save it to `.env`.

---

### 4. Setting the VIP Channel ID

In your `.env` file, set `VIP_CHANNEL_ID` to your target private channel's numerical ID (e.g. `-1001771915378`).

---

### 7. Running the Test Suite

Verify parsing logic, multi-currency balance parser, queue serialization, and Playwright execution:
```bash
npm test
```

---

### 8. Running the UserBot

#### Development Mode (with TSX live execution):
```bash
npm run dev
```

#### Production Build & Start:
```bash
npm run build
npm start
```

---

## Signal Format Reference

The parser in `src/parser.ts` accepts strict deterministic formats:

| Format Pattern | Sample Telegram Message | Parsed Action | Parsed Ticker | Parsed Price |
| :--- | :--- | :--- | :--- | :--- |
| **Balance Check** | `BALANCE` / `/balance` / `CHECK BALANCE` | `BALANCE` | `ACCOUNT` | `undefined` |
| **Get Ready / Standby** | `Get ready` | `PREPARE` | `READY` | `undefined` |
| **Get Ready with Ticker** | `GET READY: NVDA` | `PREPARE` | `NVDA` | `undefined` |
| **Prefix Format** | `BUY SIGNAL: AAPL` | `BUY` | `AAPL` | `undefined` |
| **Prefix with Price** | `SELL SIGNAL: MSFT @ 415.50` | `SELL` | `MSFT` | `415.50` |
| **Direct Action** | `BUY NVDA @ 125` | `BUY` | `NVDA` | `125.00` |
| **Direct Action without Price** | `SELL TSLA` | `SELL` | `TSLA` | `undefined` |
| **VIP Extended** | `BUY AMZN ENTRY: 180 TP: 200 SL: 170` | `BUY` | `AMZN` | `180.00` |

*Casual conversation, URLs, and unsupported message formats are rejected and logged.*

---

## License

ISC

