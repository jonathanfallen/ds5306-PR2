"use strict";

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const BUCKETS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

function nowNs() { return process.hrtime.bigint(); }
function nsToMs(ns) { return Number(ns) / 1_000_000; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadProto(protoPath) {
  const packageDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDef);
}

function makeHistogram() {
  return {
    count: 0,
    err: 0,
    sumMs: 0,
    minMs: Number.POSITIVE_INFINITY,
    maxMs: 0,
    buckets: new Array(BUCKETS_MS.length + 1).fill(0),
  };
}

function observe(hist, ms, isErr) {
  hist.count++;
  if (isErr) hist.err++;
  hist.sumMs += ms;
  hist.minMs = Math.min(hist.minMs, ms);
  hist.maxMs = Math.max(hist.maxMs, ms);
  let idx = BUCKETS_MS.findIndex(b => ms <= b);
  if (idx === -1) idx = BUCKETS_MS.length;
  hist.buckets[idx]++;
}

function summarize(name, hist, extra = {}) {
  const avg = hist.count ? (hist.sumMs / hist.count) : 0;
  return {
    kind: "tester_metrics",
    name,
    ...extra,
    count: hist.count,
    err: hist.err,
    avg_ms: Number(avg.toFixed(3)),
    min_ms: Number((hist.minMs === Infinity ? 0 : hist.minMs).toFixed(3)),
    max_ms: Number(hist.maxMs.toFixed(3)),
    buckets_ms: BUCKETS_MS,
    buckets: hist.buckets,
  };
}

function parseIntEnv(env, key, def) {
  const v = parseInt(env[key] || "", 10);
  return Number.isFinite(v) ? v : def;
}

function parseFloatEnv(env, key, def) {
  const v = parseFloat(env[key] || "");
  return Number.isFinite(v) ? v : def;
}

function shardRange(totalUsers, shardCount, shardIndex) {
  const per = Math.ceil(totalUsers / shardCount);
  const start = shardIndex * per;
  const end = Math.min(totalUsers, start + per);
  return { start, end, count: Math.max(0, end - start) };
}

// Raw unary call: measures 1 attempt only; does NOT touch histograms.
function unaryAttemptAsync(client, methodName, req) {
  const start = nowNs();
  return new Promise((resolve) => {
    client[methodName](req, (err, res) => {
      const ms = nsToMs(nowNs() - start);
      resolve({ err, res, ms });
    });
  });
}

function isRetryableGrpcError(err) {
  if (!err || typeof err.code !== "number") return false;
  return (
    err.code === grpc.status.UNAVAILABLE ||
    err.code === grpc.status.DEADLINE_EXCEEDED ||
    err.code === grpc.status.RESOURCE_EXHAUSTED ||
    err.code === grpc.status.UNKNOWN
  );
}

/**
 * Runs a unary RPC with retries.
 * IMPORTANT: Updates histogram ONCE per logical operation:
 *  - latency = sum of attempt latencies across retries
 *  - err increments only if the operation ultimately fails
 */
async function unaryWithRetry(client, methodName, req, hist, opts = {}) {
  const {
    maxAttempts = 4,
    baseDelayMs = 50,
    maxDelayMs = 500,
    acceptErrorCodes = [],
  } = opts;

  let totalMs = 0;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { err, res, ms } = await unaryAttemptAsync(client, methodName, req);
    totalMs += ms;

    if (!err) {
      observe(hist, totalMs, false);
      return { ok: true, res, attemptCount: attempt };
    }

    lastErr = err;

    if (typeof err.code === "number" && acceptErrorCodes.includes(err.code)) {
      // Treat accepted errors as success (e.g., ALREADY_EXISTS).
      observe(hist, totalMs, false);
      return { ok: true, res: null, attemptCount: attempt, acceptedError: err };
    }

    if (!isRetryableGrpcError(err) || attempt === maxAttempts) {
      observe(hist, totalMs, true);
      return { ok: false, err, attemptCount: attempt };
    }

    const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
    const jitter = Math.random() * exp * 0.2;
    await sleep(exp + jitter);
  }

  observe(hist, totalMs, true);
  return { ok: false, err: lastErr, attemptCount: maxAttempts };
}

async function runPerf({ env, scenarioName, usersTotal, mode }) {
  const LOGIN_ADDR = env.LOGIN_ADDR || "login-service:50051";
  const GATEWAY_ADDR = env.GATEWAY_ADDR || "gateway-service:50052";

  const BATCH_SIZE = parseIntEnv(env, "BATCH_SIZE", 200);
  const SHARD_COUNT = parseIntEnv(env, "SHARD_COUNT", 1);
  const SHARD_INDEX = parseIntEnv(env, "SHARD_INDEX", 0);

  const ROOM_NAME = env.ROOM_NAME || "PerfRoom";
  const DURATION_SEC = parseIntEnv(env, "DURATION_SEC", 120);
  const MSG_RATE_PER_USER_PER_SEC = parseFloatEnv(env, "MSG_RATE_PER_USER_PER_SEC", 0.2);

  const RPC_MAX_ATTEMPTS = parseIntEnv(env, "RPC_MAX_ATTEMPTS", 4);
  const RPC_BASE_DELAY_MS = parseIntEnv(env, "RPC_BASE_DELAY_MS", 50);
  const RPC_MAX_DELAY_MS = parseIntEnv(env, "RPC_MAX_DELAY_MS", 500);

  const authProto = loadProto("/contracts/proto/auth.proto");
  const loginClient = new authProto.auth.LoginService(
    LOGIN_ADDR,
    grpc.credentials.createInsecure()
  );

  const gwProto = loadProto("/contracts/proto/gateway.proto");
  const gatewayClient = new gwProto.gateway.GatewayService(
    GATEWAY_ADDR,
    grpc.credentials.createInsecure()
  );

  const { start, end, count } = shardRange(usersTotal, SHARD_COUNT, SHARD_INDEX);

  console.log(JSON.stringify({
    kind: "tester_run_start",
    scenario: scenarioName,
    mode,
    login_addr: LOGIN_ADDR,
    gateway_addr: GATEWAY_ADDR,
    users_total: usersTotal,
    shard_count: SHARD_COUNT,
    shard_index: SHARD_INDEX,
    shard_users: count,
    batch_size: BATCH_SIZE,
    room_name: ROOM_NAME,
    duration_sec: DURATION_SEC,
    msg_rate_per_user_per_sec: MSG_RATE_PER_USER_PER_SEC,
    t: new Date().toISOString(),
  }));

  const histLogin = makeHistogram();
  const histCreateRoom = makeHistogram();
  const histEnterRoom = makeHistogram();
  const histSend = makeHistogram();

  const t0 = nowNs();

  // ---- LOGIN PHASE (one logical op per user; no retry here by default) ----
  const creds = new Array(count);

  for (let i = start; i < end; i += BATCH_SIZE) {
    const batchEnd = Math.min(end, i + BATCH_SIZE);
    const batch = [];

    for (let u = i; u < batchEnd; u++) {
      const idx = u - start;
      const username = `perf_demo${u}`;
      const password = "demo";

      batch.push((async () => {
        // login attempt (no retry)
        const startNs = nowNs();
        const { err, res, ms } = await unaryAttemptAsync(loginClient, "Login", { username, password });
        const totalMs = ms; // single attempt
        observe(histLogin, totalMs, !!err);
        creds[idx] = err ? null : { username, credential: res.credential };
      })());
    }

    await Promise.all(batch);
  }

  const okCreds = creds.filter(x => x && x.credential);

  if (mode === "login") {
    const wallMs = nsToMs(nowNs() - t0);
    console.log(JSON.stringify(summarize("login", histLogin, {
      scenario: scenarioName,
      users_attempted: count,
      users_logged_in: okCreds.length,
      wall_ms: Number(wallMs.toFixed(3)),
      throughput_logins_per_sec: Number(((okCreds.length / (wallMs / 1000)) || 0).toFixed(3)),
    })));
    return;
  }

  if (okCreds.length === 0) {
    throw new Error("No successful logins; aborting chat phase.");
  }

  // ---- CREATE ROOM (retry + idempotent) ----
  const c0 = okCreds[0];

  const createRes = await unaryWithRetry(
    gatewayClient,
    "CreateRoom",
    { auth: { credential: c0.credential }, room_name: ROOM_NAME },
    histCreateRoom,
    {
      maxAttempts: RPC_MAX_ATTEMPTS,
      baseDelayMs: RPC_BASE_DELAY_MS,
      maxDelayMs: RPC_MAX_DELAY_MS,
      acceptErrorCodes: [grpc.status.ALREADY_EXISTS],
    }
  );

  if (!createRes.ok) {
    const code = (createRes.err && typeof createRes.err.code === "number") ? createRes.err.code : "n/a";
    throw new Error(`CreateRoom failed (code=${code}): ${createRes.err?.message || createRes.err}`);
  }

  // ---- ENTER ROOM (retry + idempotent) ----
  const enteredUsers = [];
  const enterFailSamples = [];
  const ENTER_FAIL_SAMPLE_LIMIT = 5;

  for (let i = 0; i < okCreds.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(okCreds.length, i + BATCH_SIZE);
    const batch = [];

    for (let k = i; k < batchEnd; k++) {
      const u = okCreds[k];

      batch.push((async () => {
        const r = await unaryWithRetry(
          gatewayClient,
          "EnterRoom",
          {
            auth: { credential: u.credential },
            room_name: ROOM_NAME,
            person_name: u.username,
          },
          histEnterRoom,
          {
            maxAttempts: RPC_MAX_ATTEMPTS,
            baseDelayMs: RPC_BASE_DELAY_MS,
            maxDelayMs: RPC_MAX_DELAY_MS,
            acceptErrorCodes: [grpc.status.ALREADY_EXISTS],
          }
        );

        if (r.ok) {
          enteredUsers.push(u);
          return;
        }

        if (enterFailSamples.length < ENTER_FAIL_SAMPLE_LIMIT) {
          enterFailSamples.push({
            user: u.username,
            code: (r.err && typeof r.err.code === "number") ? r.err.code : "n/a",
            message: r.err?.message || String(r.err),
          });
        }
      })());
    }

    await Promise.all(batch);
  }

  if (enterFailSamples.length > 0) {
    console.error("EnterRoom failures (sample):", JSON.stringify(enterFailSamples));
  }

  if (enteredUsers.length === 0) {
    throw new Error("No users entered the room; cannot proceed to chat phase.");
  }

  // ---- SEND MESSAGES (do not retry; count attempt latency; swallow failures) ----
  const endTime = Date.now() + DURATION_SEC * 1000;
  const perUserDelayMs = MSG_RATE_PER_USER_PER_SEC > 0 ? (1000 / MSG_RATE_PER_USER_PER_SEC) : 0;

  async function userLoop(u) {
    if (!perUserDelayMs) return;
    let n = 0;

    while (Date.now() < endTime) {
      const jitter = Math.random() * perUserDelayMs * 0.25;
      await sleep(Math.max(0, perUserDelayMs - jitter));

      const req = {
        auth: { credential: u.credential },
        room_name: ROOM_NAME,
        person_name: u.username,
        text: `perf msg ${u.username} #${n++}`,
        client_ts_ms: Date.now(),
        msg_id: `${u.username}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      };

      const { err, ms } = await unaryAttemptAsync(gatewayClient, "SendMessage", req);
      observe(histSend, ms, !!err);
    }
  }

  await Promise.all(enteredUsers.map(userLoop));

  const wallMs = nsToMs(nowNs() - t0);

  console.log(JSON.stringify(summarize("login", histLogin, {
    scenario: scenarioName,
    users_attempted: count,
    users_logged_in: okCreds.length,
  })));
  console.log(JSON.stringify(summarize("create_room", histCreateRoom, { scenario: scenarioName })));
  console.log(JSON.stringify(summarize("enter_room", histEnterRoom, {
    scenario: scenarioName,
    users_entered: enteredUsers.length,
  })));
  console.log(JSON.stringify(summarize("send_message", histSend, {
    scenario: scenarioName,
    duration_sec: DURATION_SEC,
    users_active: enteredUsers.length,
    wall_ms: Number(wallMs.toFixed(3)),
    msg_throughput_per_sec: Number(((histSend.count / (DURATION_SEC || 1)) || 0).toFixed(3)),
    msg_per_user_per_sec: Number((((histSend.count / (DURATION_SEC || 1)) / (enteredUsers.length || 1)) || 0).toFixed(6)),
  })));
}

module.exports = { runPerf };
