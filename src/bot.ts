import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram/tl/index.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { logger } from './logger.js';
import { parseSignal } from './parser.js';
import { executeAutomation, closeWarmBrowser } from './executor.js';
import { automationQueue } from './queue.js';
import { startDashboardServer } from './server.js';
import type { AutomationTask, TradeSignal } from './types.js';

/**
 * Validates session string before initializing GramJS
 */
if (!config.sessionString || config.sessionString === 'YOUR_GENERATED_SESSION_STRING') {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║               ⚠️  SESSION STRING REQUIRED                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║ Your .env contains a placeholder SESSION_STRING.             ║');
  console.log('║                                                              ║');
  console.log('║ 👉 Please run the session generator to log in:               ║');
  console.log('║                                                              ║');
  console.log('║       npm run generate-session                               ║');
  console.log('║                                                              ║');
  console.log('║ Follow the prompt to enter your phone number and login code. ║');
  console.log('║ It will automatically save your session string into .env!    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  process.exit(1);
}

/**
 * Initializes the GramJS Telegram UserBot Client
 */
const session = new StringSession(config.sessionString);
const client = new TelegramClient(session, config.apiId, config.apiHash, {
  connectionRetries: 5,
  useWSS: false,
});

/**
 * Extracts the numerical peer channel/chat ID as a BigInt from GramJS peer or message.
 */
function extractPeerChannelId(target: unknown): bigint | null {
  if (!target || typeof target !== 'object') return null;
  const t = target as { channelId?: { toString: () => string }; peerId?: unknown; chatId?: { toString: () => string } };

  if (target instanceof Api.PeerChannel && target.channelId !== undefined) {
    return BigInt(target.channelId.toString());
  }

  if (target instanceof Api.PeerChat && target.chatId !== undefined) {
    const cleaned = target.chatId.toString().replace(/^-100/, '').replace(/^-/, '');
    return BigInt(cleaned);
  }

  if (t.channelId !== undefined) {
    return BigInt(t.channelId.toString());
  }

  if (t.peerId) {
    return extractPeerChannelId(t.peerId);
  }

  if (t.chatId !== undefined) {
    const cleaned = t.chatId.toString().replace(/^-100/, '').replace(/^-/, '');
    try {
      return BigInt(cleaned);
    } catch {}
  }

  return null;
}

/**
 * Prints formatted channel metadata box to the terminal.
 */
function printChannelDetails(info: {
  title: string;
  id: string;
  bigIntId: string;
  username?: string | undefined;
  type: string;
  participantsCount?: number | undefined;
}): void {
  const usernameStr = info.username ? '@' + info.username : 'Private';
  const membersStr = info.participantsCount !== undefined ? info.participantsCount.toLocaleString() : 'Unknown';
  logger.telegram(`Linked to VIP Channel: ${info.title} (${info.type}) | ID: ${info.id} | ${usernameStr} | Members: ${membersStr}`);
}

/**
 * Prints rich incoming message details box in the terminal.
 */
function printIncomingMessage(msgDetails: {
  messageId: number;
  date: Date;
  senderName: string;
  text: string;
  parsedSignal: TradeSignal | null;
}): void {
  // Print raw message as a single line
  const cleanText = msgDetails.text.replace(/\n/g, ' ↵ ');
  logger.telegram(`Message #${msgDetails.messageId} from [${msgDetails.senderName}]: ${cleanText}`);

  if (msgDetails.parsedSignal) {
    const s = msgDetails.parsedSignal;
    if (s.action === 'BALANCE') {
      logger.info(`↳ Parsed: 💰 BALANCE CHECK TRIGGER`);
    } else if (s.action === 'PREPARE') {
      logger.info(`↳ Parsed: ⚡ PRE-WARM / STANDBY: ${s.ticker}`);
    } else if (s.action === 'SET_DURATION') {
      logger.info(`↳ Parsed: ⏱️ TIME UPDATE: ${s.durationMinutes} minutes`);
    } else if (s.action === 'ABORT') {
      logger.info(`↳ Parsed: 🛑 ABORT / CANCEL PREVIOUS SIGNAL`);
    } else {
      let icon = '✅';
      if (['UP', 'CALL', 'BUY'].includes(s.action)) icon = '🟢';
      if (['DOWN', 'PUT', 'SELL'].includes(s.action)) icon = '🔴';
      
      let details = `↳ Parsed: ${icon} VALID ${s.action} SIGNAL: ${s.ticker}`;
      if (s.price !== undefined) details += ` | Entry: ${s.price}`;
      if (s.takeProfit !== undefined) details += ` | TP: ${s.takeProfit}`;
      if (s.stopLoss !== undefined) details += ` | SL: ${s.stopLoss}`;
      logger.info(details);
    }
  } else {
    logger.warn(`↳ Parsed: ⚠️ UNRECOGNIZED FORMAT / DROPPED`);
  }
}

/**
 * Attempts to inspect and fetch details of the configured VIP channel.
 */
async function inspectTargetChannel(): Promise<void> {
  logger.telegram(`Fetching details for VIP Channel [ID: ${config.vipChannelIdRaw}]...`);

  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    const targetDialog = dialogs.find((d) => {
      const entity = d.entity as { id?: { toString: () => string }; title?: string; username?: string; broadcast?: boolean; megagroup?: boolean; participantsCount?: number };
      if (entity?.id && BigInt(entity.id.toString()) === config.vipChannelIdBigInt) {
        return true;
      }
      const peerId = extractPeerChannelId(d.message?.peerId || (d.dialog as any)?.peer);
      return peerId !== null && peerId === config.vipChannelIdBigInt;
    });

    if (targetDialog && targetDialog.entity) {
      const entity = targetDialog.entity as { title?: string; username?: string; broadcast?: boolean; megagroup?: boolean; participantsCount?: number };
      printChannelDetails({
        title: entity.title || targetDialog.title || 'Untitled Channel',
        id: config.vipChannelIdRaw,
        bigIntId: config.vipChannelIdBigInt.toString(),
        username: entity.username,
        type: entity.broadcast ? 'Broadcast Channel (VIP)' : entity.megagroup ? 'Supergroup' : 'Chat',
        participantsCount: entity.participantsCount,
      });
      return;
    }

    // Direct entity lookup fallback
    try {
      const channelPeer = new Api.PeerChannel({ channelId: config.vipChannelIdBigInt as any });
      const entity = (await client.getEntity(channelPeer)) as { title?: string; username?: string; broadcast?: boolean; participantsCount?: number };
      if (entity) {
        printChannelDetails({
          title: entity.title || 'VIP Channel',
          id: config.vipChannelIdRaw,
          bigIntId: config.vipChannelIdBigInt.toString(),
          username: entity.username,
          type: entity.broadcast ? 'Broadcast Channel' : 'Group / Channel',
          participantsCount: entity.participantsCount,
        });
        return;
      }
    } catch {
      // Entity not in local MTProto cache yet
    }

    // Default display if entity cannot be resolved yet
    printChannelDetails({
      title: 'Target Channel (Active)',
      id: config.vipChannelIdRaw,
      bigIntId: config.vipChannelIdBigInt.toString(),
      type: 'Private Channel / Supergroup',
    });
  } catch (err) {
    logger.warn('Could not retrieve full channel metadata from Telegram cache', err);
    printChannelDetails({
      title: 'Configured VIP Channel',
      id: config.vipChannelIdRaw,
      bigIntId: config.vipChannelIdBigInt.toString(),
      type: 'Private Channel',
    });
  }
}


const processedMessageIdSet = new Set<string>();
const lastProcessedMessageIds = new Map<string, number>();

/**
 * Common logic to parse and execute a message from the VIP channel
 */
function processMessage(message: any): void {
  if (!message) return;
  
  const currentChannelStr = config.vipChannelIdBigInt.toString();
  
  if (message.id !== undefined) {
    const messageKey = `${currentChannelStr}_${message.id}`;
    if (processedMessageIdSet.has(messageKey)) {
      return; // Strictly drop duplicates from event + polling races
    }
    
    const highestSeen = lastProcessedMessageIds.get(currentChannelStr) || 0;
    if (highestSeen > 0 && message.id < highestSeen - 50) {
      return; // Message is suspiciously old, drop it to prevent historical zombies
    }

    processedMessageIdSet.add(messageKey);
    // Amortized eviction: batch-remove oldest entries when set grows too large
    if (processedMessageIdSet.size > 2000) {
      const iter = processedMessageIdSet.values();
      for (let i = 0; i < 500; i++) {
        const entry = iter.next();
        if (entry.done) break;
        processedMessageIdSet.delete(entry.value);
      }
    }
    
    if (message.id > highestSeen) {
      lastProcessedMessageIds.set(currentChannelStr, message.id);
    }
  }

  const rawText = message.message || '';
  const senderName = message.postAuthor || (message.sender ? (message.sender as any).firstName : 'Channel Admin') || 'VIP Channel';

  // Parse and validate signal deterministically
  const signal = parseSignal(rawText);

  // Display rich message and signal details in terminal
  printIncomingMessage({
    messageId: message.id,
    date: new Date(message.date ? message.date * 1000 : Date.now()),
    senderName,
    text: rawText,
    parsedSignal: signal,
  });

  if (!signal) {
    // Parser logs unrecognized format and returns null
    return;
  }

  const task: AutomationTask = {
    id: randomUUID(),
    signal,
    receivedAt: new Date(),
  };

  // Enqueue task for sequential Playwright automation
  automationQueue
    .enqueue(task, executeAutomation)
    .then(async (result) => {
      if (result.success) {
        logger.info(
          `Task [${task.id}] succeeded for [${result.signal.action} ${result.signal.ticker}] in ${result.durationMs}ms`
        );
      } else {
        logger.error(
          `Task [${task.id}] failed for [${result.signal.action} ${result.signal.ticker}]: ${result.error}`
        );

        // Feedback Loop: Forward failure screenshot & alert to Saved Messages ('me')
        try {
          const alertMessage =
            `🚨 [AUTOMATION TASK FAILED]\n` +
            `• Action: ${result.signal.action}\n` +
            `• Ticker: ${result.signal.ticker}\n` +
            `• Price: ${result.signal.price ?? 'N/A'}\n` +
            `• Duration: ${result.durationMs}ms\n` +
            `• Error: ${result.error ?? 'Unknown error'}\n` +
            `• Time: ${new Date().toISOString()}`;

          if (result.screenshotPath && fs.existsSync(result.screenshotPath)) {
            await client.sendFile('me', {
              file: result.screenshotPath,
              caption: alertMessage,
            });
            logger.telegram('Forwarded failure screenshot and alert to Saved Messages (me).');
          } else {
            await client.sendMessage('me', {
              message: alertMessage,
            });
            logger.telegram('Forwarded failure text alert to Saved Messages (me).');
          }
        } catch (notifyErr) {
          logger.error('Failed to send failure notification to Saved Messages', notifyErr);
        }
      }
    })
    .catch((queueErr) => {
      logger.error(`Critical error handling queued task [${task.id}]`, queueErr);
    });
}

/**
 * Handles incoming NewMessage and EditedMessage events from Telegram MTProto.
 */
async function handleNewMessage(event: NewMessageEvent): Promise<void> {
  const message = event.message;
  if (!message) return;

  const incomingPeerId = extractPeerChannelId(message.peerId || message);

  // STRICT FILTER: Drop immediately if channel ID does not match target VIP_CHANNEL_ID
  if (incomingPeerId === null || incomingPeerId !== config.vipChannelIdBigInt) {
    return;
  }

  processMessage(message);
}

/**
 * Actively polls the VIP channel every 3000ms to bypass Telegram push update limitations for large channels.
 */
function startActivePolling(): void {
  logger.info(`Starting ACTIVE polling (300ms) for VIP Channel [${config.vipChannelIdRaw}]...`);
  
  let isPolling = false;
  let isFirstPoll = true;
  let lastPolledChannelStr = config.vipChannelIdBigInt.toString();

  async function poll() {
    if (isShuttingDown || !client.connected) return;
    if (isPolling) return; // Prevent overlapping polls if network is slow
    
    isPolling = true;
    let nextDelay = 300;

    try {
      const currentChannelStr = config.vipChannelIdBigInt.toString();
      if (currentChannelStr !== lastPolledChannelStr) {
        logger.info(`Channel switch detected (${lastPolledChannelStr} -> ${currentChannelStr}). Resetting poll state to ignore history.`);
        isFirstPoll = true;
        lastPolledChannelStr = currentChannelStr;
      }

      const messages = await client.getMessages(config.vipChannelIdRaw, { limit: 15 });
      if (messages && messages.length > 0) {
        
        if (isFirstPoll) {
          isFirstPoll = false;
          if (messages[0]?.id !== undefined) {
            lastProcessedMessageIds.set(currentChannelStr, messages[0].id);
          }
          // Mark history as processed so we don't execute past signals
          for (const msg of messages) {
            if (msg.id !== undefined) {
              processedMessageIdSet.add(`${currentChannelStr}_${msg.id}`);
            }
          }
        } else {
          // Loop backwards: oldest first to newest, to preserve chronological signal processing
          for (let i = messages.length - 1; i >= 0; i--) {
            processMessage(messages[i]);
          }
        }
      }
    } catch (err: unknown) {
      const e = err as { errorMessage?: string; message?: string; seconds?: number };
      if (e?.errorMessage === 'FLOOD_WAIT' || e?.message?.includes('FLOOD')) {
        const waitTime = e.seconds || 5;
        logger.warn(`⚠️ Telegram rate limit (FloodWait) hit during polling. Backing off for ${waitTime} seconds...`);
        nextDelay = waitTime * 1000;
      }
      // Ignore minor network errors
    } finally {
      isPolling = false;
      setTimeout(poll, nextDelay);
    }
  }

  // Kick off the recursive poll
  pollTimerRef = setTimeout(poll, 0);
}

let pollTimerRef: NodeJS.Timeout | undefined;

/**
 * Graceful Teardown Lifecycle Handler
 */
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // 0. Stop polling timer
  if (pollTimerRef) clearTimeout(pollTimerRef);

  // 1. Pause incoming tasks and wait for active task to drain
  automationQueue.pause();
  logger.info('Waiting for pending tasks in queue to finish...');
  await automationQueue.onIdle();

  // 2. Stop keepAlive interval
  if (keepAliveIntervalRef) clearInterval(keepAliveIntervalRef);

  // 3. Clean up any active warm browser session
  await closeWarmBrowser();

  // 4. Disconnect GramJS Client
  try {
    logger.info('Disconnecting GramJS Telegram client...');
    await client.disconnect();
    logger.info('Telegram client disconnected.');
  } catch (err) {
    logger.error('Error while disconnecting Telegram client', err);
  }

  logger.info('Graceful shutdown completed successfully. Exiting.');
  process.exit(0);
}

let keepAliveIntervalRef: NodeJS.Timeout | undefined;

// Register OS termination signal handlers
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', reason);
});

/**
 * Main Application Entry Point
 */
async function bootstrap(): Promise<void> {
  logger.info('Starting Cortex Telegram Automation UserBot...');
  
  // Start the web dashboard
  startDashboardServer(3000);
  
  try {
    logger.info('Connecting to Telegram MTProto...');
    await client.connect();

    const me = await client.getMe();
    if (me && 'username' in me) {
      logger.info(`Authenticated successfully as @${me.username || me.id}`);
    } else {
      logger.info('Authenticated successfully with Telegram UserBot session.');
    }

    // Inspect and display target VIP channel details in terminal
    await inspectTargetChannel();


    // Register the core new message handler
    // GramJS NewMessage handles both new channel messages and edited posts
    client.addEventHandler(handleNewMessage, new NewMessage({}));
    logger.info(`Telegram NewMessage listener attached for VIP Channel [${config.vipChannelIdRaw}]. Listening for signals...`);

    // Start the active polling fallback
    startActivePolling();

    // Aggressive Active Ping (Keep-Alive & Zombie Connection Slayer)
    keepAliveIntervalRef = setInterval(async () => {
      if (isShuttingDown) return;
      
      let isActuallyConnected = false;
      try {
        if (client.connected) {
          // Force network traffic to keep NAT state alive and detect silent ISP drops
          await Promise.race([
            client.getMe(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('PING_TIMEOUT')), 5000))
          ]);
          isActuallyConnected = true;
        }
      } catch (err) {
        logger.warn(`⚠️ Telegram active ping failed (Zombie Connection Detected): ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!isActuallyConnected) {
        logger.warn('⚠️ Telegram client disconnected or unresponsive! Forcing reconnect...');
        try {
          // Force disconnect to clear zombie socket, then reconnect
          await client.disconnect();
          await client.connect();
          logger.info('✅ Active ping reconnect successful.');
        } catch (e) {
          logger.error('❌ Active ping reconnect failed.', e);
        }
      }
    }, 45000); // Send active ping every 45 seconds

    // Proactive Pre-warming: Pre-open and keep browser on standby so it is 100% ready
    if (config.autoLaunchChrome) {
      logger.browser('🚀 Initializing Cortex Chrome profile on startup (Always Ready Standby)...');
      executeAutomation({
        action: 'PREPARE',
        ticker: 'READY',
        rawText: 'STARTUP_AUTO_PREWARM',
        timestamp: new Date(),
      }).catch((err) => {
        logger.warn('Initial browser pre-warming encountered a notice', err?.message || err);
      });
    }
  } catch (error) {
    logger.error('Fatal error starting Telegram UserBot client', error);
    process.exit(1);
  }
}

// Boot application
bootstrap().catch((err) => {
  logger.error('Unhandled fatal error during bootstrap', err);
  process.exit(1);
});
