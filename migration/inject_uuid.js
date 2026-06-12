#!/usr/bin/env node
/**
 * inject_uuid.js — UUID placeholder injector for multi-step migration batches.
 *
 * Usage:
 *   node migration/inject_uuid.js \
 *     --source <staging-file> \
 *     --placeholder ARIAPITA_PROPERTY_ID \
 *     --uuid <uuid-value> \
 *     --step 2 \
 *     --output <output-file>
 *
 * Reads a staging JSON file (stripping // comment lines), keeps only records
 * matching the given _step, replaces all occurrences of {PLACEHOLDER} in
 * endpoint and dedup_check fields, writes the result to --output.
 */

const fs = require('fs');

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    source:      get('--source'),
    placeholder: get('--placeholder'),
    uuid:        get('--uuid'),
    step:        parseInt(get('--step') || '0', 10),
    output:      get('--output'),
  };
}

const opts = parseArgs();

if (!opts.source || !opts.placeholder || !opts.uuid || !opts.step || !opts.output) {
  console.error('Usage: node inject_uuid.js --source <file> --placeholder <name> --uuid <value> --step <n> --output <file>');
  process.exit(1);
}

const raw = fs.readFileSync(opts.source, 'utf-8');
const stripped = raw.split('\n').map(l => /^\s*\/\//.test(l) ? '' : l).join('\n');
const staging = JSON.parse(stripped);

const token = '{' + opts.placeholder + '}';

const records = staging.records
  .filter(r => r._step === opts.step)
  .map(r => {
    const out = Object.assign({}, r);
    if (typeof out.endpoint === 'string') {
      out.endpoint = out.endpoint.replace(token, opts.uuid);
    }
    if (typeof out.dedup_check === 'string') {
      out.dedup_check = out.dedup_check.replace(token, opts.uuid);
    }
    return out;
  });

const output = {
  module:    'utility_accounts',
  entity_id: staging.entity_id,
  source:    staging.source,
  staged_at: staging.staged_at,
  staged_by: staging.staged_by,
  records,
};

fs.writeFileSync(opts.output, JSON.stringify(output, null, 2));
console.log('Wrote ' + records.length + ' record(s) to ' + opts.output);
