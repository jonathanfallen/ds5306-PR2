const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({
    env,
    scenarioName: "mono_5_login_100",
    usersTotal: 100,
    mode: "login",
  });
}

module.exports = { run };