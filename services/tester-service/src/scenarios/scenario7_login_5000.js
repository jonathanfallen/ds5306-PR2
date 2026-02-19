const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({ env, scenarioName: "7_login_5000", usersTotal: 5000, mode: "login" });
}
module.exports = { run };
