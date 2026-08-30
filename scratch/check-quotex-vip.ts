import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../src/config.js';
import { parseSignal } from '../src/parser.js';

async function checkQuotexVip() {
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, { connectionRetries: 3 });
  await client.connect();

  const dialogs = await client.getDialogs({ limit: 50 });
  const vipDialog = dialogs.find(d => (d.entity as any)?.id?.toString() === '1771915378');

  if (!vipDialog) {
    console.log('Could not find Quotex Trading Vip (1771915378)!');
    await client.disconnect();
    return;
  }

  console.log(`Found: ${vipDialog.title} (ID: 1771915378)`);
  const msgs = await client.getMessages(vipDialog.entity, { limit: 30 });
  console.log(`Fetched ${msgs.length} messages.\n`);

  for (const m of msgs.reverse()) {
    if (!m || !m.message) continue;
    console.log('================================================================');
    console.log(`Message #${m.id} | Date: ${new Date(m.date * 1000).toLocaleString()}`);
    console.log(`Raw Text:\n"${m.message}"`);
    const parsed = parseSignal(m.message);
    console.log(`Parsed Result:`, parsed);
  }

  await client.disconnect();
  process.exit(0);
}

checkQuotexVip().catch(e => {
  console.error(e);
  process.exit(1);
});
