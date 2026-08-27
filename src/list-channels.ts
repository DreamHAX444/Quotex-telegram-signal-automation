import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import dotenv from 'dotenv';
import { config } from './config.js';

dotenv.config();

/**
 * CLI Tool to list all Telegram dialogs, channels, and supergroups
 * with their titles and numerical IDs.
 */
async function listChannels(): Promise<void> {
  console.log('\n===============================================================');
  console.log('   Telegram Account Channel & Group Explorer                   ');
  console.log('===============================================================\n');

  if (!config.sessionString || config.sessionString === 'YOUR_GENERATED_SESSION_STRING') {
    console.log('❌ Error: SESSION_STRING is not configured in .env.');
    console.log('👉 Please run "npm run generate-session" first to authenticate your Telegram account.\n');
    process.exit(1);
  }

  const session = new StringSession(config.sessionString);
  const client = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
  });

  try {
    console.log('Connecting to Telegram...');
    await client.connect();

    console.log('Fetching joined channels and groups...\n');
    const dialogs = await client.getDialogs({ limit: 100 });

    const channelRows: Array<{
      type: string;
      title: string;
      username: string;
      rawId: string;
      botApiId: string;
    }> = [];

    for (const d of dialogs) {
      if (d.isChannel || d.isGroup) {
        const entity = d.entity as any;
        let rawId = '';
        let botApiId = '';

        if (entity?.id) {
          rawId = entity.id.toString();
          botApiId = `-100${rawId}`;
        }

        const type = entity?.broadcast ? '📢 Channel' : entity?.megagroup ? '👥 Supergroup' : '💬 Group';
        const title = d.title || entity?.title || 'Untitled';
        const username = entity?.username ? `@${entity.username}` : '(Private)';

        channelRows.push({
          type,
          title: title.slice(0, 30),
          username: username.slice(0, 18),
          rawId,
          botApiId,
        });
      }
    }

    if (channelRows.length === 0) {
      console.log('No channels or groups found in your account.');
    } else {
      console.table(channelRows);
      console.log('\n💡 Tip: Copy either the "rawId" or "botApiId" and paste into .env as VIP_CHANNEL_ID:');
      console.log('   VIP_CHANNEL_ID=' + (channelRows[0]?.botApiId || '1234567890'));
    }

    await client.disconnect();
    console.log('\nDone.');
  } catch (err) {
    console.error('Failed to list channels:', err);
    process.exit(1);
  }
}

listChannels().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
