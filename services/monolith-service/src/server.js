const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { v4: uuidv4 } = require("uuid");
const mysql = require("mysql2/promise");

// ---- PROTO PATHS (mounted from /contracts/proto in docker) ----
const AUTH_PROTO = path.resolve("/contracts/proto/auth.proto");
const GW_PROTO = path.resolve("/contracts/proto/gateway.proto");

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

const auth = loadProto(AUTH_PROTO);
const gw = loadProto(GW_PROTO);

// ==========================
// DB (users + sessions)
// ==========================
function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

const DB_CFG = {
  host: process.env.DB_HOST || "mysql",
  port: envInt("DB_PORT", 3306),
  user: process.env.DB_USER || "perf",
  password: process.env.DB_PASSWORD || "perfpass",
  database: process.env.DB_NAME || "perfdb",
};

const SESSION_TTL_MS = 60 * 60 * 1000; // 60 minutes
let dbPool = null;

async function connectWithRetry() {
  const attempts = envInt("DB_CONNECT_ATTEMPTS", 60);
  const delayMs = envInt("DB_CONNECT_DELAY_MS", 1000);

  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const pool = mysql.createPool({
        host: DB_CFG.host,
        port: DB_CFG.port,
        user: DB_CFG.user,
        password: DB_CFG.password,
        database: DB_CFG.database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });
      await pool.query("SELECT 1");
      return pool;
    } catch (e) {
      lastErr = e;
      console.error(`DB connect attempt ${i}/${attempts} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// Sanity guard. Init scripts run only on first volume creation.
async function ensureSchemaExists(pool) {
  await pool.query("SELECT 1 FROM users LIMIT 1");
  await pool.query("SELECT 1 FROM sessions LIMIT 1");
}

async function dbFindUser(username) {
  const [rows] = await dbPool.query(
    `SELECT id, user_name, password_plain, is_active
     FROM users
     WHERE user_name = ?
     LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

function makeCredential() {
  // Must fit VARCHAR(128)
  return `cred-${uuidv4()}`;
}

async function dbCreateSession(userId, credential, ttlMs) {
  const ttlSec = Math.floor(ttlMs / 1000);
  await dbPool.query(
    `INSERT INTO sessions (user_id, credential, expires_at)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [userId, credential, ttlSec]
  );
}

async function dbValidateCredential(credential) {
  const [rows] = await dbPool.query(
    `
    SELECT u.user_name AS user_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.credential = ?
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
      AND u.is_active = 1
    LIMIT 1
    `,
    [credential]
  );

  return rows[0]?.user_name || null;
}

async function validateCredentialOrThrowAsync(credential) {
  if (!credential) {
    const err = new Error("credential required");
    err.code = grpc.status.UNAUTHENTICATED;
    throw err;
  }

  const username = await dbValidateCredential(credential);
  if (!username) {
    const err = new Error("invalid credential");
    err.code = grpc.status.UNAUTHENTICATED;
    throw err;
  }
  return username;
}

// ==========================
// In-memory room/chat state
// ==========================

// room_name -> Set(person_name)
const rooms = new Map();

// room_name -> [{ server_seq, person_name, text, ts_ms }]
const messageHistory = new Map();

// room_name -> Set(streamCall)
const roomSubscribers = new Map();

// sequence counter
let GLOBAL_SEQ = 0;

function ensureMessagingRoom(roomName) {
  if (!rooms.has(roomName)) rooms.set(roomName, new Set());
  if (!messageHistory.has(roomName)) messageHistory.set(roomName, []);
  if (!roomSubscribers.has(roomName)) roomSubscribers.set(roomName, new Set());
}

function ensureRoomExists(roomName) {
  if (!rooms.has(roomName)) rooms.set(roomName, new Set());
  return rooms.get(roomName);
}

// ==========================
// LoginService implementation
// ==========================
function Login(call, callback) {
  (async () => {
    const { username, password } = call.request || {};
    if (!username || !password) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "username and password required",
      });
    }

    const u = await dbFindUser(username);
    if (!u || u.is_active !== 1 || u.password_plain !== password) {
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: "invalid username/password",
      });
    }

    const credential = makeCredential();
    await dbCreateSession(u.id, credential, SESSION_TTL_MS);
    return callback(null, { credential });
  })().catch((e) => callback(e));
}

function Validate(call, callback) {
  (async () => {
    const { credential } = call.request || {};
    const username = await dbValidateCredential(credential || "");
    if (!username) return callback(null, { valid: false, username: "" });
    return callback(null, { valid: true, username });
  })().catch((e) => callback(e));
}

// Optional helper endpoints
function AddUser(call, callback) {
  (async () => {
    const { username, password } = call.request || {};
    if (!username || !password) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "username and password required",
      });
    }

    await dbPool.query(
      `INSERT INTO users (user_name, password_plain, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE password_plain=VALUES(password_plain), is_active=1`,
      [username, password]
    );

    return callback(null, { ok: true });
  })().catch((e) => callback(e));
}

function RemoveUser(call, callback) {
  (async () => {
    const { username } = call.request || {};
    if (!username) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "username required",
      });
    }

    // Soft-disable for perf stability
    await dbPool.query(`UPDATE users SET is_active=0 WHERE user_name=?`, [username]);
    return callback(null, { ok: true });
  })().catch((e) => callback(e));
}

function WhoIsLoggedIn(call, callback) {
  (async () => {
    const [rows] = await dbPool.query(
      `
      SELECT u.user_name AS username,
             s.credential AS credential,
             s.expires_at AS expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.is_active = 1
      ORDER BY s.expires_at DESC
      LIMIT 5000
      `
    );

    return callback(null, {
      sessions: rows.map((r) => ({
        username: r.username,
        credential: r.credential,
        expires_at_iso: new Date(r.expires_at).toISOString(),
      })),
    });
  })().catch((e) => callback(e));
}

// =============================
// GatewayService implementation
// =============================
function getCred(req) {
  return req?.auth?.credential || "";
}

function CreateRoom(call, callback) {
  (async () => {
    const cred = getCred(call.request);
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    if (rooms.has(room_name)) {
      return callback({ code: grpc.status.ALREADY_EXISTS, message: "room already exists" });
    }

    rooms.set(room_name, new Set());
    return callback(null, { ok: true, message: "OK" });
  })().catch((e) => callback(e));
}

function DeleteRoom(call, callback) {
  (async () => {
    const cred = getCred(call.request);
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    rooms.delete(room_name);
    return callback(null, { ok: true, message: "OK" });
  })().catch((e) => callback(e));
}

function EnterRoom(call, callback) {
  (async () => {
    const cred = getCred(call.request);
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    const person_name = call.request?.person_name;
    if (!room_name || !person_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name and person_name required",
      });
    }

    const people = ensureRoomExists(room_name);
    if (people.has(person_name)) {
      return callback({ code: grpc.status.ALREADY_EXISTS, message: "already in room" });
    }

    people.add(person_name);
    return callback(null, { ok: true, message: "OK" });
  })().catch((e) => callback(e));
}

function LeaveRoom(call, callback) {
  (async () => {
    const cred = getCred(call.request);
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    const person_name = call.request?.person_name;
    if (!room_name || !person_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name and person_name required",
      });
    }

    const people = ensureRoomExists(room_name);
    people.delete(person_name);
    return callback(null, { ok: true, message: "OK" });
  })().catch((e) => callback(e));
}

function GetPeople(call, callback) {
  (async () => {
    const cred = getCred(call.request);
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    const people = ensureRoomExists(room_name);
    return callback(null, { people: Array.from(people.values()) });
  })().catch((e) => callback(e));
}

// ------------- Subscribe (server streaming) -------------
function Subscribe(call) {
  (async () => {
    const cred = call.request?.auth?.credential || "";
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    if (!room_name) {
      call.emit("error", { code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
      call.end();
      return;
    }

    ensureMessagingRoom(room_name);

    const subs = roomSubscribers.get(room_name);
    subs.add(call);

    const cleanup = () => subs.delete(call);
    call.on("cancelled", cleanup);
    call.on("error", cleanup);
    call.on("close", cleanup);
    call.on("end", cleanup);
  })().catch((e) => {
    call.emit("error", e);
    call.end();
  });
}

// ------------- SendMessage (unary) -------------
function SendMessage(call, callback) {
  (async () => {
    const cred = call.request?.auth?.credential || "";
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    const person_name = call.request?.person_name;
    const text = call.request?.text;

    if (!room_name || !person_name || !text) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name, person_name, text are required",
      });
    }

    ensureMessagingRoom(room_name);

    const msg = {
      server_seq: ++GLOBAL_SEQ,
      person_name,
      text,
      ts_ms: Date.now(),
    };

    messageHistory.get(room_name).push(msg);

    const subs = roomSubscribers.get(room_name);
    for (const streamCall of subs) {
      try {
        streamCall.write({
          person_name: msg.person_name,
          text: msg.text,
          server_seq: msg.server_seq,
        });
      } catch (_) {}
    }

    return callback(null, { ok: true, message: "OK" });
  })().catch((e) => callback(e));
}

// ------------- GetHistory (unary) -------------
function GetHistory(call, callback) {
  (async () => {
    const cred = call.request?.auth?.credential || "";
    await validateCredentialOrThrowAsync(cred);

    const room_name = call.request?.room_name;
    const limit = call.request?.limit ?? 5;

    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    ensureMessagingRoom(room_name);

    const arr = messageHistory.get(room_name);
    const last = arr.slice(Math.max(0, arr.length - limit));

    return callback(null, {
      messages: last.map((m) => ({
        person_name: m.person_name,
        text: m.text,
        server_seq: m.server_seq,
      })),
    });
  })().catch((e) => callback(e));
}

// ==========================
// Boot both servers (2 ports)
// ==========================
function startServer(port, addServicesFn, name) {
  const server = new grpc.Server();
  addServicesFn(server);

  const addr = `0.0.0.0:${port}`;
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    server.start(); // IMPORTANT
    console.log(`${name} listening on ${addr}`);
  });
}

async function main() {
  dbPool = await connectWithRetry();
  await ensureSchemaExists(dbPool);

  // LoginService on 50051
  startServer(
    50051,
    (server) => {
      server.addService(auth.auth.LoginService.service, {
        Login,
        Validate,
        AddUser,
        RemoveUser,
        WhoIsLoggedIn,
      });
    },
    "Monolith LoginService"
  );

  // GatewayService on 50052
  startServer(
    50052,
    (server) => {
      server.addService(gw.gateway.GatewayService.service, {
        CreateRoom,
        DeleteRoom,
        EnterRoom,
        LeaveRoom,
        GetPeople,
        Subscribe,
        SendMessage,
        GetHistory,
      });
    },
    "Monolith GatewayService"
  );
}

main().catch((e) => {
  console.error("Monolith startup failed:", e);
  process.exit(1);
});