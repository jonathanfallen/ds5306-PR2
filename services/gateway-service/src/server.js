const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

/**
 * ============================================================
 * METRICS (ADDED)
 * ============================================================
 * Collects per-RPC:
 *  - count, err
 *  - avg/min/max latency (ms)
 *  - histogram buckets
 * Logs JSON snapshots periodically to stdout (docker logs).
 */
const ENABLE_METRICS = (process.env.ENABLE_METRICS || "1") === "1";
const METRICS_LOG_INTERVAL_MS = parseInt(process.env.METRICS_LOG_INTERVAL_MS || "5000", 10);

// Histogram bucket boundaries in ms (tune later if needed)
const BUCKETS_MS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

const metrics = {
  rpc: new Map(), // name -> {count, err, sumMs, minMs, maxMs, buckets[]}
};

function getRpcMetric(name) {
  if (!metrics.rpc.has(name)) {
    metrics.rpc.set(name, {
      count: 0,
      err: 0,
      sumMs: 0,
      minMs: Number.POSITIVE_INFINITY,
      maxMs: 0,
      buckets: new Array(BUCKETS_MS.length + 1).fill(0), // last = overflow
    });
  }
  return metrics.rpc.get(name);
}

function observeRpc(name, ms, isErr) {
  const m = getRpcMetric(name);
  m.count++;
  if (isErr) m.err++;
  m.sumMs += ms;
  m.minMs = Math.min(m.minMs, ms);
  m.maxMs = Math.max(m.maxMs, ms);

  let idx = BUCKETS_MS.findIndex((b) => ms <= b);
  if (idx === -1) idx = BUCKETS_MS.length;
  m.buckets[idx]++;
}

function wrapUnaryCallback(name, callback, startNs) {
  return (err, resp) => {
    if (ENABLE_METRICS) {
      const end = process.hrtime.bigint();
      const ms = Number(end - startNs) / 1_000_000;
      observeRpc(name, ms, !!err);
    }
    callback(err, resp);
  };
}

function dumpMetrics() {
  for (const [name, m] of metrics.rpc.entries()) {
    const avg = m.count ? (m.sumMs / m.count) : 0;
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        kind: "gateway_metrics",
        rpc: name,
        count: m.count,
        err: m.err,
        avg_ms: Number(avg.toFixed(3)),
        min_ms: Number((m.minMs === Infinity ? 0 : m.minMs).toFixed(3)),
        max_ms: Number(m.maxMs.toFixed(3)),
        buckets_ms: BUCKETS_MS,
        buckets: m.buckets,
      })
    );
  }
}

if (ENABLE_METRICS) {
  setInterval(dumpMetrics, METRICS_LOG_INTERVAL_MS).unref();
}
/**
 * ============================================================
 * END METRICS
 * ============================================================
 */

const GW_PROTO = path.resolve("/contracts/proto/gateway.proto");
const AUTH_PROTO = path.resolve("/contracts/proto/auth.proto");
const CHAT_PROTO = path.resolve("/contracts/proto/chatroom.proto");
const MSG_PROTO = path.resolve("/contracts/proto/chat.proto");

function loadProto(p) {
  const def = protoLoader.loadSync(p, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(def);
}

const msg = loadProto(MSG_PROTO);
const gw = loadProto(GW_PROTO);
const auth = loadProto(AUTH_PROTO);
const chat = loadProto(CHAT_PROTO);

const CHATMSG_HOST = process.env.CHATMSG_HOST || "chat-service";
const CHATMSG_PORT = parseInt(process.env.CHATMSG_PORT || "50054", 10);

const LOGIN_HOST = process.env.LOGIN_HOST || "login-service";
const LOGIN_PORT = parseInt(process.env.LOGIN_PORT || "50051", 10);

const CHAT_HOST = process.env.CHAT_HOST || "chatroom-service";
const CHAT_PORT = parseInt(process.env.CHAT_PORT || "50053", 10);

const msgClient = new msg.chatmsg.ChatService(
  `${CHATMSG_HOST}:${CHATMSG_PORT}`,
  grpc.credentials.createInsecure()
);

const loginClient = new auth.auth.LoginService(
  `${LOGIN_HOST}:${LOGIN_PORT}`,
  grpc.credentials.createInsecure()
);

const chatClient = new chat.chat.ChatroomService(
  `${CHAT_HOST}:${CHAT_PORT}`,
  grpc.credentials.createInsecure()
);

function getCredentialOrFail(req) {
  const cred = req?.auth?.credential;
  if (!cred) {
    return { err: { code: grpc.status.UNAUTHENTICATED, message: "credential required" } };
  }
  return { cred };
}

function validateCredential(credential) {
  return new Promise((resolve, reject) => {
    loginClient.Validate({ credential }, (err, resp) => {
      if (err) return reject(err);
      if (!resp?.valid) {
        return reject({ code: grpc.status.UNAUTHENTICATED, message: "invalid credential" });
      }
      resolve(resp.username || "");
    });
  });
}

async function CreateRoom(call, callback) {
  const rpcName = "Gateway.CreateRoom";
  const startNs = process.hrtime.bigint();
  const cb = wrapUnaryCallback(rpcName, callback, startNs);

  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return cb(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    if (!room_name) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    chatClient.CreateRoom({ room_name }, (e, resp) => {
      if (e) return cb(e);
      cb(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    cb(e);
  }
}

async function DeleteRoom(call, callback) {
  const rpcName = "Gateway.DeleteRoom";
  const startNs = process.hrtime.bigint();
  const cb = wrapUnaryCallback(rpcName, callback, startNs);

  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return cb(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    if (!room_name) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    chatClient.DeleteRoom({ room_name }, (e, resp) => {
      if (e) return cb(e);
      cb(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    cb(e);
  }
}

async function EnterRoom(call, callback) {
  const rpcName = "Gateway.EnterRoom";
  const startNs = process.hrtime.bigint();
  const cb = wrapUnaryCallback(rpcName, callback, startNs);

  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return cb(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    const person_name = call.request.person_name;
    if (!room_name || !person_name) {
      return cb({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name and person_name required",
      });
    }

    chatClient.EnterRoom({ room_name, person_name }, (e, resp) => {
      if (e) return cb(e);
      cb(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    cb(e);
  }
}

async function LeaveRoom(call, callback) {
  const rpcName = "Gateway.LeaveRoom";
  const startNs = process.hrtime.bigint();
  const cb = wrapUnaryCallback(rpcName, callback, startNs);

  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return cb(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    const person_name = call.request.person_name;
    if (!room_name || !person_name) {
      return cb({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name and person_name required",
      });
    }

    chatClient.LeaveRoom({ room_name, person_name }, (e, resp) => {
      if (e) return cb(e);
      cb(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    cb(e);
  }
}

async function GetPeople(call, callback) {
  const rpcName = "Gateway.GetPeople";
  const startNs = process.hrtime.bigint();
  const cb = wrapUnaryCallback(rpcName, callback, startNs);

  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return cb(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    if (!room_name) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    chatClient.GetPeople({ room_name }, (e, resp) => {
      if (e) return cb(e);
      cb(null, { people: resp?.people || [] });
    });
  } catch (e) {
    cb(e);
  }
}

async function SendMessage(call, callback) {
  const rpcName = "Gateway.SendMessage";
  const startNs = process.hrtime.bigint();
  const cb = wrapUnaryCallback(rpcName, callback, startNs);

  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return cb(err);

  try {
    await validateCredential(cred);

    const { room_name, person_name, text, client_ts_ms, msg_id } = call.request;
    if (!room_name || !person_name || !text) {
      return cb({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name, person_name, text required",
      });
    }

    msgClient.SendMessage(
      { room_name, person_name, text, client_ts_ms: client_ts_ms || 0, msg_id: msg_id || "" },
      (e, resp) => {
        if (e) return cb(e);
        cb(null, resp);
      }
    );
  } catch (e) {
    cb(e);
  }
}

async function GetHistory(call, callback) {
  const rpcName = "Gateway.GetHistory";
  const startNs = process.hrtime.bigint();
  const cb = wrapUnaryCallback(rpcName, callback, startNs);

  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return cb(err);

  try {
    await validateCredential(cred);

    const { room_name, limit } = call.request;
    if (!room_name) {
      return cb({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    msgClient.GetHistory({ room_name, limit: limit || 20 }, (e, resp) => {
      if (e) return cb(e);
      cb(null, resp);
    });
  } catch (e) {
    cb(e);
  }
}

// server-streaming forward (instrumented)
async function Subscribe(call) {
  const rpcName = "Gateway.Subscribe";
  const startNs = process.hrtime.bigint();
  let ended = false;

  const endOnce = (isErr) => {
    if (ended) return;
    ended = true;
    if (!ENABLE_METRICS) return;

    const end = process.hrtime.bigint();
    const ms = Number(end - startNs) / 1_000_000;
    observeRpc(rpcName, ms, isErr);
  };

  const cred = call.request?.auth?.credential;
  if (!cred) {
    endOnce(true);
    call.destroy({ code: grpc.status.UNAUTHENTICATED, message: "credential required" });
    return;
  }

  try {
    await validateCredential(cred);

    const { room_name, person_name } = call.request;
    if (!room_name || !person_name) {
      endOnce(true);
      call.destroy({ code: grpc.status.INVALID_ARGUMENT, message: "room_name and person_name required" });
      return;
    }

    const upstream = msgClient.Subscribe({ room_name, person_name });

    upstream.on("data", (msg) => {
      try { call.write(msg); } catch {}
    });

    upstream.on("end", () => {
      endOnce(false);
      call.end();
    });

    upstream.on("error", (e) => {
      endOnce(true);
      call.destroy(e);
    });

    call.on("cancelled", () => {
      upstream.cancel();
      endOnce(false);
    });

    call.on("close", () => {
      upstream.cancel();
      endOnce(false);
    });

    call.on("error", () => {
      upstream.cancel();
      endOnce(true);
    });
  } catch (e) {
    endOnce(true);
    call.destroy(e);
  }
}

function main() {
  const server = new grpc.Server();
  server.addService(gw.gateway.GatewayService.service, {
    CreateRoom,
    DeleteRoom,
    EnterRoom,
    LeaveRoom,
    GetPeople,
    SendMessage,
    Subscribe,
    GetHistory,
  });

  const addr = "0.0.0.0:50052";
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    server.start();
    console.log(`GatewayService listening on ${addr}`);
  });
}

main();
