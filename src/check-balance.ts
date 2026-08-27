import { fetchLiveBalance, closeWarmBrowser } from './executor.js';
import { logger } from './logger.js';
import { config } from './config.js';

/**
 * Standalone CLI Utility: Check and verify live account balance on trading platform
 */
async function main(): Promise<void> {
  console.log('\n===============================================================');
  console.log('   Cortex Automation - Live Account Balance Checker            ');
  console.log('===============================================================\n');

  logger.info(`Target URL: ${config.targetUrl}`);
  logger.info(`Chrome Profile: "${config.chromeProfileName}"`);
  logger.info('Connecting to browser and inspecting trading UI balance...\n');

  const startTime = Date.now();

  try {
    const balance = await fetchLiveBalance(true);
    const duration = Date.now() - startTime;

    if (balance) {
      console.log('✅ Balance extraction succeeded!\n');
      console.table([
        {
          'Field': 'Account Type',
          'Value': balance.accountType,
        },
        {
          'Field': 'Formatted Balance',
          'Value': balance.formattedBalance,
        },
        {
          'Field': 'Numeric Value',
          'Value': balance.numericValue.toString(),
        },
        {
          'Field': 'Currency',
          'Value': balance.currency,
        },
        {
          'Field': 'Extraction Strategy',
          'Value': balance.source,
        },
        {
          'Field': 'Response Time',
          'Value': `${duration}ms`,
        },
        {
          'Field': 'Last Updated',
          'Value': new Date(balance.updatedAt).toLocaleString(),
        },
      ]);

      console.log('\n💡 Tip: Your balance is now synced with the web dashboard at http://localhost:3000');
    } else {
      console.log('\n⚠️  Could not detect balance elements on the active page.');
      console.log('Possible causes:');
      console.log('1. You are not logged in yet on the trading platform.');
      console.log('   👉 Run Chrome, log in to your account, and keep the session saved.');
      console.log('2. The page URL might be stuck on a CAPTCHA or loading screen.');
      console.log(`3. Target URL is: ${config.targetUrl}\n`);
    }
  } catch (error: any) {
    console.error('\n❌ Balance check failed with error:', error?.message || error);
  } finally {
    await closeWarmBrowser();
    console.log('\nBrowser session closed cleanly.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal balance check error:', err);
  process.exit(1);
});
