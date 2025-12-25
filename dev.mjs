#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("-")) {
      out._.push(a);
      continue;
    }
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--no-kill") out.kill = false;
    else if (a === "--kill") out.kill = true;
    else if (a === "--smoke") out.smoke = true;
    else if (a === "--env") out.env = argv[++i];
    else if (a.startsWith("--env=")) out.env = a.split("=", 2)[1];
    else if (a === "--port" || a === "-p") out.port = argv[++i];
    else if (a.startsWith("--port=")) out.port = a.split("=", 2)[1];
    else if (a === "--db") out.db = argv[++i];
    else if (a.startsWith("--db=")) out.db = a.split("=", 2)[1];
    else if (a === "--public") out.public = argv[++i];
    else if (a.startsWith("--public=")) out.public = a.split("=", 2)[1];
    else if (a === "--cors") out.cors = argv[++i];
    else if (a.startsWith("--cors=")) out.cors = a.split("=", 2)[1];
    else if (a === "--jwt") out.jwt = argv[++i];
    else if (a.startsWith("--jwt=")) out.jwt = a.split("=", 2)[1];
    else out._.push(a);
  }
  return out;
}

function help() {
  console.log(`
Local dev launcher (server + static web), with port cleanup.

Usage:
  node dev.mjs [--port 8787] [--db ./data/app.db] [--public ./web] [--cors *] [--jwt <secret>] [--env ./.env] [--no-kill]
  node dev.mjs --smoke [--env ./.env]

Environment overrides (optional):
  PORT, DB_PATH, PUBLIC_DIR, CORS_ORIGIN, JWT_SECRET, GEMINI_API_KEY, AI_IMPORT_*
`.trim());
}

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function trySh(cmd) {
  try {
    return sh(cmd);
  } catch {
    return null;
  }
}

function uniqNums(nums) {
  const out = [];
  const seen = new Set();
  for (const n of nums) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function findListeningPids(port) {
  if (!Number.isFinite(port) || port <= 0) return [];

  if (process.platform === "win32") {
    const out = trySh("netstat -ano -p tcp");
    if (!out) return [];
    const pids = [];
    const needle = `:${port}`;
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(needle)) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const proto = parts[0];
      const local = parts[1];
      const state = parts[3];
      const pid = parts[4];
      if (proto.toUpperCase() !== "TCP") continue;
      if (!local.endsWith(needle)) continue;
      if (state.toUpperCase() !== "LISTENING") continue;
      pids.push(pid);
    }
    return uniqNums(pids);
  }

  const lsof = trySh(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  if (lsof) return uniqNums(lsof.split(/\s+/));

  const ss = trySh(`sh -lc "ss -lptn 'sport = :${port}' | sed -n 's/.*pid=\\([0-9]\\+\\).*/\\1/p'"`);
  if (ss) return uniqNums(ss.split(/\s+/));

  const netstat = trySh(`sh -lc "netstat -ltnp 2>/dev/null | awk '$4 ~ /:${port}$/ {print $7}' | cut -d/ -f1"`);
  if (netstat) return uniqNums(netstat.split(/\s+/));

  return [];
}

function killPid(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      return true;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch (_) {}
    try {
      execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      return true;
    } catch (_) {
      return true;
    }
  } catch {
    return false;
  }
}

function cleanupPort(port) {
  const pids = findListeningPids(port);
  if (!pids.length) return { pids: [], killed: 0 };
  let killed = 0;
  for (const pid of pids) if (killPid(pid)) killed++;
  return { pids, killed };
}

function parseDotEnv(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line || line.startsWith("#")) continue;
    const s = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const key = s.slice(0, eq).trim();
    let value = s.slice(eq + 1).trim();
    if (!key) continue;

    // remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFiles({ repoRoot, envPath }) {
  const externalKeys = new Set(Object.keys(process.env));
  const merged = {};

  function loadOne(p) {
    try {
      if (!p) return false;
      if (!fs.existsSync(p)) return false;
      const txt = fs.readFileSync(p, "utf8");
      const parsed = parseDotEnv(txt);
      for (const [k, v] of Object.entries(parsed)) merged[k] = v;
      return true;
    } catch {
      return false;
    }
  }

  const loaded = [];
  if (envPath) {
    const p = path.resolve(repoRoot, envPath);
    if (loadOne(p)) loaded.push(p);
  } else {
    const p1 = path.join(repoRoot, ".env");
    const p2 = path.join(repoRoot, ".env.local");
    if (loadOne(p1)) loaded.push(p1);
    if (loadOne(p2)) loaded.push(p2);
  }

  for (const [k, v] of Object.entries(merged)) {
    if (externalKeys.has(k)) continue;
    process.env[k] = String(v);
  }

  return loaded;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, () => {
      const addr = s.address();
      const p = addr && typeof addr === "object" ? addr.port : null;
      s.close(() => resolve(p));
    });
  });
}

async function waitForOk(url, timeoutMs = 12_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

async function runSmoke({ baseUrl }) {
  const { res: hres, json: hjson } = await jsonFetch(`${baseUrl}/api/health`, { method: "GET" });
  if (!hres.ok || !hjson || hjson.ok !== true) throw new Error("health check failed");

  const { res: homeRes, text: homeHtml } = await jsonFetch(`${baseUrl}/`, { method: "GET" });
  if (!homeRes.ok) throw new Error("home html fetch failed");
  if (!String(homeHtml).includes('id="aiChatModal"')) throw new Error("missing aiChatModal in HTML");
  if (!String(homeHtml).includes('id="aiImportModal"')) throw new Error("missing aiImportModal in HTML");

  const uname = `smoke_${crypto.randomBytes(6).toString("hex")}`;
  const pass = "smokePass123";
  const reg = await jsonFetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: uname, password: pass }),
  });
  if (!reg.res.ok || !reg.json || !reg.json.token) throw new Error(`register failed: ${reg.text}`);
  const token = reg.json.token;

  const bookId = `book_${crypto.randomBytes(4).toString("hex")}`;
  const libData = {
    ui: {},
    books: [{ id: bookId, title: "Smoke Book", chapters: [], folders: [], layoutMap: {}, deletedChapterIds: [] }],
    currentBookId: bookId,
  };
  const put = await jsonFetch(`${baseUrl}/api/library`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: libData }),
  });
  if (!put.res.ok || !put.json || put.json.ok !== true) throw new Error(`library put failed: ${put.text}`);

  const ctx = "【题目】\nSmoke question\n【选项】\nA. a\nB. b\n【答案】A";
  const conv = await jsonFetch(`${baseUrl}/api/ai/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      scope: "question",
      bookId,
      chapterId: "ch1",
      questionId: "1",
      questionKey: `${bookId}|ch1|1`,
      modelPref: "flash",
      questionContext: ctx,
    }),
  });
  if (!conv.res.ok || !conv.json || !conv.json.conversationId) throw new Error(`create conversation failed: ${conv.text}`);

  const convId = conv.json.conversationId;
  const getConv = await jsonFetch(`${baseUrl}/api/ai/conversations/${encodeURIComponent(convId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getConv.res.ok || !getConv.json || !getConv.json.conversation) throw new Error(`get conversation failed: ${getConv.text}`);
  const msgs = Array.isArray(getConv.json.messages) ? getConv.json.messages : [];
  const hasCtx = msgs.some((m) => m && m.role === "system" && String(m.text || "").includes("Smoke question"));
  if (!hasCtx) throw new Error("question context system message missing");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  const repoRoot = __dirname;
  const serverDir = path.join(repoRoot, "server");
  const entry = path.join(serverDir, "src", "server.js");

  const loadedEnvFiles = loadEnvFiles({ repoRoot, envPath: args.env });
  if (loadedEnvFiles.length) console.log(`[dev] loaded env: ${loadedEnvFiles.join(", ")}`);

  let port = Number(args.port ?? process.env.PORT ?? 8787);
  if (args.smoke && args.port === undefined && process.env.PORT === undefined) {
    port = await getFreePort();
  }
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`Bad port: ${args.port ?? process.env.PORT}`);
    process.exit(1);
  }

  const dbPathDefault = path.join(repoRoot, "data", "app.db");
  const dbPath =
    args.smoke && args.db === undefined && process.env.DB_PATH === undefined
      ? path.join(os.tmpdir(), `tiku_smoke_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.db`)
      : path.resolve(repoRoot, args.db ?? process.env.DB_PATH ?? dbPathDefault);

  const publicDir = path.resolve(repoRoot, args.public ?? process.env.PUBLIC_DIR ?? path.join(repoRoot, "web"));
  const corsOrigin = String(args.cors ?? process.env.CORS_ORIGIN ?? "*");
  const jwtSecret = String(args.jwt ?? process.env.JWT_SECRET ?? crypto.randomBytes(32).toString("hex"));

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch (_) {}

  const shouldKill = args.smoke ? args.kill === true : args.kill !== false;
  if (shouldKill) {
    const res = cleanupPort(port);
    if (res.pids.length) {
      console.log(`[dev] cleaned port ${port} (pids: ${res.pids.join(", ")})`);
    }
  }

  console.log(`[dev] starting server on http://localhost:${port}`);
  console.log(`[dev] DB_PATH=${dbPath}`);
  console.log(`[dev] PUBLIC_DIR=${publicDir}`);
  console.log(`[dev] CORS_ORIGIN=${corsOrigin}`);
  if (!process.env.JWT_SECRET && !args.jwt) console.log("[dev] JWT_SECRET generated (set JWT_SECRET to keep it stable)");
  if (args.smoke) console.log("[dev] smoke mode: will start, run checks, then exit");

  const child = spawn(process.execPath, [entry], {
    cwd: serverDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      PUBLIC_DIR: publicDir,
      CORS_ORIGIN: corsOrigin,
      JWT_SECRET: jwtSecret,
    },
  });

  if (args.smoke) {
    try {
      const ok = await waitForOk(`http://localhost:${port}/api/health`, 12_000);
      if (!ok) throw new Error("server did not become ready in time");
      await runSmoke({ baseUrl: `http://localhost:${port}` });
      console.log("[dev] smoke: OK");
      process.exitCode = 0;
    } catch (e) {
      console.error("[dev] smoke: FAILED");
      console.error(e);
      process.exitCode = 1;
    } finally {
      try {
        if (!child.killed) child.kill("SIGTERM");
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 600));
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch (_) {}
      if (args.db === undefined && process.env.DB_PATH === undefined) {
        try {
          fs.rmSync(dbPath, { force: true });
          fs.rmSync(`${dbPath}-wal`, { force: true });
          fs.rmSync(`${dbPath}-shm`, { force: true });
        } catch (_) {}
      }
    }
    return;
  }

  function forward(sig) {
    try {
      if (!child.killed) child.kill(sig);
    } catch (_) {}
  }
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
