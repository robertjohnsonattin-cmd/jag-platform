#!/usr/bin/env node
/**
 * prod-install.js — prepare prod_modules/ for Docker COPY.
 *
 * Installs production-only node_modules into ./prod_modules/node_modules
 * so the Dockerfile can COPY them without running npm inside Alpine
 * (Alpine npm 10 fails to extract lockfileVersion 3 packages from npm 11).
 *
 * Called by: npm run prod-install
 * Runs on:   host machine (Windows) before docker compose build
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const root      = path.join(__dirname, '..');
const prodDir   = path.join(root, 'prod_modules');

// Clean and recreate the staging directory.
if (fs.existsSync(prodDir)) {
  fs.rmSync(prodDir, { recursive: true, force: true });
}
fs.mkdirSync(prodDir);

// Copy root package.json and package-lock.json into staging directory
// so npm ci reads the correct dependencies.
fs.copyFileSync(path.join(root, 'package.json'), path.join(prodDir, 'package.json'));
fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(prodDir, 'package-lock.json'));

console.log('Installing production dependencies into prod_modules/...');
execSync('npm ci --omit=dev', {
  cwd: prodDir,
  stdio: 'inherit',
  env: { ...process.env, npm_config_fund: 'false' },
});

// Verify key packages are present.
const checks = ['dotenv', 'express', 'pg', 'zod', 'jose'];
for (const pkg of checks) {
  const pkgPath = path.join(prodDir, 'node_modules', pkg);
  if (!fs.existsSync(pkgPath)) {
    console.error(`ERROR: ${pkg} not found in prod_modules/node_modules`);
    process.exit(1);
  }
}

console.log(`✅ prod_modules/node_modules ready (${
  fs.readdirSync(path.join(prodDir, 'node_modules')).length
} packages)`);
