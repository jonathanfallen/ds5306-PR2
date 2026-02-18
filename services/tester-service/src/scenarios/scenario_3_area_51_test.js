const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

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

function loginAsync(loginClient, username, password) {
  return new Promise((resolve, reject) => {
    loginClient.Login({ username, password }, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

function unaryAsync(fn, req) {
  return new Promise((resolve, reject) => {
    fn(req, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run({ env }) {
  const LOGIN_ADDR = env.LOGIN_ADDR || "login-service:50051";
  const GATEWAY_ADDR = env.GATEWAY_ADDR || "gateway-service:50052";

  const authProto = loadProto("/contracts/proto/auth.proto");
  const gwProto = loadProto("/contracts/proto/gateway.proto");

  const loginClient = new authProto.auth.LoginService(
    LOGIN_ADDR,
    grpc.credentials.createInsecure()
  );

  const gatewayClient = new gwProto.gateway.GatewayService(
    GATEWAY_ADDR,
    grpc.credentials.createInsecure()
  );

  const user = { username: "demo", password: "demo" };
  const roomName = "Area 51";

  console.log('Scenario 3: "Area 51" end-to-end (+ messaging) test...');

  // 1) Login
  const loginRes = await loginAsync(loginClient, user.username, user.password);
  const cred = loginRes.credential;
  console.log(`1) Login -> credential="${cred}"`);
  assert(cred && cred.length > 0, "credential must be returned");

  // 2) Create room (ok if already exists)
  console.log(`2) Create room "${roomName}"...`);
  try {
    const r = await unaryAsync(gatewayClient.CreateRoom.bind(gatewayClient), {
      auth: { credential: cred },
      room_name: roomName,
    });
    console.log(`   -> ok=${r.ok} message="${r.message}"`);
  } catch (e) {
    if (e.code === grpc.status.ALREADY_EXISTS) {
      console.log("   -> room already exists (OK for re-run)");
    } else throw e;
  }

  // 3) Enter room (ok if already in)
  console.log(`3) Enter room "${roomName}" as "${user.username}"...`);
  try {
    const r = await unaryAsync(gatewayClient.EnterRoom.bind(gatewayClient), {
      auth: { credential: cred },
      room_name: roomName,
      person_name: user.username,
    });
    console.log(`   -> ok=${r.ok} message="${r.message}"`);
  } catch (e) {
    if (e.code === grpc.status.ALREADY_EXISTS) {
      console.log("   -> already in room (OK for re-run)");
    } else throw e;
  }

// 4) Subscribe realtime
console.log("4) Subscribe realtime stream...");
const stream = gatewayClient.Subscribe({
  auth: { credential: cred },
  room_name: roomName,
  person_name: user.username,
});

const received = [];

stream.on("data", (m) => {
  received.push(m);
  console.log(`   [stream] ${m.person_name}: ${m.text} (seq=${m.server_seq})`);
});

// ✅ ADD THIS: prevent "Unhandled 'error' event"
stream.on("error", (err) => {
  // grpc.status.CANCELLED = 1 -> thường là expected khi client cancel / invalid credential test
  if (err && err.code === 1) return;
  console.error("   [stream error]", err);
});

// (optional but nice)
stream.on("end", () => console.log("   [stream] ended"));
stream.on("close", () => console.log("   [stream] closed"));


  // 5) Send 2 messages
  console.log("5) Send messages...");
  await unaryAsync(gatewayClient.SendMessage.bind(gatewayClient), {
    auth: { credential: cred },
    room_name: roomName,
    person_name: user.username,
    text: "hello from Area 51",
    client_ts_ms: Date.now(),
  });

  await unaryAsync(gatewayClient.SendMessage.bind(gatewayClient), {
    auth: { credential: cred },
    room_name: roomName,
    person_name: user.username,
    text: "second message",
    client_ts_ms: Date.now(),
  });

  // wait a bit for stream delivery
  await new Promise((r) => setTimeout(r, 600));

  assert(received.length >= 2, "should receive at least 2 streamed messages");

  // 6) History (last 5)
  console.log("6) GetHistory(last 5)...");
  const hist = await unaryAsync(gatewayClient.GetHistory.bind(gatewayClient), {
    auth: { credential: cred },
    room_name: roomName,
    limit: 5,
  });
  console.log(`   -> history_count=${hist.messages.length}`);
  assert(hist.messages.length >= 2, "history should contain at least 2 messages");

  // 7) Leave room
  console.log("7) Leave room...");
  const leaveRes = await unaryAsync(gatewayClient.LeaveRoom.bind(gatewayClient), {
    auth: { credential: cred },
    room_name: roomName,
    person_name: user.username,
  });
  console.log(`   -> ok=${leaveRes.ok} message="${leaveRes.message}"`);

  // close stream
  stream.cancel();

  // 8) Invalid credential test
  console.log('8) Invalid credential test ("carl")...');
  try {
    await unaryAsync(gatewayClient.GetPeople.bind(gatewayClient), {
      auth: { credential: "carl" },
      room_name: roomName,
    });
    throw new Error("Expected UNAUTHENTICATED, but request succeeded");
  } catch (e) {
    assert(e.code === grpc.status.UNAUTHENTICATED, `expected UNAUTHENTICATED, got code=${e.code}`);
    console.log(`   -> PASS (UNAUTHENTICATED): ${e.details}`);
  }

  console.log("Scenario 3: PASS ✅");
}

module.exports = { run };
