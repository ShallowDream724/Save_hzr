#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
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
  node dev.mjs [--port 8787] [--db ./data/app.db] [--public ./web] [--cors *] [--jwt <secret>] [--no-kill]

Environment overrides (optional):
  PORT, DB_PATH, PUBLIC_DIR, CORS_ORIGIN, JWT_SECRET
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

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  help();
  process.exit(0);
}

const port = Number(args.port ?? process.env.PORT ?? 8787);
if (!Number.isFinite(port) || port <= 0) {
  console.error(`Bad port: ${args.port ?? process.env.PORT}`);
  process.exit(1);
}

const repoRoot = __dirname;
const serverDir = path.join(repoRoot, "server");
const entry = path.join(serverDir, "src", "server.js");

const dbPath = path.resolve(repoRoot, args.db ?? process.env.DB_PATH ?? path.join(repoRoot, "data", "app.db"));
const publicDir = path.resolve(repoRoot, args.public ?? process.env.PUBLIC_DIR ?? path.join(repoRoot, "web"));
const corsOrigin = String(args.cors ?? process.env.CORS_ORIGIN ?? "*");
const jwtSecret = String(args.jwt ?? process.env.JWT_SECRET ?? crypto.randomBytes(32).toString("hex"));

try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
} catch (_) {}

const shouldKill = args.kill !== false;
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

