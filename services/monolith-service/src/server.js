const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { v4: uuidv4 } = require("uuid");

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
// In-memory "DB" for monolith
// ==========================

// Users (demo/demo exists)
const users = new Map([
  ["demo", { username: "demo", password: "demo" }],
]);

// credential -> { username, expiresAtMs, revoked }
const sessions = new Map();

// room_name -> Set(person_name)
const rooms = new Map();

// session TTL (e.g., 60 minutes)
const SESSION_TTL_MS = 60 * 60 * 1000;

// ---------- Messaging state (Monolith) ----------
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


function makeCredential(username) {
  const credential = `cred-${uuidv4()}`;
  sessions.set(credential, {
    username,
    expiresAtMs: Date.now() + SESSION_TTL_MS,
    revoked: false,
  });
  return credential;
}

function validateCredentialOrThrow(credential) {
  if (!credential) {
    const err = new Error("credential required");
    err.code = grpc.status.UNAUTHENTICATED;
    throw err;
  }
  const s = sessions.get(credential);
  if (!s || s.revoked || Date.now() > s.expiresAtMs) {
    const err = new Error("invalid credential");
    err.code = grpc.status.UNAUTHENTICATED;
    throw err;
  }
  return s.username;
}

function ensureRoomExists(roomName) {
  if (!rooms.has(roomName)) rooms.set(roomName, new Set());
  return rooms.get(roomName);
}

// ==========================
// LoginService implementation
// ==========================
function Login(call, callback) {
  try {
    const { username, password } = call.request || {};
    if (!username || !password) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "username and password required",
      });
    }

    const u = users.get(username);
    if (!u || u.password !== password) {
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: "invalid username/password",
      });
    }

    const credential = makeCredential(username);
    return callback(null, { credential });
  } catch (e) {
    return callback(e);
  }
}

function Validate(call, callback) {
  try {
    const { credential } = call.request || {};
    try {
      const username = validateCredentialOrThrow(credential);
      return callback(null, { valid: true, username });
    } catch (e) {
      // For Validate, return valid=false rather than gRPC error
      return callback(null, { valid: false, username: "" });
    }
  } catch (e) {
    return callback(e);
  }
}

// Optional helper endpoints (not needed for your scenarios, but included)
function AddUser(call, callback) {
  const { username, password } = call.request || {};
  if (!username || !password) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: "username and password required",
    });
  }
  users.set(username, { username, password });
  return callback(null, { ok: true });
}

function RemoveUser(call, callback) {
  const { username } = call.request || {};
  if (!username) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: "username required",
    });
  }
  users.delete(username);
  return callback(null, { ok: true });
}

function WhoIsLoggedIn(call, callback) {
  const now = Date.now();
  const sessionsArr = [];
  for (const [cred, s] of sessions.entries()) {
    if (!s.revoked && now <= s.expiresAtMs) {
      sessionsArr.push({
        username: s.username,
        credential: cred,
        expires_at_iso: new Date(s.expiresAtMs).toISOString(),
      });
    }
  }
  return callback(null, { sessions: sessionsArr });
}

// =============================
// GatewayService implementation
// (direct calls, no other services)
// =============================

function getCred(req) {
  return req?.auth?.credential || "";
}

function CreateRoom(call, callback) {
  try {
    const cred = getCred(call.request);
    validateCredentialOrThrow(cred);

    const room_name = call.request?.room_name;
    if (!room_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name required",
      });
    }

    if (rooms.has(room_name)) {
      return callback({
        code: grpc.status.ALREADY_EXISTS,
        message: "room already exists",
      });
    }

    rooms.set(room_name, new Set());
    return callback(null, { ok: true, message: "OK" });
  } catch (e) {
    return callback(e);
  }
}

function DeleteRoom(call, callback) {
  try {
    const cred = getCred(call.request);
    validateCredentialOrThrow(cred);

    const room_name = call.request?.room_name;
    if (!room_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name required",
      });
    }

    rooms.delete(room_name);
    return callback(null, { ok: true, message: "OK" });
  } catch (e) {
    return callback(e);
  }
}

function EnterRoom(call, callback) {
  try {
    const cred = getCred(call.request);
    validateCredentialOrThrow(cred);

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
      return callback({
        code: grpc.status.ALREADY_EXISTS,
        message: "already in room",
      });
    }

    people.add(person_name);
    return callback(null, { ok: true, message: "OK" });
  } catch (e) {
    return callback(e);
  }
}

function LeaveRoom(call, callback) {
  try {
    const cred = getCred(call.request);
    validateCredentialOrThrow(cred);

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
  } catch (e) {
    return callback(e);
  }
}

function GetPeople(call, callback) {
  try {
    const cred = getCred(call.request);
    validateCredentialOrThrow(cred);

    const room_name = call.request?.room_name;
    if (!room_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name required",
      });
    }

    const people = ensureRoomExists(room_name);
    return callback(null, { people: Array.from(people.values()) });
  } catch (e) {
    return callback(e);
  }
}
//Monolith

// ------------- NEW: Subscribe (server streaming) -------------
function Subscribe(call) {
  try {
    const cred = call.request?.auth?.credential || "";
    validateCredentialOrThrow(cred);

    const room_name = call.request?.room_name;
    const person_name = call.request?.person_name || "unknown";

    if (!room_name) {
      call.emit("error", {
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name required",
      });
      call.end();
      return;
    }

    ensureMessagingRoom(room_name);

    const subs = roomSubscribers.get(room_name);
    subs.add(call);

    // cleanup when client disconnects
    const cleanup = () => subs.delete(call);
    call.on("cancelled", cleanup);
    call.on("error", cleanup);
    call.on("close", cleanup);
    call.on("end", cleanup);

  } catch (e) {
    call.emit("error", e);
    call.end();
  }
}

// ------------- NEW: SendMessage (unary) -------------
function SendMessage(call, callback) {
  try {
    const cred = call.request?.auth?.credential || "";
    validateCredentialOrThrow(cred);

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

    // store history
    messageHistory.get(room_name).push(msg);

    // broadcast to subscribers
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
  } catch (e) {
    return callback(e);
  }
}

// ------------- NEW: GetHistory (unary) -------------
function GetHistory(call, callback) {
  try {
    const cred = call.request?.auth?.credential || "";
    validateCredentialOrThrow(cred);

    const room_name = call.request?.room_name;
    const limit = call.request?.limit ?? 5;

    if (!room_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name required",
      });
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
  } catch (e) {
    return callback(e);
  }
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
    console.log(`${name} listening on ${addr}`);
  });
}

function main() {
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

main();
