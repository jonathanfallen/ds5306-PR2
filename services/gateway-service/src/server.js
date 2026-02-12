const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const GW_PROTO = path.resolve("/contracts/proto/gateway.proto");
const AUTH_PROTO = path.resolve("/contracts/proto/auth.proto");
const CHAT_PROTO = path.resolve("/contracts/proto/chatroom.proto");

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

const gw = loadProto(GW_PROTO);
const auth = loadProto(AUTH_PROTO);
const chat = loadProto(CHAT_PROTO);

const LOGIN_HOST = process.env.LOGIN_HOST || "login-service";
const LOGIN_PORT = parseInt(process.env.LOGIN_PORT || "50051", 10);
const CHAT_HOST = process.env.CHAT_HOST || "chatroom-service";
const CHAT_PORT = parseInt(process.env.CHAT_PORT || "50053", 10);

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
  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return callback(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    chatClient.CreateRoom({ room_name }, (e, resp) => {
      if (e) return callback(e);
      callback(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    callback(e);
  }
}

async function DeleteRoom(call, callback) {
  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return callback(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    chatClient.DeleteRoom({ room_name }, (e, resp) => {
      if (e) return callback(e);
      callback(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    callback(e);
  }
}

async function EnterRoom(call, callback) {
  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return callback(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    const person_name = call.request.person_name;
    if (!room_name || !person_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name and person_name required",
      });
    }

    chatClient.EnterRoom({ room_name, person_name }, (e, resp) => {
      if (e) return callback(e);
      callback(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    callback(e);
  }
}

async function LeaveRoom(call, callback) {
  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return callback(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    const person_name = call.request.person_name;
    if (!room_name || !person_name) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "room_name and person_name required",
      });
    }

    chatClient.LeaveRoom({ room_name, person_name }, (e, resp) => {
      if (e) return callback(e);
      callback(null, { ok: !!resp?.ok, message: resp?.ok ? "OK" : "FAIL" });
    });
  } catch (e) {
    callback(e);
  }
}

async function GetPeople(call, callback) {
  const { cred, err } = getCredentialOrFail(call.request);
  if (err) return callback(err);

  try {
    await validateCredential(cred);

    const room_name = call.request.room_name;
    if (!room_name) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: "room_name required" });
    }

    chatClient.GetPeople({ room_name }, (e, resp) => {
      if (e) return callback(e);
      callback(null, { people: resp?.people || [] });
    });
  } catch (e) {
    callback(e);
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
  });

  const addr = "0.0.0.0:50052";
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    console.log(`GatewayService listening on ${addr}`);
  });
}

main();
