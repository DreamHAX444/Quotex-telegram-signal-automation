import dotenv from 'dotenv';
import path from 'node:path';
import type { AppConfig } from './types.js';
import { logger } from './logger.js';

// Load environment variables from .env file
dotenv.config();

function parseChannelId(raw: string): { raw: string; bigIntVal: bigint } {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('VIP_CHANNEL_ID environment variable cannot be empty.');
  }

  if (trimmed === 'YOUR_NUMERICAL_CHANNEL_ID') {
    logger.warn('VIP_CHANNEL_ID is set to placeholder. Please set your numerical channel ID in .env.');
    return { raw: trimmed, bigIntVal: 1234567890n };
  }

  // Telegram supergroups and channels in Bot API often start with -100 (e.g. -1001234567890).
  // In GramJS, PeerChannel.channelId is stored as positive BigInt (e.g. 1234567890n).
  let cleaned = trimmed;
  if (cleaned.startsWith('-100')) {
    cleaned = cleaned.slice(4);
  } else if (cleaned.startsWith('-')) {
    cleaned = cleaned.slice(1);
  }

  try {
    const bigIntVal = BigInt(cleaned);
    return { raw: trimmed, bigIntVal };
  } catch {
    throw new Error(
      `Invalid VIP_CHANNEL_ID: "${trimmed}". Must be a valid numerical Telegram channel ID.`
    );
  }
}

function validateAndLoadConfig(): AppConfig {
  const rawApiId = process.env.API_ID?.trim();
  const apiHash = process.env.API_HASH?.trim();
  const sessionString = process.env.SESSION_STRING?.trim();
  const vipChannelIdRaw = process.env.VIP_CHANNEL_ID?.trim();

  const missing: string[] = [];
  if (!rawApiId) missing.push('API_ID');
  if (!apiHash) missing.push('API_HASH');
  if (!sessionString) missing.push('SESSION_STRING');
  if (!vipChannelIdRaw) missing.push('VIP_CHANNEL_ID');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables in .env: ${missing.join(', ')}`
    );
  }

  const apiId = Number.parseInt(rawApiId!, 10);
  if (Number.isNaN(apiId) || apiId <= 0) {
    throw new Error(`Invalid API_ID: "${rawApiId}". Must be a positive integer.`);
  }

  if (sessionString === 'YOUR_GENERATED_SESSION_STRING') {
    logger.warn(
      'SESSION_STRING is currently set to placeholder. Run "npm run generate-session" to authenticate and get your session string.'
    );
  }

  const { raw: parsedVipRaw, bigIntVal: vipBigInt } = parseChannelId(vipChannelIdRaw!);

  const headless = process.env.HEADLESS === 'true'; // Default to visible desktop Chrome unless specified
  const browserTimeoutMs = process.env.BROWSER_TIMEOUT_MS
    ? Number.parseInt(process.env.BROWSER_TIMEOUT_MS, 10)
    : 30000;

  const rawStandby = process.env.STANDBY_TIMEOUT_MS?.trim();
  let standbyTimeoutMs = Number.POSITIVE_INFINITY; // Default to Infinity (never times out, keeps warm indefinitely)
  if (rawStandby) {
    const lower = rawStandby.toLowerCase();
    if (lower === 'infinity' || lower === 'infinite' || lower === '0' || lower === '-1' || lower === 'none') {
      standbyTimeoutMs = Number.POSITIVE_INFINITY;
    } else {
      const parsed = Number.parseInt(rawStandby, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        standbyTimeoutMs = parsed;
      }
    }
  }

  const targetUrl = process.env.TARGET_URL?.trim() || 'https://example.com/trading';

  const authStoragePath = path.resolve(process.cwd(), '.auth', 'storageState.json');
  const screenshotsDir = path.resolve(process.cwd(), 'screenshots');

  // Chrome executable and profile directory resolution
  const chromeExecutablePath =
    process.env.CHROME_EXECUTABLE_PATH?.trim() ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const chromeUserDataDir =
    process.env.CHROME_USER_DATA_DIR?.trim() ||
    path.resolve(process.cwd(), '.auth', 'cortex_chrome_profile');

  const chromeProfileName = process.env.CHROME_PROFILE_NAME?.trim() || 'Profile 1';

  const cdpPort = process.env.CDP_PORT ? Number.parseInt(process.env.CDP_PORT, 10) : 9222;
  const cdpUrl = process.env.CDP_URL?.trim() || `http://127.0.0.1:${cdpPort}`;
  const autoLaunchChrome = process.env.AUTO_LAUNCH_CHROME !== 'false';
  const browserChannel = process.env.BROWSER_CHANNEL?.trim() || undefined;

  return {
    apiId,
    apiHash: apiHash!,
    sessionString: sessionString!,
    vipChannelIdRaw: parsedVipRaw,
    vipChannelIdBigInt: vipBigInt,
    headless,
    browserTimeoutMs,
    standbyTimeoutMs,
    targetUrl,
    authStoragePath,
    screenshotsDir,
    chromeExecutablePath,
    chromeUserDataDir,
    chromeProfileName,
    cdpPort,
    cdpUrl,
    autoLaunchChrome,
    browserChannel,
  };
}

export const config = validateAndLoadConfig();
