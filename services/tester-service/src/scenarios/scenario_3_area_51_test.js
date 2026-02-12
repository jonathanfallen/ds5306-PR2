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

function createRoomAsync(gatewayClient, credential, roomName) {
  return new Promise((resolve, reject) => {
    gatewayClient.CreateRoom(
      { auth: { credential }, room_name: roomName },
      (err, res) => {
        // CreateRoom can legitimately return ALREADY_EXISTS if re-run
        if (err) return reject(err);
        resolve(res);
      }
    );
  });
}

function enterRoomAsync(gatewayClient, credential, roomName, personName) {
  return new Promise((resolve, reject) => {
    gatewayClient.EnterRoom(
      { auth: { credential }, room_name: roomName, person_name: personName },
      (err, res) => {
        if (err) return reject(err);
        resolve(res);
      }
    );
  });
}

function leaveRoomAsync(gatewayClient, credential, roomName, personName) {
  return new Promise((resolve, reject) => {
    gatewayClient.LeaveRoom(
      { auth: { credential }, room_name: roomName, person_name: personName },
      (err, res) => {
        if (err) return reject(err);
        resolve(res);
      }
    );
  });
}

function getPeopleAsync(gatewayClient, credential, roomName) {
  return new Promise((resolve, reject) => {
    gatewayClient.GetPeople(
      { auth: { credential }, room_name: roomName },
      (err, res) => {
        if (err) return reject(err);
        resolve(res);
      }
    );
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

  console.log('Scenario 3: "Area 51" end-to-end test...');

  // 1) Login
  console.log(`1) Login as "${user.username}"...`);
  const loginRes = await loginAsync(loginClient, user.username, user.password);
  const cred = loginRes.credential;
  console.log(`   -> credential="${cred}"`);
  assert(typeof cred === "string" && cred.length > 0, "credential must be returned");

  // 2) Create room
  console.log(`2) Create room "${roomName}"...`);
  try {
    const r = await createRoomAsync(gatewayClient, cred, roomName);
    console.log(`   -> ok=${r.ok} message="${r.message}"`);
  } catch (e) {
    // If you re-run the scenario, CreateRoom may return ALREADY_EXISTS.
    if (e.code === grpc.status.ALREADY_EXISTS) {
      console.log("   -> room already exists (OK for re-run)");
    } else {
      throw e;
    }
  }

  // 3) demo enters
  console.log(`3) "${user.username}" enters "${roomName}"...`);
  try {
    const r = await enterRoomAsync(gatewayClient, cred, roomName, user.username);
    console.log(`   -> ok=${r.ok} message="${r.message}"`);
  } catch (e) {
    // If rerun without leaving previously, EnterRoom may return ALREADY_EXISTS.
    if (e.code === grpc.status.ALREADY_EXISTS) {
      console.log("   -> already in room (OK for re-run)");
    } else {
      throw e;
    }
  }

  // 4) Get people (should contain demo)
  console.log(`4) Get people in "${roomName}"...`);
  const people1 = await getPeopleAsync(gatewayClient, cred, roomName);
  console.log(`   -> people=${JSON.stringify(people1.people || [])}`);
  assert(
    Array.isArray(people1.people) && people1.people.includes(user.username),
    `"${user.username}" should be in the room`
  );

  // 5) demo leaves
  console.log(`5) "${user.username}" leaves "${roomName}"...`);
  const leaveRes = await leaveRoomAsync(gatewayClient, cred, roomName, user.username);
  console.log(`   -> ok=${leaveRes.ok} message="${leaveRes.message}"`);

  // 6) Get people again (should NOT contain demo)
  console.log(`6) Get people in "${roomName}" after leave...`);
  const people2 = await getPeopleAsync(gatewayClient, cred, roomName);
  console.log(`   -> people=${JSON.stringify(people2.people || [])}`);
  assert(
    Array.isArray(people2.people) && !people2.people.includes(user.username),
    `"${user.username}" should NOT be in the room after leaving`
  );

  // 7) invalid credential test ("carl")
  console.log('7) Invalid credential test using "carl"...');
  try {
    await getPeopleAsync(gatewayClient, "carl", roomName);
    throw new Error("Expected UNAUTHENTICATED, but request succeeded");
  } catch (e) {
    assert(
      e.code === grpc.status.UNAUTHENTICATED,
      `expected UNAUTHENTICATED, got code=${e.code} details=${e.details}`
    );
    console.log(`   -> PASS (UNAUTHENTICATED): ${e.details}`);
  }

  console.log('Scenario 3: PASS ✅');
}

module.exports = { run };
