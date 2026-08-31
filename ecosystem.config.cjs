module.exports = { apps: [{ name: 'cortex-bot', script: 'dist/bot.js', node_args: '--env-file=.env', env: { NODE_ENV: 'production' }, exp_backoff_restart_delay: 1000, max_restarts: 15 }] };
