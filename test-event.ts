import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { Api } from 'telegram/tl/index.js';
import dotenv from 'dotenv';
import { config } from './src/config.js';
import fs from 'fs';

dotenv.config();

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

async function start() {
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  console.log('Connected! Listening to ALL messages for 30 seconds...');

  client.addEventHandler((event: any) => {
    const message = event.message;
    if (!message) return;
    const peerIdObj = message.peerId || message;
    const extracted = extractPeerChannelId(peerIdObj);
    const logStr = `\n--- NEW MESSAGE ---\nExtracted ID: ${extracted}\nTarget VIP ID: ${config.vipChannelIdBigInt}\nPeerId Object: ${JSON.stringify(peerIdObj, (k,v) => typeof v === 'bigint' ? v.toString() : v)}\nMessage text: ${message.message}\n`;
    console.log(logStr);
    fs.appendFileSync('test_log.txt', logStr);
  }, new NewMessage({}));

  setTimeout(() => {
    client.disconnect();
    console.log('Done test.');
    process.exit(0);
  }, 30000);
}

start();
