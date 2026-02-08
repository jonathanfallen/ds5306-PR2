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
  const USER_COUNT = parseInt(env.USER_COUNT || "5", 10);

  const authProto = loadProto("/contracts/proto/auth.proto");

  const loginClient = new authProto.auth.LoginService(
    LOGIN_ADDR,
    grpc.credentials.createInsecure()
  );

  console.log(`Scenario 2: login-only for ${USER_COUNT} users`);

  for (let i = 1; i <= USER_COUNT; i++) {
    const username = `user${i}`;
    const password = "pw";

    const res = await loginAsync(loginClient, username, password);
    console.log(`Scenario 2: ${username} -> credential="${res.credential}"`);
  }
}

module.exports = { run };
