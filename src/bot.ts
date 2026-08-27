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
function extractPeerChannelId(target: any): bigint | null {
  if (!target) return null;

  if (target instanceof Api.PeerChannel && target.channelId !== undefined) {
    return BigInt(target.channelId.toString());
  }

  if (target instanceof Api.PeerChat && target.chatId !== undefined) {
    const cleaned = target.chatId.toString().replace(/^-100/, '').replace(/^-/, '');
    return BigInt(cleaned);
  }

  if (target.channelId !== undefined) {
    return BigInt(target.channelId.toString());
  }

  if (target.peerId) {
    return extractPeerChannelId(target.peerId);
  }

  if (target.chatId !== undefined) {
    const cleaned = target.chatId.toString().replace(/^-100/, '').replace(/^-/, '');
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
  username?: string;
  type: string;
  participantsCount?: number;
}): void {
  const line = '─'.repeat(62);
  console.log(`\n┌${line}┐`);
  console.log(`│${'VIP CHANNEL DETAILS'.padStart(40).padEnd(62)}│`);
  console.log(`├${line}┤`);
  console.log(`│  Title:        ${info.title.slice(0, 44).padEnd(46)}│`);
  console.log(`│  Config ID:    ${info.id.slice(0, 44).padEnd(46)}│`);
  console.log(`│  BigInt ID:    ${info.bigIntId.slice(0, 44).padEnd(46)}│`);
  console.log(
    `│  Username:     ${(info.username ? '@' + info.username : 'Private (No Username)').slice(0, 44).padEnd(46)}│`
  );
  console.log(`│  Type:         ${info.type.slice(0, 44).padEnd(46)}│`);
  const standbyText = config.standbyTimeoutMs === Number.POSITIVE_INFINITY ? 'Infinity (Always Warm / No Timeout)' : `${config.standbyTimeoutMs}ms`;
  console.log(`│  Standby Mode: ${standbyText.slice(0, 44).padEnd(46)}│`);
  if (info.participantsCount !== undefined) {
    console.log(
      `│  Members:      ${info.participantsCount.toLocaleString().slice(0, 44).padEnd(46)}│`
    );
  }
  console.log(`└${line}┘\n`);
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
  const line = '═'.repeat(62);
  const thinLine = '─'.repeat(62);
  console.log(`\n╔${line}╗`);
  console.log(`║${'NEW VIP CHANNEL MESSAGE'.padStart(42).padEnd(62)}║`);
  console.log(`╠${line}╣`);
  console.log(`║ Message ID:   #${msgDetails.messageId.toString().padEnd(46)}║`);
  console.log(`║ Date / Time:  ${msgDetails.date.toLocaleString().padEnd(46)}║`);
  console.log(`║ Sender:       ${msgDetails.senderName.slice(0, 44).padEnd(46)}║`);
  console.log(`╟${thinLine}╢`);
  console.log(`║ Raw Message Content:                                         ║`);
  const lines = msgDetails.text.split('\n');
  for (const l of lines) {
    const truncated = l.length > 56 ? l.slice(0, 53) + '...' : l;
    console.log(`║   ${truncated.padEnd(58)} ║`);
  }
  console.log(`╟${thinLine}╢`);
  if (msgDetails.parsedSignal) {
    if (msgDetails.parsedSignal.action === 'BALANCE') {
      console.log(
        `║ Status:       💰 ACCOUNT BALANCE CHECK TRIGGER               ║`
      );
    } else if (msgDetails.parsedSignal.action === 'PREPARE') {
      console.log(
        `║ Status:       ⚡ PRE-WARM / STANDBY: ${msgDetails.parsedSignal.ticker.padEnd(31)}║`
      );
    } else if (msgDetails.parsedSignal.action === 'UP' || msgDetails.parsedSignal.action === 'CALL' || msgDetails.parsedSignal.action === 'BUY') {
      console.log(
        `║ Status:       🟢 VALID UP SIGNAL: ${msgDetails.parsedSignal.ticker.padEnd(34)}║`
      );
    } else if (msgDetails.parsedSignal.action === 'DOWN' || msgDetails.parsedSignal.action === 'PUT' || msgDetails.parsedSignal.action === 'SELL') {
      console.log(
        `║ Status:       🔴 VALID DOWN SIGNAL: ${msgDetails.parsedSignal.ticker.padEnd(32)}║`
      );
    } else {
      console.log(
        `║ Status:       ✅ VALID ${msgDetails.parsedSignal.action} SIGNAL: ${msgDetails.parsedSignal.ticker.padEnd(28)}║`
      );
    }
    if (msgDetails.parsedSignal.price !== undefined) {
      console.log(
        `║ Entry Price:  ${msgDetails.parsedSignal.price.toString().padEnd(46)}║`
      );
    }
    if (msgDetails.parsedSignal.takeProfit !== undefined) {
      console.log(
        `║ Take Profit:  ${msgDetails.parsedSignal.takeProfit.toString().padEnd(46)}║`
      );
    }
    if (msgDetails.parsedSignal.stopLoss !== undefined) {
      console.log(
        `║ Stop Loss:    ${msgDetails.parsedSignal.stopLoss.toString().padEnd(46)}║`
      );
    }
  } else {
    console.log(`║ Status:       ⚠️  UNRECOGNIZED FORMAT / DROPPED               ║`);
  }
  console.log(`╚${line}╝\n`);
}

/**
 * Attempts to inspect and fetch details of the configured VIP channel.
 */
async function inspectTargetChannel(): Promise<void> {
  logger.telegram(`Fetching details for VIP Channel [ID: ${config.vipChannelIdRaw}]...`);

  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    const targetDialog = dialogs.find((d) => {
      const entity = d.entity as any;
      if (entity?.id && BigInt(entity.id.toString()) === config.vipChannelIdBigInt) {
        return true;
      }
      const peerId = extractPeerChannelId(d.message?.peerId || (d.dialog as any)?.peer);
      return peerId !== null && peerId === config.vipChannelIdBigInt;
    });

    if (targetDialog && targetDialog.entity) {
      const entity = targetDialog.entity as any;
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
      const entity = (await client.getEntity(channelPeer)) as any;
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

/**
 * Reads and displays the last N messages from the target VIP channel on startup
 * for verification and visibility. NO automated trades are triggered for these history messages.
 */
async function printRecentChannelMessages(count = 3): Promise<void> {
  logger.telegram(`Reading last ${count} messages from VIP Channel to verify connection...`);

  try {
    const channelPeer = new Api.PeerChannel({ channelId: config.vipChannelIdBigInt as any });
    const messages = await client.getMessages(channelPeer, { limit: count });

    if (messages.length === 0) {
      logger.telegram(`No prior messages found in channel [ID: ${config.vipChannelIdRaw}].`);
      return;
    }

    const line = '─'.repeat(62);
    console.log(`\n┌${line}┐`);
    console.log(`│${`RECENT CHANNEL HISTORY (LAST ${messages.length} MESSAGES - INFO ONLY)`.padStart(54).padEnd(62)}│`);
    console.log(`├${line}┤`);

    // Reverse so oldest of the 3 appears first, down to the most recent
    const chronological = [...messages].reverse();

    for (let i = 0; i < chronological.length; i++) {
      const msg = chronological[i];
      if (!msg) continue;
      const dateStr = new Date(msg.date ? msg.date * 1000 : Date.now()).toLocaleString();
      const rawText = msg.message || '(Media / No text)';
      const parsed = parseSignal(rawText);

      let statusTag = '💬 Chat / Info (No Action)';
      if (parsed) {
        statusTag = `⚡ ${parsed.action} [${parsed.ticker}]`;
      }

      console.log(`│ #${i + 1} [ID: ${msg.id}] [${dateStr}]`.padEnd(63) + '│');
      console.log(`│    Type:   ${statusTag.padEnd(51)}│`);
      
      const textLines = rawText.split('\n');
      for (const tl of textLines) {
        const truncated = tl.length > 50 ? tl.slice(0, 47) + '...' : tl;
        console.log(`│    Text:   "${truncated}"`.padEnd(63) + '│');
      }
      if (i < chronological.length - 1) {
        console.log(`├${'┈'.repeat(62)}┤`);
      }
    }

    console.log(`└${line}┘\n`);
    logger.telegram(`✅ Verified message stream from VIP Channel [ID: ${config.vipChannelIdRaw}]. Ready for new messages.`);
  } catch (err) {
    logger.warn('Could not fetch recent channel messages on startup', err);
  }
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
 * Graceful Teardown Lifecycle Handler
 */
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // 1. Pause incoming tasks and wait for active task to drain
  automationQueue.pause();
  logger.info('Waiting for pending tasks in queue to finish...');
  await automationQueue.onIdle();

  // 2. Clean up any active warm browser session
  await closeWarmBrowser();

  // 3. Disconnect GramJS Client
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

// Register OS termination signal handlers
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception thrown', err);
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

    // Read and display the last 3 messages from the channel for user confidence (no trades executed)
    await printRecentChannelMessages(3);

    // Attach event handler (GramJS NewMessage handles both new channel messages and edited posts)
    client.addEventHandler(handleNewMessage, new NewMessage({}));
    logger.info(`Telegram NewMessage listener attached for VIP Channel [${config.vipChannelIdRaw}]. Listening for signals...`);

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
void bootstrap();
