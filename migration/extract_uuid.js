#!/usr/bin/env node
/**
 * extract_uuid.js — Extract response_id from the latest audit log for a module.
 *
 * Usage:
 *   node migration/extract_uuid.js --module properties --ref "62 Ariapita"
 *
 * Scans migration/audit/ for the most recently modified file matching
 * {module}_*.json, finds the result entry whose _ref contains --ref,
 * and prints the response_id to stdout (nothing else).
 * Exits non-zero if not found.
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  return { module: get('--module'), ref: get('--ref') };
}

const opts = parseArgs();
if (!opts.module || !opts.ref) {
  console.error('Usage: node extract_uuid.js --module <module> --ref <ref-substring>');
  process.exit(1);
}

const auditDir = path.join(__dirname, 'audit');
if (!fs.existsSync(auditDir)) {
  console.error('ERROR: audit directory not found: ' + auditDir);
  process.exit(1);
}

const files = fs.readdirSync(auditDir)
  .filter(f => f.startsWith(opts.module + '_') && f.endsWith('.json'))
  .map(f => ({ name: f, mtime: fs.statSync(path.join(auditDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (files.length === 0) {
  console.error('ERROR: No audit files found for module: ' + opts.module);
  process.exit(1);
}

const latest = path.join(auditDir, files[0].name);
const audit = JSON.parse(fs.readFileSync(latest, 'utf-8'));

const result = audit.results.find(r => r._ref && r._ref.includes(opts.ref));
if (!result || !result.response_id || result.response_id === 'unknown') {
  console.error('ERROR: Could not find response_id for ref "' + opts.ref + '" in ' + files[0].name);
  console.error('       Available refs: ' + audit.results.map(r => r._ref).join(', '));
  process.exit(1);
}

process.stdout.write(result.response_id);
