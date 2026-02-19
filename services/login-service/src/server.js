const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const mysql = require("mysql2/promise");
const { v4: uuidv4 } = require("uuid");

const PROTO_PATH = path.resolve("/contracts/proto/auth.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef);

const TOKEN_TTL_MINUTES = parseInt(process.env.TOKEN_TTL_MINUTES || "60", 10);

let pool;

async function initDb() {
  pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "authuser",
    password: process.env.DB_PASSWORD || "authpw",
    database: process.env.DB_NAME || "authdb",
    waitForConnections: true,
    connectionLimit: 10,
  });
  await pool.query("SELECT 1");
}

function mysqlDateFromNow(minutes) {
  const d = new Date(Date.now() + minutes * 60 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function Login(call, callback) {
  try {
    const { username, password } = call.request;

    if (!username || !password) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "username and password are required",
      });
    }

    // plain-text password check (debug only)
    const [rows] = await pool.query(
      "SELECT id FROM users WHERE user_name = ? AND password_plain = ? AND is_active = 1",
      [username, password]
    );

    if (rows.length === 0) {
      return callback({
        code: grpc.status.UNAUTHENTICATED,
        message: "invalid credentials",
      });
    }

    const userId = rows[0].id;
    const credential = `cred-${uuidv4()}`;
    const expiresAt = mysqlDateFromNow(TOKEN_TTL_MINUTES);

    await pool.query(
      "INSERT INTO sessions (user_id, credential, expires_at) VALUES (?, ?, ?)",
      [userId, credential, expiresAt]
    );

    return callback(null, { credential });
  } catch (e) {
    return callback({
      code: grpc.status.INTERNAL,
      message: e.message || "internal error",
    });
  }
}

async function Validate(call, callback) {
  try {
    const { credential } = call.request;

    if (!credential) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "credential is required",
      });
    }

    const [rows] = await pool.query(
      `SELECT u.user_name, s.expires_at, s.revoked_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.credential = ?
       LIMIT 1`,
      [credential]
    );

    if (rows.length === 0) {
      return callback(null, { valid: false, username: "" });
    }

    const row = rows[0];
    const valid = !row.revoked_at && new Date(row.expires_at) > new Date();

    return callback(null, {
      valid,
      username: valid ? row.user_name : "",
    });
  } catch (e) {
    return callback({
      code: grpc.status.INTERNAL,
      message: e.message || "internal error",
    });
  }
}

async function AddUser(call, callback) {
  try {
    const { username, password } = call.request;

    if (!username || !password) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "username and password are required",
      });
    }

    await pool.query(
      "INSERT INTO users (user_name, password_plain) VALUES (?, ?)",
      [username, password]
    );

    return callback(null, { ok: true });
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("uq_users_user_name")) {
      return callback({
        code: grpc.status.ALREADY_EXISTS,
        message: "user already exists",
      });
    }
    return callback({
      code: grpc.status.INTERNAL,
      message: e.message || "internal error",
    });
  }
}

async function RemoveUser(call, callback) {
  try {
    const { username } = call.request;

    if (!username) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "username is required",
      });
    }

    const [u] = await pool.query("SELECT id FROM users WHERE user_name = ?", [
      username,
    ]);

    if (u.length === 0) {
      return callback(null, { ok: false });
    }

    const userId = u[0].id;

    // disable account + revoke sessions
    await pool.query("UPDATE users SET is_active = 0 WHERE id = ?", [userId]);
    await pool.query(
      "UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
      [userId]
    );

    return callback(null, { ok: true });
  } catch (e) {
    return callback({
      code: grpc.status.INTERNAL,
      message: e.message || "internal error",
    });
  }
}

async function WhoIsLoggedIn(call, callback) {
  try {
    const [rows] = await pool.query(
      `SELECT u.user_name, s.credential, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL
         AND s.expires_at > NOW()
       ORDER BY s.expires_at ASC`
    );

    return callback(null, {
      sessions: rows.map((r) => ({
        username: r.user_name,
        credential: r.credential,
        expires_at_iso: new Date(r.expires_at).toISOString(),
      })),
    });
  } catch (e) {
    return callback({
      code: grpc.status.INTERNAL,
      message: e.message || "internal error",
    });
  }
}

async function main() {
  await initDb();

  const server = new grpc.Server();
  server.addService(proto.auth.LoginService.service, {
    Login,
    Validate,
    AddUser,
    RemoveUser,
    WhoIsLoggedIn,
  });

  const addr = "0.0.0.0:50051";
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    console.log(`LoginService listening on ${addr}`);
    server.start();
  });
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
