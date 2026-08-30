import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram/tl/index.js';
import dotenv from 'dotenv';
import { config } from './src/config.js';
import fs from 'fs';

dotenv.config();

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

async function start() {
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  console.log('Connected! Listening to ALL messages for 30 seconds...');

  client.addEventHandler((event: NewMessageEvent) => {
    const message = event.message;
    if (!message) return;
    const peerIdObj = message.peerId || message;
    const extracted = extractPeerChannelId(peerIdObj);
    const logStr = `\n--- NEW MESSAGE ---\nExtracted ID: ${extracted}\nTarget VIP ID: ${config.vipChannelIdBigInt}\nPeerId Object: ${JSON.stringify(peerIdObj, (k,v) => typeof v === 'bigint' ? v.toString() : v)}\nMessage text: ${message.message}\n`;
    console.log(logStr);
    fs.promises.appendFile('test_log.txt', logStr).catch(console.error);
  }, new NewMessage({}));

  setTimeout(() => {
    client.disconnect();
    console.log('Done test.');
    process.exit(0);
  }, 30000);
}

start();
