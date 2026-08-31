module.exports = {
  apps: [
    {
      name: 'cortex-bot',
      script: 'dist/bot.js',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      min_uptime: '10s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '750M',
      kill_timeout: 45000,
      listen_timeout: 20000,
      time: true,
    },
  ],
};
