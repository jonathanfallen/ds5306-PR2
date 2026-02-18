const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const mysql = require("mysql2/promise");

const PORT = process.env.PORT || "50054";

const DB_HOST = process.env.DB_HOST || "chatroom-db";
const DB_PORT = parseInt(process.env.DB_PORT || "3306", 10);
const DB_USER = process.env.DB_USER || "chatuser";
const DB_PASSWORD = process.env.DB_PASSWORD || "chatpw";
const DB_NAME = process.env.DB_NAME || "chatdb";

const PROTO_PATH = "/contracts/proto/chat.proto";




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

const chat = loadProto(PROTO_PATH);

let pool;

// room_name -> Set(streamCall)
const subscribers = new Map();
function roomSet(room) {
  if (!subscribers.has(room)) subscribers.set(room, new Set());
  return subscribers.get(room);
}

async function SendMessage(call, callback) {
  try {
    const { room_name, person_name, text, client_ts_ms, msg_id } = call.request;

    if (!room_name || !person_name || !text) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name, person_name, text required",
      });
    }

    const server_ts_ms = Date.now();

    const conn = await pool.getConnection();
    try {
      const [res] = await conn.execute(
        `INSERT INTO messages (room_name, person_name, text, msg_id, client_ts_ms, server_ts_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [room_name, person_name, text, msg_id || null, client_ts_ms || null, server_ts_ms]
      );

      const server_seq = Number(res.insertId);

      const msg = {
        room_name,
        person_name,
        text,
        server_seq,
        client_ts_ms: Number(client_ts_ms || 0),
        server_ts_ms: Number(server_ts_ms),
        msg_id: msg_id || "",
      };

      // Broadcast realtime
      const set = roomSet(room_name);
      for (const s of set) {
        try {
          s.write(msg);
        } catch {
          set.delete(s);
        }
      }

      return callback(null, {
        ok: true,
        message: "OK",
        server_seq,
        server_ts_ms,
      });
    } finally {
      conn.release();
    }
  } catch (e) {
    return callback(e);
  }
}

function Subscribe(call) {
  const { room_name } = call.request;
  if (!room_name) {
    call.destroy(new Error("room_name required"));
    return;
  }

  const set = roomSet(room_name);
  set.add(call);

  const cleanup = () => set.delete(call);
  call.on("cancelled", cleanup);
  call.on("close", cleanup);
  call.on("error", cleanup);
}

async function GetHistory(call, callback) {
  try {
    const { room_name, limit } = call.request;
    if (!room_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: "room_name required",
      });
    }

    // ✅ clamp + ép kiểu số
    const lim = Math.max(1, Math.min(200, Number(limit ?? 20)));

    const conn = await pool.getConnection();
    try {
      // ✅ IMPORTANT: không dùng LIMIT ? (MySQL hay lỗi prepared stmt)
      const sql = `
        SELECT id, room_name, person_name, text, msg_id, client_ts_ms, server_ts_ms
        FROM messages
        WHERE room_name = ?
        ORDER BY id DESC
        LIMIT ${lim}
      `;

      const [rows] = await conn.execute(sql, [room_name]);

      const messages = rows
        .map((r) => ({
          room_name: r.room_name,
          person_name: r.person_name,
          text: r.text,
          server_seq: Number(r.id),
          client_ts_ms: Number(r.client_ts_ms || 0),
          server_ts_ms: Number(r.server_ts_ms || 0),
          msg_id: r.msg_id || "",
        }))
        .reverse();

      return callback(null, { messages });
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error("[GetHistory] error:", e); // ✅ để thấy log thật
    return callback({
      code: grpc.status.UNKNOWN,
      details: e.message || "GetHistory failed",
    });
  }
}


async function main() {
  pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
  });

  const server = new grpc.Server();
  server.addService(chat.chatmsg.ChatService.service, {
    SendMessage,
    Subscribe,
    GetHistory,
  });

  const addr = `0.0.0.0:${PORT}`;
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    server.start();
    console.log(`ChatService listening on ${addr}`);
  });
}

main().catch((e) => {
  console.error("chat-service failed:", e);
  process.exit(1);
});
