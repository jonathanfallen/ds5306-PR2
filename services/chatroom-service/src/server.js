const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const mysql = require("mysql2/promise");

const PROTO_PATH = path.resolve("/contracts/proto/chatroom.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef);

let pool;

async function initDb() {
  pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "chatuser",
    password: process.env.DB_PASSWORD || "chatpw",
    database: process.env.DB_NAME || "chatdb",
    waitForConnections: true,
    connectionLimit: 10,
  });
  await pool.query("SELECT 1");
}

async function getRoomIdByName(roomName) {
  const [rows] = await pool.query(
    "SELECT id FROM chat_rooms WHERE room_name = ? LIMIT 1",
    [roomName]
  );
  return rows.length ? rows[0].id : null;
}

async function CreateRoom(call, callback) {
  try {
    const { room_name } = call.request;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }
    await pool.query("INSERT INTO chat_rooms (room_name) VALUES (?)", [room_name]);
    callback(null, { ok: true });
  } catch (e) {
    if (String(e.message || "").includes("uq_chat_rooms_room_name")) {
      return callback({ code: grpc.status.ALREADY_EXISTS, message: "room name already exists" });
    }
    callback({ code: grpc.status.INTERNAL, message: e.message || "internal error" });
  }
}

async function DeleteRoom(call, callback) {
  try {
    const { room_name } = call.request;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }
    const [res] = await pool.query("DELETE FROM chat_rooms WHERE room_name = ?", [room_name]);
    callback(null, { ok: res.affectedRows > 0 });
  } catch (e) {
    callback({ code: grpc.status.INTERNAL, message: e.message || "internal error" });
  }
}

async function EnterRoom(call, callback) {
  try {
    const { room_name, person_name } = call.request;
    if (!room_name || !person_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name and person_name required" });
    }
    const roomId = await getRoomIdByName(room_name);
    if (!roomId) {
      return callback({ code: grpc.status.NOT_FOUND, message: "room not found" });
    }

    await pool.query(
      "INSERT INTO room_people (room_id, person_name) VALUES (?, ?)",
      [roomId, person_name]
    );

    callback(null, { ok: true });
  } catch (e) {
    // duplicate entry means already in room
    if (String(e.message || "").toLowerCase().includes("duplicate")) {
      return callback({ code: grpc.status.ALREADY_EXISTS, message: "person already in room" });
    }
    callback({ code: grpc.status.INTERNAL, message: e.message || "internal error" });
  }
}

async function LeaveRoom(call, callback) {
  try {
    const { room_name, person_name } = call.request;
    if (!room_name || !person_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name and person_name required" });
    }
    const roomId = await getRoomIdByName(room_name);
    if (!roomId) {
      return callback({ code: grpc.status.NOT_FOUND, message: "room not found" });
    }

    const [res] = await pool.query(
      "DELETE FROM room_people WHERE room_id = ? AND person_name = ?",
      [roomId, person_name]
    );

    callback(null, { ok: res.affectedRows > 0 });
  } catch (e) {
    callback({ code: grpc.status.INTERNAL, message: e.message || "internal error" });
  }
}

async function GetPeople(call, callback) {
  try {
    const { room_name } = call.request;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }
    const roomId = await getRoomIdByName(room_name);
    if (!roomId) {
      return callback({ code: grpc.status.NOT_FOUND, message: "room not found" });
    }

    const [rows] = await pool.query(
      "SELECT person_name FROM room_people WHERE room_id = ? ORDER BY joined_at ASC",
      [roomId]
    );

    callback(null, { people: rows.map(r => r.person_name) });
  } catch (e) {
    callback({ code: grpc.status.INTERNAL, message: e.message || "internal error" });
  }
}

async function main() {
  await initDb();

  const server = new grpc.Server();
  server.addService(proto.chat.ChatroomService.service, {
    CreateRoom,
    DeleteRoom,
    EnterRoom,
    LeaveRoom,
    GetPeople,
  });

  const addr = "0.0.0.0:50053";
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    console.log(`ChatroomService listening on ${addr}`);
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
