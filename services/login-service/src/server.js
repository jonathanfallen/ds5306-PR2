const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const PROTO_PATH = path.resolve("/contracts/proto/auth.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef);

function login(call, callback) {
  const { username } = call.request;
  // Stub: always "authenticates" and returns a fake credential.
  const credential = `cred-${username || "anon"}-demo`;
  callback(null, { credential });
}

function main() {
  const server = new grpc.Server();
  server.addService(proto.auth.LoginService.service, { Login: login });

  const addr = "0.0.0.0:50051";
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    console.log(`LoginService listening on ${addr}`);
    server.start();
  });
}

main();
