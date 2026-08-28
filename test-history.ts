import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram/tl/index.js';
import dotenv from 'dotenv';
import { config } from './src/config.js';
import { parseSignal } from './src/parser.js';

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
  console.log('Connected. Fetching last 5 messages from VIP Channel:', config.vipChannelIdRaw);

  try {
    const history = await client.getMessages(config.vipChannelIdRaw, { limit: 5 });
    for (const msg of history) {
      console.log('--------------------------------------------------');
      console.log('Message ID:', msg.id);
      console.log('Message text:', msg.message?.slice(0, 50));
      
      const incomingPeerId = extractPeerChannelId(msg.peerId || msg);
      console.log('Extracted Peer ID:', incomingPeerId);
      console.log('Matches Config ID?', incomingPeerId === config.vipChannelIdBigInt);
      
      const signal = parseSignal(msg.message || '');
      console.log('Parsed Signal:', signal ? signal.action + ' ' + signal.ticker : 'NULL');
      
      if (incomingPeerId !== config.vipChannelIdBigInt) {
         console.log('Raw peerId object:', JSON.stringify(msg.peerId, (k,v) => typeof v === 'bigint' ? v.toString() : v));
      }
    }
  } catch (err) {
    console.error('Failed to fetch messages:', err);
  }

  await client.disconnect();
  process.exit(0);
}

start();
