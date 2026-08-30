import path from 'node:path';
import fs from 'node:fs';
import type { AppConfig } from './types.js';
import { logger } from './logger.js';

export function parseChannelId(raw: string): { raw: string; bigIntVal: bigint } {
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

  const targetUrl = process.env.TARGET_URL?.trim() || 'https://example.com/trading';

  const screenshotsDir = path.resolve(process.cwd(), 'screenshots');

  // Chrome executable and profile directory resolution
  const chromeExecutablePath =
    process.env.CHROME_EXECUTABLE_PATH?.trim() ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const chromeUserDataDir =
    process.env.CHROME_USER_DATA_DIR?.trim() ||
    path.resolve(process.cwd(), '.auth', 'cortex_chrome_profile');

  const chromeProfileName = process.env.CHROME_PROFILE_NAME?.trim() || 'Profile 1';

  const autoLaunchChrome = process.env.AUTO_LAUNCH_CHROME !== 'false';

  return {
    apiId,
    apiHash: apiHash!,
    sessionString: sessionString!,
    vipChannelIdRaw: parsedVipRaw,
    vipChannelIdBigInt: vipBigInt,
    headless,
    browserTimeoutMs,
    targetUrl,
    screenshotsDir,
    chromeExecutablePath,
    chromeUserDataDir,
    chromeProfileName,
    autoLaunchChrome,
  };
}

export let config = validateAndLoadConfig();

export async function updateVipChannelId(newChannelId: string) {
  const { raw, bigIntVal } = parseChannelId(newChannelId);
  config.vipChannelIdRaw = raw;
  config.vipChannelIdBigInt = bigIntVal;

  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    let envContent = await fs.promises.readFile(envPath, 'utf8');
    // Replace VIP_CHANNEL_ID=... with the new value, or append if missing
    if (envContent.match(/^VIP_CHANNEL_ID=.*$/m)) {
      envContent = envContent.replace(/^VIP_CHANNEL_ID=.*$/m, `VIP_CHANNEL_ID=${raw}`);
    } else {
      envContent += `\nVIP_CHANNEL_ID=${raw}\n`;
    }
    await fs.promises.writeFile(envPath, envContent, 'utf8');
    logger.info(`Updated VIP_CHANNEL_ID to ${raw} in .env file and memory.`);
  } else {
    logger.warn('Could not find .env file to save the new VIP_CHANNEL_ID.');
  }
}
