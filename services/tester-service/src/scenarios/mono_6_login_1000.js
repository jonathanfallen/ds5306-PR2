const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({
    env,
    scenarioName: "mono_6_login_1000",
    usersTotal: 1000,
    mode: "login",
  });
}

module.exports = { run };