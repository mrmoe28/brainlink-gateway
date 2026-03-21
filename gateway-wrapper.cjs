/**
 * gateway-wrapper.cjs
 * CJS wrapper so PM2 can reliably track the ESM gateway process on Windows.
 * PM2 manages THIS file; this file manages the actual gateway child process.
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const gatewayDir = __dirname;
let child = null;
let shuttingDown = false;
let restartTimer = null;

function startGateway() {
  if (shuttingDown) return;
  if (child) return; // already running

  console.log('[Gateway Wrapper] Starting gateway...');
  child = spawn('node', ['dist/index.js'], {
    cwd: gatewayDir,
    stdio: 'inherit',
    env: { ...process.env },
    windowsHide: true,
  });

  child.on('exit', (code) => {
    child = null;
    if (shuttingDown) return;
    console.log(`[Gateway Wrapper] Gateway exited (code ${code}). Restarting in 3s...`);
    restartTimer = setTimeout(startGateway, 3000);
  });

  child.on('error', (err) => {
    child = null;
    if (shuttingDown) return;
    console.error('[Gateway Wrapper] Spawn error:', err.message, '— restarting in 5s...');
    restartTimer = setTimeout(startGateway, 5000);
  });
}

function shutdown(signal) {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (child) {
    console.log('[Gateway Wrapper] Forwarding', signal, 'to gateway...');
    child.kill(signal);
    setTimeout(() => process.exit(0), 3000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

startGateway();
