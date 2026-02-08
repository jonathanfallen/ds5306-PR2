const path = require("path");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const PROTO_PATH = path.resolve("/contracts/proto/gateway.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef);

// Stub validation: accept only credentials that start with "cred-"
function isValidCredential(credential) {
  return typeof credential === "string" && credential.startsWith("cred-");
}

function call(call, callback) {
  const req = call.request;

  if (!isValidCredential(req.credential)) {
    // Minimal response; later you can use proper gRPC status codes.
    return callback(null, { result: "DENY: invalid credential" });
  }

  // Stub routing: just echo what would be routed.
  const msg = `ALLOW: routing to ${req.service}.${req.method} payload="${req.payload}"`;
  callback(null, { result: msg });
}

function main() {
  const server = new grpc.Server();
  server.addService(proto.gateway.GatewayService.service, { Call: call });

  const addr = "0.0.0.0:50052";
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) throw err;
    console.log(`GatewayService listening on ${addr}`);
    server.start();
  });
}

main();
