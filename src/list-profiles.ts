import fs from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import { config } from './config.js';

interface ChromeProfileInfo {
  folderName: string;
  displayName: string;
  email: string;
  isCurrent: boolean;
}

/**
 * Scans Chrome's Local State file and returns all available profiles.
 */
function getAvailableChromeProfiles(userDataDir: string): ChromeProfileInfo[] {
  const localStatePath = path.join(userDataDir, 'Local State');
  const currentConfigProfile = process.env.CHROME_PROFILE_NAME?.trim() || 'Profile 1';

  if (!fs.existsSync(localStatePath)) {
    // If Local State is not found, fallback to scanning directory folders
    const entries = fs.readdirSync(userDataDir, { withFileTypes: true });
    return entries
      .filter((e) => {
        if (!e.isDirectory()) return false;
        const profilePath = path.join(userDataDir, e.name);
        return fs.existsSync(path.join(profilePath, 'Preferences')) || fs.existsSync(path.join(profilePath, 'Secure Preferences'));
      })
      .map((e) => ({
        folderName: e.name,
        displayName: e.name,
        email: '(Local Profile)',
        isCurrent: e.name === currentConfigProfile,
      }));
  }

  try {
    const rawContent = fs.readFileSync(localStatePath, 'utf8');
    const parsed = JSON.parse(rawContent);
    const infoCache = parsed?.profile?.info_cache || {};

    const profiles: ChromeProfileInfo[] = [];

    for (const [folderName, info] of Object.entries(infoCache)) {
      const data = info as { name?: string; user_name?: string; hosted_domain?: string };
      const displayName = data.name || folderName;
      const email = data.user_name || data.hosted_domain || '(No Email Linked)';
      profiles.push({
        folderName,
        displayName,
        email,
        isCurrent: folderName === currentConfigProfile,
      });
    }

    // Sort: Default first, then Profile 1, Profile 2, etc.
    profiles.sort((a, b) => a.folderName.localeCompare(b.folderName));
    return profiles;
  } catch (err) {
    console.error('Error reading Chrome Local State:', err);
    return [];
  }
}

/**
 * CLI Tool to list and interactively select the active Google Chrome profile
 */
async function selectChromeProfile(): Promise<void> {
  console.log('\n===============================================================');
  console.log('   Google Chrome Profile Selector                              ');
  console.log('===============================================================\n');

  const userDataDir = config.chromeUserDataDir;
  console.log(`Scanning Chrome directory: ${userDataDir}\n`);

  if (!fs.existsSync(userDataDir)) {
    console.error(`❌ Chrome User Data directory does not exist at: ${userDataDir}`);
    console.log('Please check your Chrome installation path or set CHROME_USER_DATA_DIR in .env.');
    process.exit(1);
  }

  const profiles = getAvailableChromeProfiles(userDataDir);

  if (profiles.length === 0) {
    console.log('⚠️ No Chrome profiles found in the specified User Data directory.');
    process.exit(0);
  }

  console.table(
    profiles.map((p) => ({
      'Profile Folder': p.folderName,
      'Display Name': p.displayName,
      'Google Account': p.email,
      'Active (.env)': p.isCurrent ? '⭐ ACTIVE' : '',
    }))
  );

  const choices = profiles.map(
    (p, i) => `${i + 1}. ${p.folderName} (${p.displayName}${p.email !== '(No Email Linked)' ? ' - ' + p.email : ''})`
  );
  
  console.log('Available Profiles:');
  choices.forEach(c => console.log(c));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`\nEnter the number of the Chrome profile you want to use for automation [1-${profiles.length}]: `);
  rl.close();

  const choiceIndex = parseInt(ans.trim(), 10) - 1;
  const selectedProfile = profiles[choiceIndex];

  if (!selectedProfile) {
    console.error('❌ Invalid selection.');
    process.exit(1);
  }

  const selectedFolderName = selectedProfile.folderName;

  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('CHROME_PROFILE_NAME=')) {
      envContent = envContent.replace(/^CHROME_PROFILE_NAME=.*$/m, `CHROME_PROFILE_NAME=${selectedFolderName}`);
    } else {
      envContent += `\nCHROME_PROFILE_NAME=${selectedFolderName}\n`;
    }
  } else {
    envContent = `CHROME_PROFILE_NAME=${selectedFolderName}\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`\n✅ Successfully updated CHROME_PROFILE_NAME to "${selectedFolderName}" in .env`);
  console.log('Restart the bot using `npm run dev` to apply the changes.');
  process.exit(0);
}

selectChromeProfile().catch((err) => {
  console.error('Fatal error selecting profile:', err);
  process.exit(1);
});
