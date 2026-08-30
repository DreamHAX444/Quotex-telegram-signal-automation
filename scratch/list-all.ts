import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../src/config.js';

async function listAll() {
  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, { connectionRetries: 3 });
  await client.connect();
  console.log('Connected.');
  const dialogs = await client.getDialogs({ limit: 200 });
  console.log(`Total Dialogs: ${dialogs.length}`);
  
  const results = [];
  for (const d of dialogs) {
    const ent = d.entity as any;
    if (!ent) continue;
    const id = ent.id?.toString() || '';
    const botId = `-100${id}`;
    const type = ent.broadcast ? 'Broadcast Channel' : ent.megagroup ? 'Supergroup' : d.isGroup ? 'Group' : 'User';
    results.push({
      title: d.title || ent.title || (ent.firstName ? `${ent.firstName} ${ent.lastName || ''}` : 'Unknown'),
      id,
      botId,
      type,
      username: ent.username ? `@${ent.username}` : 'none',
      isTarget: id === '1771915378' || id.includes('1771915378') || botId === '-1001771915378'
    });
  }
  console.table(results);
  await client.disconnect();
  process.exit(0);
}

listAll().catch(e => {
  console.error(e);
  process.exit(1);
});
