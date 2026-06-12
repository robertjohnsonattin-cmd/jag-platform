#!/usr/bin/env ts-node
/**
 * JAG Integrated Business Platform — Data Migration Runner
 * Version: 1.0.0 | Architecture: v1.9 | Phase: 7
 *
 * Reads a staging file produced by the JAG Data Population Agent,
 * acquires a Keycloak JWT, deduplicates against the live API,
 * and posts approved records with idempotency keys.
 *
 * Usage:
 *   JAG_PASSWORD=<secret> npx ts-node migration/migrate.ts \
 *     --staging migration/staging/properties_2026-06-10_1430.json \
 *     --env production
 *
 * Environment variables (required):
 *   JAG_PASSWORD         Keycloak password for robertjohnsonattin@gmail.com
 *   JAG_CLIENT_SECRET    jag-api client secret
 *
 * Optional:
 *   JAG_DRY_RUN=true     Print what would be posted without actually posting
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as https from "https";
import * as http from "http";

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  production: {
    apiBase: "https://api.jagcorporate.com/api/v1",
    authUrl:
      "https://auth.jagcorporate.com/realms/jag/protocol/openid-connect/token",
  },
  staging: {
    apiBase: "http://localhost:4000/api/v1",
    authUrl:
      "http://localhost:8080/realms/jag/protocol/openid-connect/token",
  },
};

const USERNAME = "robertjohnsonattin@gmail.com";
const CLIENT_ID = "jag-api";
const AUDIT_DIR = path.join(__dirname, "audit");
const DRY_RUN = process.env.JAG_DRY_RUN === "true";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StagedRecord {
  _ref: string;
  _idempotency_key: string;
  _source_ref: string;
  _status: "pending" | "posted" | "failed" | "skipped" | "already_exists" | "needs_review";
  _error?: string;
  _response_id?: string;
  _posted_at?: string;
  endpoint: string;
  dedup_check?: string;
  payload: Record<string, unknown>;
}

interface StagingFile {
  module: string;
  entity_id: string;
  source: string;
  staged_at: string;
  staged_by: string;
  records: StagedRecord[];
  summary: {
    total: number;
    pending: number;
    needs_review: number;
    already_exists: number;
  };
}

interface AuditResult {
  _ref: string;
  _idempotency_key: string;
  status: string;
  http_status?: number;
  response_id?: string;
  error?: string;
  posted_at?: string;
}

interface AuditLog {
  module: string;
  staging_file: string;
  executed_at: string;
  executed_by: string;
  approved_by: string;
  dry_run: boolean;
  results: AuditResult[];
  summary: {
    posted: number;
    failed: number;
    skipped: number;
    already_existed: number;
  };
}

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { stagingFile: string; env: "production" | "staging" } {
  const args = process.argv.slice(2);
  const stagingIdx = args.indexOf("--staging");
  const envIdx = args.indexOf("--env");

  if (stagingIdx === -1 || !args[stagingIdx + 1]) {
    console.error("ERROR: --staging <path> is required.");
    process.exit(1);
  }

  const stagingFile = args[stagingIdx + 1];
  const env =
    envIdx !== -1 && args[envIdx + 1] === "staging" ? "staging" : "production";

  return { stagingFile, env };
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

function httpRequest(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method,
      headers: options.headers,
    };

    const req = lib.request(reqOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });

    req.on("error", reject);

    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function acquireToken(
  authUrl: string,
  password: string
): Promise<string> {
  const clientSecret = process.env.JAG_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error(
      "JAG_CLIENT_SECRET env var is required. Set it before running."
    );
  }

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: CLIENT_ID,
    client_secret: clientSecret,
    username: USERNAME,
    password,
  }).toString();

  const { status, body: responseBody } = await httpRequest(authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (status !== 200) {
    const parsed = JSON.parse(responseBody);
    throw new Error(
      `Auth failed (HTTP ${status}): ${parsed.error_description ?? parsed.error ?? "unknown"}`
    );
  }

  const parsed = JSON.parse(responseBody);
  if (!parsed.access_token) {
    throw new Error("No access_token in auth response.");
  }

  return parsed.access_token as string;
}

function tokenExpiresIn(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );
    return (payload.exp as number) - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

// ─── API Calls ───────────────────────────────────────────────────────────────

async function apiGet(
  apiBase: string,
  endpoint: string,
  token: string
): Promise<{ status: number; data: unknown }> {
  const url = `${apiBase}${endpoint}`;
  const { status, body } = await httpRequest(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = JSON.parse(body);
  return { status, data };
}

async function apiPost(
  apiBase: string,
  endpoint: string,
  token: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
): Promise<{ status: number; data: unknown }> {
  // Extract HTTP method from endpoint prefix (default POST)
  const methodMatch = endpoint.match(/^(POST|PATCH|PUT|DELETE)\s+/);
  const method = methodMatch ? methodMatch[1] : "POST";
  const cleanEndpoint = endpoint.replace(/^(POST|GET|PATCH|PUT|DELETE)\s+/, "").replace(/^\/api\/v1/, "");
  const url = `${apiBase}${cleanEndpoint}`;

  // Strip null values — Zod .optional() accepts undefined but rejects null
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== null && v !== undefined)
  );

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would ${method} ${url}`);
    console.log(`            Payload: ${JSON.stringify(cleanPayload, null, 2)}`);
    return { status: method === "POST" ? 201 : 200, data: { id: "dry-run-id", _dry_run: true } };
  }

  const { status, body } = await httpRequest(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(cleanPayload),
  });

  const data = JSON.parse(body);
  return { status, data };
}

// ─── Deduplication ───────────────────────────────────────────────────────────

async function checkDuplicate(
  apiBase: string,
  dedupCheck: string | undefined,
  token: string
): Promise<{ isDuplicate: boolean; existingId?: string }> {
  if (!dedupCheck) return { isDuplicate: false };

  const cleanEndpoint = dedupCheck.replace(/^(GET|POST)\s+/, "").replace(/^\/api\/v1/, "");

  try {
    const { status, data } = await apiGet(apiBase, cleanEndpoint, token);
    if (status === 200) {
      const response = data as { success?: boolean; data?: unknown };
      // Support both flat array ({ data: [...] }) and nested ({ data: { vehicles: [...] } })
      let items: unknown[] = [];
      if (Array.isArray(response.data)) {
        items = response.data;
      } else if (typeof response.data === 'object' && response.data !== null) {
        const nested = Object.values(response.data as Record<string, unknown>).find(Array.isArray);
        if (nested) items = nested as unknown[];
      }
      if (items.length > 0) {
        const first = items[0] as Record<string, unknown>;
        return { isDuplicate: true, existingId: String(first.id ?? "") };
      }
    }
  } catch {
    // Dedup check failed — proceed with POST
  }

  return { isDuplicate: false };
}

// ─── Prompt Helper ────────────────────────────────────────────────────────────

function promptPassword(): Promise<string> {
  if (process.env.JAG_PASSWORD) {
    return Promise.resolve(process.env.JAG_PASSWORD);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Disable echo for password input
    const stdin = process.stdin as NodeJS.ReadStream & { _handle?: { setRawMode?: (raw: boolean) => void } };
    if (stdin.isTTY && stdin._handle?.setRawMode) {
      stdin._handle.setRawMode(true);
    }

    process.stdout.write("JAG Keycloak password: ");
    let password = "";
    stdin.on("data", (char) => {
      const c = String(char);
      if (c === "\n" || c === "\r") {
        process.stdout.write("\n");
        rl.close();
        resolve(password);
      } else if (c === "") {
        process.exit(1);
      } else {
        password += c;
        process.stdout.write("*");
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { stagingFile, env } = parseArgs();
  const { apiBase, authUrl } = CONFIG[env];

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  JAG Data Migration Runner v1.0              ║");
  console.log(`║  Environment: ${env.padEnd(30)}║`);
  console.log(`║  API Base:    ${apiBase.slice(0, 30).padEnd(30)}║`);
  if (DRY_RUN) {
    console.log("║  ⚠️  DRY RUN — no writes will be made        ║");
  }
  console.log("╚══════════════════════════════════════════════╝\n");

  // Load staging file
  if (!fs.existsSync(stagingFile)) {
    console.error(`ERROR: Staging file not found: ${stagingFile}`);
    process.exit(1);
  }

  const rawContent = fs.readFileSync(stagingFile, "utf-8");
  const strippedContent = rawContent.split('\n').map(l => /^\s*\/\//.test(l) ? '' : l).join('\n');
  const staging: StagingFile = JSON.parse(strippedContent);
  const pendingRecords = staging.records.filter((r) => r._status === "pending");

  console.log(`Module:  ${staging.module}`);
  console.log(`Source:  ${staging.source}`);
  console.log(`Records: ${staging.records.length} total, ${pendingRecords.length} pending\n`);

  if (pendingRecords.length === 0) {
    console.log("No pending records to post. Exiting.");
    process.exit(0);
  }

  // Acquire token
  const password = await promptPassword();
  let token: string;

  try {
    token = await acquireToken(authUrl, password);
    console.log(
      `\n✅ Auth token acquired (expires in ~${tokenExpiresIn(token)}s)\n`
    );
  } catch (err) {
    console.error(`\nERROR: ${(err as Error).message}`);
    process.exit(1);
  }

  // Process records
  const auditResults: AuditResult[] = [];
  const counts = { posted: 0, failed: 0, skipped: 0, alreadyExisted: 0 };

  for (const record of staging.records) {
    if (record._status !== "pending") {
      continue;
    }

    // Refresh token if expiring soon
    if (tokenExpiresIn(token) < 60) {
      try {
        token = await acquireToken(authUrl, password);
        console.log("🔄 Token refreshed\n");
      } catch {
        console.error("ERROR: Failed to refresh token.");
        process.exit(1);
      }
    }

    console.log(`  Processing: ${record._ref}`);

    // Dedup check
    const { isDuplicate, existingId } = await checkDuplicate(
      apiBase,
      record.dedup_check,
      token
    );

    // Determine HTTP method — PATCH/PUT use dedup result to inject {id}, not to skip
    const isMutation = /^(PATCH|PUT)\s+/.test(record.endpoint);

    if (isDuplicate && !isMutation) {
      console.log(`    ✅ Already exists (id: ${existingId}) — skipping`);
      record._status = "already_exists";
      record._response_id = existingId;
      auditResults.push({
        _ref: record._ref,
        _idempotency_key: record._idempotency_key,
        status: "already_exists",
        response_id: existingId,
      });
      counts.alreadyExisted++;
      continue;
    }

    // Inject {id} placeholder for PATCH/PUT endpoints that resolve via dedup
    if (isMutation && record.endpoint.includes('{id}') && !existingId) {
      console.log(`    ❌ PATCH requires existing record — dedup returned no results`);
      record._status = "failed";
      record._error = "No existing record found via dedup_check — cannot resolve {id} for PATCH";
      auditResults.push({
        _ref: record._ref,
        _idempotency_key: record._idempotency_key,
        status: "failed",
        error: record._error,
      });
      counts.failed++;
      continue;
    }

    const resolvedEndpoint = existingId
      ? record.endpoint.replace('{id}', existingId)
      : record.endpoint;

    // Post / Patch
    try {
      const { status, data } = await apiPost(
        apiBase,
        resolvedEndpoint,
        token,
        record.payload,
        record._idempotency_key
      );

      const response = data as { success?: boolean; data?: { id?: string }; error?: string; code?: string };

      if (status >= 200 && status < 300 && response.success !== false) {
        const responseId = response.data?.id ?? "unknown";
        console.log(`    ✅ Posted — id: ${responseId} (HTTP ${status})`);
        record._status = "posted";
        record._response_id = responseId;
        record._posted_at = new Date().toISOString();
        auditResults.push({
          _ref: record._ref,
          _idempotency_key: record._idempotency_key,
          status: "posted",
          http_status: status,
          response_id: responseId,
          posted_at: record._posted_at,
        });
        counts.posted++;
      } else {
        const errorMsg = response.error ?? `HTTP ${status}`;
        const errorCode = response.code ?? "";
        console.error(`    ❌ Failed — ${errorMsg} (${errorCode})`);
        record._status = "failed";
        record._error = `${errorMsg} [${errorCode}]`;
        auditResults.push({
          _ref: record._ref,
          _idempotency_key: record._idempotency_key,
          status: "failed",
          http_status: status,
          error: record._error,
        });
        counts.failed++;
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      console.error(`    ❌ Request error — ${errorMsg}`);
      record._status = "failed";
      record._error = errorMsg;
      auditResults.push({
        _ref: record._ref,
        _idempotency_key: record._idempotency_key,
        status: "failed",
        error: errorMsg,
      });
      counts.failed++;
    }
  }

  // Update staging file with results
  staging.summary = {
    total: staging.records.length,
    pending: staging.records.filter((r) => r._status === "pending").length,
    needs_review: staging.records.filter((r) => r._status === "needs_review").length,
    already_exists: counts.alreadyExisted,
  };

  fs.writeFileSync(stagingFile, JSON.stringify(staging, null, 2), "utf-8");
  console.log(`\n📝 Staging file updated: ${stagingFile}`);

  // Write audit log
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const auditFile = path.join(AUDIT_DIR, `${staging.module}_${timestamp}_audit.json`);

  const auditLog: AuditLog = {
    module: staging.module,
    staging_file: stagingFile,
    executed_at: new Date().toISOString(),
    executed_by: "JAG Data Population Agent",
    approved_by: "Robert Johnson-Attin",
    dry_run: DRY_RUN,
    results: auditResults,
    summary: {
      posted: counts.posted,
      failed: counts.failed,
      skipped: counts.skipped,
      already_existed: counts.alreadyExisted,
    },
  };

  fs.writeFileSync(auditFile, JSON.stringify(auditLog, null, 2), "utf-8");

  // Final report
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  MIGRATION COMPLETE                          ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  ✅ Posted:          ${String(counts.posted).padEnd(23)}║`);
  console.log(`║  ❌ Failed:          ${String(counts.failed).padEnd(23)}║`);
  console.log(`║  🔁 Already existed: ${String(counts.alreadyExisted).padEnd(23)}║`);
  console.log(`║  📋 Skipped:         ${String(counts.skipped).padEnd(23)}║`);
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Audit log: ${path.basename(auditFile).slice(0, 32).padEnd(32)}║`);
  console.log("╚══════════════════════════════════════════════╝\n");

  if (counts.failed > 0) {
    console.error(`⚠️  ${counts.failed} record(s) failed. Review: ${auditFile}`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
