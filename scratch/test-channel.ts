import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../src/config.js';

async function main() {
  console.log('Connecting to Telegram MTProto...');
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 3,
  });

  await client.connect();
  console.log('✅ Client connected successfully.');

  const dialogs = await client.getDialogs({ limit: 150 });
  console.log(`Fetched ${dialogs.length} dialogs.`);

  let found = false;
  for (const d of dialogs) {
    const ent = d.entity as any;
    if (!ent) continue;

    const idStr = ent.id?.toString() || '';
    if (idStr.includes('1771915378') || d.title?.toLowerCase().includes('vip')) {
      found = true;
      console.log('\n🎯 FOUND MATCHING TARGET DIALOG:');
      console.log({
        title: d.title || ent.title,
        id: idStr,
        className: ent.className,
        broadcast: ent.broadcast,
        megagroup: ent.megagroup,
        accessHash: ent.accessHash ? ent.accessHash.toString() : 'NONE'
      });

      console.log('\n📥 Pulling recent 10 messages from this channel...');
      const msgs = await client.getMessages(ent, { limit: 10 });
      console.log(`Received ${msgs.length} messages:`);
      for (const m of msgs) {
        console.log(`----------------------------------------`);
        console.log(`Message ID: ${m.id} | Date: ${new Date(m.date * 1000).toLocaleString()}`);
        console.log(`Text: ${m.message}`);
      }
    }
  }

  if (!found) {
    console.log('❌ Could not find channel with ID 1771915378 in the first 150 dialogs.');
    console.log('Listing all channels/groups found in dialogs:');
    for (const d of dialogs) {
      if (d.isChannel || d.isGroup) {
        console.log(`- [${(d.entity as any)?.id}] ${d.title} (username: ${(d.entity as any)?.username || 'none'})`);
      }
    }
  }

  await client.disconnect();
  console.log('\nDisconnected.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
