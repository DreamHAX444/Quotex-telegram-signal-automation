import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import * as readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function prompt(query: string, defaultVal: string = ''): Promise<string> {
  const ans = await rl.question(query);
  return ans.trim() || defaultVal;
}

/**
 * Interactive Session String Generator for GramJS UserBot
 */
async function generateSession(): Promise<void> {
  console.log('====================================================');
  console.log('   Telegram UserBot Session String Generator        ');
  console.log('====================================================\n');

  let apiIdStr = process.env.API_ID?.trim();
  let apiHash = process.env.API_HASH?.trim();

  if (!apiIdStr) {
    const inputApiId = await prompt(`Enter API_ID [default: ${apiIdStr || ''}]: `, apiIdStr);
    if (inputApiId) apiIdStr = inputApiId;
  }

  if (!apiHash) {
    const inputApiHash = await prompt(`Enter API_HASH [default: ${apiHash || ''}]: `, apiHash);
    if (inputApiHash) apiHash = inputApiHash;
  }

  const apiId = Number.parseInt(apiIdStr!, 10);
  if (Number.isNaN(apiId) || !apiHash) {
    console.error('❌ Error: Both API_ID and API_HASH are required.');
    process.exit(1);
  }

  console.log('\nConnecting to Telegram...');
  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await prompt('📱 Enter your phone number (with country code, e.g. +1234567890): '),
    password: async () => await prompt('🔑 Enter your Telegram 2FA password (leave empty if none): '),
    phoneCode: async () => await prompt('💬 Enter the Telegram login code you just received: '),
    onError: (err) => console.error('Authentication error:', err),
  });

  console.log('\n✅ Successfully authenticated!');
  const savedSession = client.session.save() as unknown as string;

  console.log('\n====================================================');
  console.log('YOUR SESSION_STRING:');
  console.log('====================================================\n');
  console.log(savedSession);
  console.log('\n====================================================');

  const shouldSaveRaw = await prompt('Do you want to automatically save this to your .env file? (Y/n) ', 'y');
  const shouldSave = shouldSaveRaw.toLowerCase() === 'y';

  if (shouldSave) {
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('SESSION_STRING=')) {
        envContent = envContent.replace(/SESSION_STRING=.*/g, `SESSION_STRING=${savedSession}`);
      } else {
        envContent += `\nSESSION_STRING=${savedSession}\n`;
      }
    } else {
      envContent = `API_ID=${apiId}\nAPI_HASH=${apiHash}\nSESSION_STRING=${savedSession}\nVIP_CHANNEL_ID=\n`;
    }

    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`\n🎉 Saved SESSION_STRING to ${envPath}`);
  }

  await client.disconnect();
  rl.close();
  console.log('\nDone! You can now start the bot with: npm run dev');
  process.exit(0);
}

generateSession().catch((err) => {
  console.error('Fatal error during session generation:', err);
  process.exit(1);
});
