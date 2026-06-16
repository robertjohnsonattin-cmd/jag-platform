// sse-listener.js — JAG batch push listener
// Runs on workstation startup via Task Scheduler.
// Connects to the JAG API SSE endpoint and runs the Ollama batch
// the instant "Process Now" is clicked on the platform.
// No polling — purely event-driven.

'use strict';
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR  = __dirname;
const LOG_FILE    = path.join(SCRIPT_DIR, 'sse-listener.log');
const BATCH_SCRIPT = path.join(SCRIPT_DIR, 'run-batch.ps1');

const API_HOST    = 'api.jagcorporate.com';
const API_BASE    = '/api/v1';
const KC_URL      = 'https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token';
const KC_CLIENT_ID     = 'jag-api';
const KC_CLIENT_SECRET = 'FIjMqEPT35gr3TRvh6FDdCTnMAX2FAGMjTVHuljqcBU';

const KC_USERNAME = process.env.KC_USERNAME;
const KC_PASSWORD = process.env.KC_PASSWORD;

if (!KC_USERNAME || !KC_PASSWORD) {
  process.stderr.write('KC_USERNAME and KC_PASSWORD must be set. Run start-listener.ps1, not this script directly.\n');
  process.exit(1);
}

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const line = `${ts}  ${msg}`;
  process.stdout.write(line + '\n');
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ── Keycloak token ────────────────────────────────────────────────────────────

function getToken() {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type:    'password',
      client_id:     KC_CLIENT_ID,
      client_secret: KC_CLIENT_SECRET,
      username:      KC_USERNAME,
      password:      KC_PASSWORD,
    }).toString();

    const url = new URL(KC_URL);
    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(`KC error: ${parsed.error_description ?? data}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Clear trigger via API ─────────────────────────────────────────────────────

function clearTrigger(token) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: API_HOST,
      path:     `${API_BASE}/finance/document-jobs/trigger/clear`,
      method:   'POST',
      headers:  { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': 2 },
    }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', (e) => { log(`Warning: failed to clear trigger: ${e.message}`); resolve(undefined); });
    req.write('{}');
    req.end();
  });
}

// ── Run the Ollama batch ──────────────────────────────────────────────────────

function runBatch(token) {
  log('Running Ollama batch...');
  const result = spawnSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', BATCH_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  const out = (result.stdout?.toString() ?? '').trim();
  const errOut = (result.stderr?.toString() ?? '').trim();
  if (out)    log(`Batch stdout: ${out.slice(0, 500)}`);
  if (errOut) log(`Batch stderr: ${errOut.slice(0, 500)}`);
  log(`Batch exit code: ${result.status ?? 'timeout'}`);
  return clearTrigger(token);
}

// ── SSE connection ────────────────────────────────────────────────────────────

let reconnectDelay = 5000;

async function connect() {
  let token;
  try {
    token = await getToken();
    log('Keycloak token obtained. Connecting to SSE...');
    reconnectDelay = 5000; // Reset backoff on successful auth
  } catch (e) {
    log(`Failed to get token: ${e.message}. Retrying in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    return;
  }

  const req = https.request({
    hostname: API_HOST,
    path:     `${API_BASE}/finance/document-jobs/listen`,
    method:   'GET',
    headers:  { 'Authorization': `Bearer ${token}`, 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
  }, (res) => {
    if (res.statusCode === 401) {
      log('Token expired. Reconnecting with fresh token...');
      res.resume();
      setTimeout(connect, 1000);
      return;
    }

    if (res.statusCode === 429) {
      log('Rate limited (429). Waiting 65s for window to reset...');
      res.resume();
      setTimeout(connect, 65_000);
      return;
    }

    log(`SSE connected (HTTP ${res.statusCode}). Waiting for triggers...`);
    reconnectDelay = 5000;

    let buf = '';
    let eventType = '';

    res.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith('data:') && eventType === 'trigger') {
          log('Trigger received from platform!');
          // Run batch then reconnect (fresh token in case batch took long)
          runBatch(token).then(() => {
            log('Reconnecting after batch...');
            setTimeout(connect, 1000);
          });
          res.destroy(); // Close this SSE connection
        }
        // heartbeat and empty lines — ignore
      }
    });

    res.on('end', () => {
      log(`SSE connection closed. Reconnecting in ${reconnectDelay / 1000}s...`);
      setTimeout(connect, reconnectDelay);
    });

    res.on('error', (e) => {
      log(`SSE stream error: ${e.message}. Reconnecting in ${reconnectDelay / 1000}s...`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    });
  });

  req.on('error', (e) => {
    log(`Connection error: ${e.message}. Retrying in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
  });

  req.end();
}

log('JAG Batch SSE Listener starting...');
connect();
