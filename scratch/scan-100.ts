import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../src/config.js';

async function scanSignals() {
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, { connectionRetries: 3 });
  await client.connect();

  const dialogs = await client.getDialogs({ limit: 50 });
  const vipDialog = dialogs.find(d => (d.entity as any)?.id?.toString() === '1771915378');

  if (!vipDialog) {
    console.log('Channel not found');
    await client.disconnect();
    return;
  }

  const msgs = await client.getMessages(vipDialog.entity, { limit: 100 });
  console.log(`Fetched ${msgs.length} messages from ${vipDialog.title}:`);
  
  for (const m of msgs.reverse()) {
    if (!m || !m.message) continue;
    const text = m.message.trim().replace(/\n/g, ' \\n ');
    console.log(`[#${m.id}] ${new Date(m.date * 1000).toISOString().slice(11, 19)}: "${text}"`);
  }

  await client.disconnect();
  process.exit(0);
}

scanSignals().catch(console.error);
