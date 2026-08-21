/**
 * PM2 process definition for the Bun runtime.
 *
 * Keep runtime configuration in .env; PM2 is only responsible for keeping
 * the process alive and restarting it after crashes or host reboots.
 */
module.exports = {
  apps: [
    {
      name: 'mochi',
      cwd: __dirname,
      script: 'src/index.js',
      interpreter: 'bun',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      time: true,
      merge_logs: true,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
    },
  ],
};
