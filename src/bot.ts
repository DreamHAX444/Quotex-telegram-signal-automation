import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { EditedMessage } from 'telegram/events/EditedMessage.js';
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
import { systemStats } from './stats.js';
import { systemEvents, type ChannelMessageRecord } from './events.js';



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
  connectionRetries: 10,
  useWSS: false,
  autoReconnect: true,
});

let resolvedTargetEntity: any = null;
let isPullingActive = false;
let lastPullErrorLoggedAt = 0;
const PULL_ERROR_LOG_INTERVAL_MS = 30_000;

const processedMessageIds = new Set<number>();
const lastSeenTextByMsgId = new Map<number, string>();

/**
 * Extracts a normalized numerical string from any Telegram peer, ID, or message object.
 */
function extractPeerChannelIdString(peer: unknown): string | null {
  if (!peer) return null;
  if (typeof peer === 'string' || typeof peer === 'number' || typeof peer === 'bigint') {
    return peer.toString().replace(/^-100/, '').replace(/^-/, '');
  }
  if (typeof peer === 'object') {
    const p = peer as Record<string, unknown>;
    if (p.channelId !== undefined && p.channelId !== null) {
      return p.channelId.toString().replace(/^-100/, '').replace(/^-/, '');
    }
    if (p.chatId !== undefined && p.chatId !== null) {
      return p.chatId.toString().replace(/^-100/, '').replace(/^-/, '');
    }
    if (p.userId !== undefined && p.userId !== null) {
      return p.userId.toString().replace(/^-100/, '').replace(/^-/, '');
    }
    if (p.peerId) {
      return extractPeerChannelIdString(p.peerId);
    }
    if (p.toId) {
      return extractPeerChannelIdString(p.toId);
    }
    if (p.id !== undefined && p.id !== null) {
      return p.id.toString().replace(/^-100/, '').replace(/^-/, '');
    }
  }
  return null;
}

/**
 * Bulletproof check if an incoming message or update belongs to the configured VIP channel.
 */
function isFromTargetChannel(target: unknown): boolean {
  if (!target) return false;

  const targetStr = config.vipChannelIdBigInt.toString();
  const rawCleaned = config.vipChannelIdRaw.replace(/^-100/, '').replace(/^-/, '');

  if (resolvedTargetEntity && (resolvedTargetEntity as any).id) {
    const entityId = (resolvedTargetEntity as any).id.toString().replace(/^-100/, '').replace(/^-/, '');
    const extracted = extractPeerChannelIdString(target);
    if (extracted === entityId || extracted === targetStr || extracted === rawCleaned) {
      return true;
    }
  }

  const extracted = extractPeerChannelIdString(target);
  if (!extracted) return false;
  return extracted === targetStr || extracted === rawCleaned;
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
 * Common logic to parse and execute a message from the VIP channel
 */
function processMessage(message: any): void {
  if (!message || message.className === 'MessageService' || message.action || isShuttingDown) return;

  const rawText = message.message || message.text || '';
  if (!rawText.trim()) return;

  const messageTimestampMs = (message.editDate || message.date || 0) * 1000;
  if (messageTimestampMs > 0 && Date.now() - messageTimestampMs > config.maxMessageAgeMs) {
    logger.debug(`Skipping stale Telegram message #${message.id || 'unknown'} (${Date.now() - messageTimestampMs}ms old).`);
    return;
  }

  const msgId = message.id;
  if (msgId !== undefined) {
    const prevText = lastSeenTextByMsgId.get(msgId);
    if (processedMessageIds.has(msgId) && prevText === rawText) {
      return; // Exact duplicate already processed
    }

    processedMessageIds.add(msgId);
    lastSeenTextByMsgId.set(msgId, rawText);

    // Amortized eviction when sets grow large
    if (processedMessageIds.size > 3000) {
      const iter = processedMessageIds.values();
      for (let i = 0; i < 500; i++) {
        const entry = iter.next();
        if (entry.done) break;
        processedMessageIds.delete(entry.value);
        lastSeenTextByMsgId.delete(entry.value);
      }
    }
  }

  const senderName = message.postAuthor || (message.sender ? (message.sender as any).firstName : 'Channel Admin') || 'VIP Channel';

  // Parse and validate signal deterministically
  const signal = parseSignal(rawText);

  // Record into the live channel message feed
  systemEvents.recordChannelMessage({
    id: 'msg-' + (message.id || randomUUID()),
    messageId: message.id || 0,
    channelId: config.vipChannelIdRaw,
    date: new Date(message.date ? message.date * 1000 : Date.now()).toISOString(),
    senderName,
    text: rawText,
    isSignal: !!signal,
    signal: signal || undefined,
  });

  // Display rich message and signal details in terminal
  printIncomingMessage({
    messageId: message.id || 0,
    date: new Date(message.date ? message.date * 1000 : Date.now()),
    senderName,
    text: rawText,
    parsedSignal: signal,
  });

  if (!signal) {
    return;
  }

  const task: AutomationTask = {
    id: randomUUID(),
    signal,
    receivedAt: new Date(),
  };

  // Broadcast signal event to Web Dashboard in real-time
  systemEvents.emit('signal:received', {
    taskId: task.id,
    signal,
    senderName,
    messageId: message.id,
    timestamp: new Date().toISOString(),
  });

  // Enqueue task for sequential Playwright automation
  automationQueue
    .enqueue(task, executeAutomation)
    .then(async (result) => {
      systemEvents.recordExecution({
        id: task.id,
        timestamp: new Date().toISOString(),
        signal: task.signal,
        durationMs: result.durationMs,
        success: result.success,
        error: result.error,
        screenshotPath: result.screenshotPath,
        balance: result.balance,
      });

      if (result.success) {
        logger.info(
          `Task [${task.id}] succeeded for [${result.signal.action} ${result.signal.ticker}] in ${result.durationMs}ms`
        );
      } else {
        logger.error(
          `Task [${task.id}] failed for [${result.signal.action} ${result.signal.ticker}]: ${result.error}`
        );

        // Forward failure screenshot & alert to Saved Messages ('me')
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
function handleNewMessage(event: NewMessageEvent): void {
  try {
    const message = event.message;
    if (!message || !isFromTargetChannel(message.peerId || message)) {
      systemStats.messagesIgnored++;
      return;
    }

    systemStats.lastMessageAt = Date.now();
    systemStats.messagesProcessed++;
    processMessage(message);
  } catch (err) {
    logger.error('Telegram event handler failed safely', err);
  } finally {
    systemEvents.emit('telemetry:update', systemStats);
  }
}

/**
 * Discovers and binds the target VIP channel entity from MTProto dialogs cache.
 */
async function resolveTargetChannel(): Promise<void> {
  logger.telegram(`Resolving entity and permissions for VIP Channel [ID: ${config.vipChannelIdRaw}]...`);

  try {
    // 1. Fetch user dialogs to load all entity access_hashes into GramJS session cache
    const dialogs = await client.getDialogs({ limit: 150 });
    
    // 2. Find matching dialog entity
    const targetDialog = dialogs.find((d) => {
      const entity = d.entity as any;
      if (!entity) return false;
      return isFromTargetChannel(entity) || isFromTargetChannel(d.message?.peerId || (d.dialog as any)?.peer);
    });

    if (targetDialog && targetDialog.entity) {
      resolvedTargetEntity = targetDialog.entity;
      const entity = targetDialog.entity as any;
      const title = entity.title || targetDialog.title || 'VIP Channel';
      const type = entity.broadcast ? 'Broadcast Channel (VIP)' : entity.megagroup ? 'Supergroup' : 'Chat';
      
      systemStats.channelTitle = title;
      systemStats.channelType = type;
      systemStats.channelMembers = entity.participantsCount;

      printChannelDetails({
        title,
        id: config.vipChannelIdRaw,
        bigIntId: config.vipChannelIdBigInt.toString(),
        username: entity.username,
        type,
        participantsCount: entity.participantsCount,
      });

      systemEvents.recordConnectionLog({
        id: 'res-' + Date.now(),
        timestamp: new Date().toISOString(),
        type: 'RESOLVE',
        message: `Bound Target VIP Channel: ${title} (${config.vipChannelIdRaw})`,
        details: `${type} • ${entity.participantsCount?.toLocaleString() || 'N/A'} members`,
      });
    } else {
      // Direct entity lookup fallback
      try {
        const channelPeer = new Api.PeerChannel({ channelId: config.vipChannelIdBigInt as any });
        const entity = await client.getEntity(channelPeer);
        if (entity) {
          resolvedTargetEntity = entity;
          const title = (entity as any).title || 'VIP Channel';
          const type = (entity as any).broadcast ? 'Broadcast Channel' : 'Group / Channel';

          systemStats.channelTitle = title;
          systemStats.channelType = type;
          systemStats.channelMembers = (entity as any).participantsCount;

          printChannelDetails({
            title,
            id: config.vipChannelIdRaw,
            bigIntId: config.vipChannelIdBigInt.toString(),
            username: (entity as any).username,
            type,
            participantsCount: (entity as any).participantsCount,
          });

          systemEvents.recordConnectionLog({
            id: 'res-' + Date.now(),
            timestamp: new Date().toISOString(),
            type: 'RESOLVE',
            message: `Bound Target VIP Channel via direct entity: ${title}`,
          });
        }
      } catch {
        logger.warn(`Could not resolve direct PeerChannel for ${config.vipChannelIdRaw}. Checking by raw ID.`);
        resolvedTargetEntity = null;
        printChannelDetails({
          title: 'Target Channel (Raw Filter)',
          id: config.vipChannelIdRaw,
          bigIntId: config.vipChannelIdBigInt.toString(),
          type: 'Private Channel / Supergroup',
        });
      }
    }

    // 3. Prime message cache so history is displayed but never retroactively executed
    if (resolvedTargetEntity) {
      try {
        const recentMessages = await client.getMessages(resolvedTargetEntity, { limit: 25 });
        for (const msg of recentMessages) {
          if (msg && msg.id) {
            processedMessageIds.add(msg.id);
            if (msg.message) lastSeenTextByMsgId.set(msg.id, msg.message);

            // Populate the recent channel messages feed
            if (msg.message) {
              const rawText = msg.message;
              const senderName = msg.postAuthor || (msg.sender ? (msg.sender as any).firstName : 'Channel Admin') || 'VIP Channel';
              const signal = parseSignal(rawText);
              systemEvents.recordChannelMessage({
                id: 'msg-' + msg.id,
                messageId: msg.id,
                channelId: config.vipChannelIdRaw,
                date: new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString(),
                senderName,
                text: rawText,
                isSignal: !!signal,
                signal: signal || undefined,
              });
            }
          }
        }
        logger.telegram(`Primed message history cache (${recentMessages.length} messages loaded).`);
      } catch (historyErr) {
        logger.debug('Could not pre-fetch recent messages from entity', historyErr);
      }
    }
  } catch (err) {
    logger.warn('Error while inspecting target channel dialogs', err);
  }
}

let pullBackoffUntil = 0;

/**
 * High-Frequency Active Channel Puller / Sync Loop (Layer 2 Puller)
 * Actively pulls latest messages from target channel to guarantee delivery.
 */
async function pullLatestChannelMessages(): Promise<void> {
  if (isPullingActive || !client.connected) return;
  if (Date.now() < pullBackoffUntil) return; // Respect rate limit backoff
  isPullingActive = true;

  try {
    const target = resolvedTargetEntity || new Api.PeerChannel({ channelId: config.vipChannelIdBigInt as any });
    const messages = await client.getMessages(target, { limit: 5 });

    systemStats.lastCheckedAt = Date.now();
    systemEvents.emit('telemetry:update', systemStats);

    if (Array.isArray(messages) && messages.length > 0) {
      for (const msg of [...messages].reverse()) {
        if (!msg || !msg.id || !msg.message) continue;
        if (!isFromTargetChannel(msg.peerId || msg)) continue;

        const isNew = !processedMessageIds.has(msg.id);
        const prevText = lastSeenTextByMsgId.get(msg.id);
        const isEdited = prevText !== undefined && prevText !== msg.message;

        if (isNew || isEdited) {
          systemStats.lastMessageAt = Date.now();
          systemStats.messagesProcessed++;
          systemEvents.emit('telemetry:update', systemStats);
          processMessage(msg);
        }
      }
    }
  } catch (err: any) {
    const errorMsg = err?.errorMessage || err?.message || String(err);
    if (errorMsg.includes('FLOOD_WAIT')) {
      const match = errorMsg.match(/\d+/);
      const seconds = match ? parseInt(match[0], 10) : 30;
      pullBackoffUntil = Date.now() + (seconds * 1000);
      logger.warn(`Telegram rate limit (FLOOD_WAIT) on active puller. Backing off for ${seconds} seconds.`);

      systemEvents.recordConnectionLog({
        id: 'flood-' + Date.now(),
        timestamp: new Date().toISOString(),
        type: 'ERROR',
        message: `Active puller rate limited. Pausing puller for ${seconds}s.`,
      });
    } else if (Date.now() - lastPullErrorLoggedAt >= PULL_ERROR_LOG_INTERVAL_MS) {
      lastPullErrorLoggedAt = Date.now();
      logger.warn(`Telegram fallback pull failed: ${errorMsg}`);
    }
  } finally {
    isPullingActive = false;
  }
}

/**
 * On-demand helper to fetch the latest channel messages
 */
export async function forceFetchChannelMessages(limit = 30): Promise<ChannelMessageRecord[]> {
  if (!client.connected) {
    throw new Error('Telegram Client is not connected');
  }

  try {
    const target = resolvedTargetEntity || new Api.PeerChannel({ channelId: config.vipChannelIdBigInt as any });
    const messages = await client.getMessages(target, { limit });
    const records: ChannelMessageRecord[] = [];

    for (const msg of messages) {
      if (!msg || !msg.message) continue;
      const senderName = msg.postAuthor || (msg.sender ? (msg.sender as any).firstName : 'Channel Admin') || 'VIP Channel';
      const rawText = msg.message || '';
      const signal = parseSignal(rawText);
      const rec: ChannelMessageRecord = {
        id: 'msg-' + msg.id,
        messageId: msg.id,
        channelId: config.vipChannelIdRaw,
        date: new Date(msg.date ? msg.date * 1000 : Date.now()).toISOString(),
        senderName,
        text: rawText,
        isSignal: !!signal,
        signal: signal || undefined,
      };
      records.push(rec);
      systemEvents.recordChannelMessage(rec);
    }
    return records;
  } catch (err: any) {
    const errorMsg = err?.errorMessage || err?.message || String(err);
    if (errorMsg.includes('FLOOD_WAIT')) {
      const match = errorMsg.match(/\d+/);
      const seconds = match ? parseInt(match[0], 10) : 30;
      pullBackoffUntil = Math.max(pullBackoffUntil, Date.now() + (seconds * 1000));
      logger.warn(`Manual pull rate limited. Backing off for ${seconds} seconds.`);
      throw new Error(`Telegram rate limit exceeded. Please wait ${seconds} seconds before trying again.`);
    }
    throw err;
  }
}

/**
 * Manual ping trigger to test active MTProto socket latency
 */
export async function pingTelegramConnection(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    if (!client.connected) {
      throw new Error('Client socket not connected');
    }
    await client.getMe();
    const latencyMs = Date.now() - start;
    systemStats.lastPingAt = Date.now();
    systemEvents.recordConnectionLog({
      id: 'ping-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'PING',
      message: `Manual socket ping OK`,
      latencyMs,
    });
    systemEvents.emit('telemetry:update', systemStats);
    return { success: true, latencyMs };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    systemEvents.recordConnectionLog({
      id: 'ping-err-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'ERROR',
      message: `Manual ping failed: ${errorMsg}`,
    });
    return { success: false, latencyMs: Date.now() - start, error: errorMsg };
  }
}

let reconnectPromise: Promise<boolean> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithTimeout(timeoutMs = 15000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Telegram connection timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Reconnects once for all concurrent callers, with bounded exponential backoff. */
export function reconnectTelegramClient(): Promise<boolean> {
  if (reconnectPromise) return reconnectPromise;

  reconnectPromise = (async () => {
    systemStats.status = 'Reconnecting...';
    systemEvents.emit('telemetry:update', systemStats);

    for (let attempt = 1; attempt <= 5 && !isShuttingDown; attempt++) {
      try {
        systemEvents.recordConnectionLog({
          id: `recon-${Date.now()}-${attempt}`,
          timestamp: new Date().toISOString(),
          type: 'RECONNECT',
          message: `Telegram reconnect attempt ${attempt}/5...`,
        });
        await client.disconnect().catch(() => undefined);
        await connectWithTimeout();
        await resolveTargetChannel();
        systemStats.status = 'Connected';
        systemEvents.recordConnectionLog({
          id: 'recon-ok-' + Date.now(),
          timestamp: new Date().toISOString(),
          type: 'CONNECT',
          message: 'Telegram MTProto reconnected and target channel rebound.',
        });
        systemEvents.emit('telemetry:update', systemStats);
        return true;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`Telegram reconnect attempt ${attempt}/5 failed: ${errorMsg}`);
        if (attempt < 5) {
          const backoffMs = Math.min(1000 * (2 ** (attempt - 1)), 15000) + Math.floor(Math.random() * 500);
          await delay(backoffMs);
        }
      }
    }

    systemStats.status = 'Error';
    systemEvents.recordConnectionLog({
      id: 'recon-fail-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'ERROR',
      message: 'Telegram reconnect failed after 5 attempts.',
    });
    systemEvents.emit('telemetry:update', systemStats);
    return false;
  })().finally(() => {
    reconnectPromise = null;
  });

  return reconnectPromise;
}

/**
 * Graceful Teardown Lifecycle Handler
 */
let isShuttingDown = false;
let keepAliveIntervalRef: NodeJS.Timeout | undefined;
let pullIntervalRef: NodeJS.Timeout | undefined;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // 1. Stop intake, cancel waiting work, and let only the active task finish.
  automationQueue.pause();
  automationQueue.clear();
  logger.info('Waiting for the active automation task to finish...');
  await automationQueue.onIdle();

  // 2. Clear timers
  if (keepAliveIntervalRef) clearInterval(keepAliveIntervalRef);
  if (pullIntervalRef) clearInterval(pullIntervalRef);

  // 3. Clean up any active warm browser session
  await closeWarmBrowser();

  // 4. Disconnect GramJS Client
  try {
    logger.info('Disconnecting GramJS Telegram client...');
    await client.disconnect();
    systemEvents.recordConnectionLog({
      id: 'disc-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'DISCONNECT',
      message: 'Telegram Client disconnected cleanly during graceful shutdown.',
    });
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
    systemStats.status = 'Connecting...';
    systemEvents.recordConnectionLog({
      id: 'conn-start-' + Date.now(),
      timestamp: new Date().toISOString(),
      type: 'CONNECT',
      message: 'Connecting to Telegram MTProto Gateway...',
    });

    await connectWithTimeout();
    systemStats.status = 'Connected';

    const me = await client.getMe();
    if (me && 'username' in me) {
      systemStats.accountUsername = me.username ? `@${me.username}` : undefined;
      systemStats.accountId = me.id?.toString();
      logger.info(`Authenticated successfully as @${me.username || me.id}`);
      systemEvents.recordConnectionLog({
        id: 'auth-ok-' + Date.now(),
        timestamp: new Date().toISOString(),
        type: 'CONNECT',
        message: `Authenticated successfully as @${me.username || me.id}`,
        details: `Account ID: ${me.id}`,
      });
    } else {
      logger.info('Authenticated successfully with Telegram UserBot session.');
    }

    // Inspect and display target VIP channel details
    await resolveTargetChannel();

    // Attach real-time event listeners
    client.addEventHandler(handleNewMessage, new NewMessage({}));
    client.addEventHandler(handleNewMessage, new EditedMessage({}));
    logger.info(`Telegram listeners attached for VIP Channel [${config.vipChannelIdRaw}]. New and edited signals are handled instantly.`);

    // Listen for live channel switches from dashboard
    systemEvents.on('channel:switch', async () => {
      logger.telegram(`Channel switch detected from Dashboard. Re-resolving VIP Channel [${config.vipChannelIdRaw}]...`);
      processedMessageIds.clear();
      lastSeenTextByMsgId.clear();
      systemEvents.clearChannelMessages();
      await resolveTargetChannel();
    });

    // Layer 2 fallback puller catches rare MTProto update gaps; push events remain the instant primary path.
    pullIntervalRef = setInterval(() => {
      void pullLatestChannelMessages();
    }, config.telegramPollIntervalMs);

    // Aggressive Active Ping (Keep-Alive & Zombie Connection Slayer)
    keepAliveIntervalRef = setInterval(async () => {
      if (isShuttingDown) return;
      
      let isActuallyConnected = false;
      const startPing = Date.now();
      try {
        if (client.connected) {
          await Promise.race([
            client.getMe(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('PING_TIMEOUT')), 5000))
          ]);
          isActuallyConnected = true;
          systemStats.lastPingAt = Date.now();
          systemEvents.emit('telemetry:update', systemStats);
          systemEvents.recordConnectionLog({
            id: 'ping-' + Date.now(),
            timestamp: new Date().toISOString(),
            type: 'PING',
            message: 'Periodic keepalive ping OK',
            latencyMs: Date.now() - startPing,
          });
        }
      } catch (err) {
        logger.warn(`⚠️ Telegram active ping failed: ${err instanceof Error ? err.message : String(err)}`);
        systemEvents.recordConnectionLog({
          id: 'ping-err-' + Date.now(),
          timestamp: new Date().toISOString(),
          type: 'ERROR',
          message: `Active ping failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (!isActuallyConnected) {
        logger.warn('Telegram client disconnected or unresponsive. Starting coordinated reconnect...');
        const reconnected = await reconnectTelegramClient();
        if (!reconnected) logger.error('Telegram auto-reconnect exhausted all retries.');
      }
    }, config.telegramKeepAliveIntervalMs);

    // Pre-warm Chrome profile on startup
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
