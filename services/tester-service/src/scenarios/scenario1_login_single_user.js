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

async function run({ env }) {
  const LOGIN_ADDR = env.LOGIN_ADDR || "login-service:50051";
  const authProto = loadProto("/contracts/proto/auth.proto");

  const loginClient = new authProto.auth.LoginService(
    LOGIN_ADDR,
    grpc.credentials.createInsecure()
  );

  const user = { username: "user1", password: "pw" };

  console.log("Scenario 1: login single user...");
  const res = await loginAsync(loginClient, user.username, user.password);
  console.log(`Scenario 1: ${user.username} -> credential="${res.credential}"`);
}

module.exports = { run };
