const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({
    env,
    scenarioName: "mono_4_login_10",
    usersTotal: 10,
    mode: "login",
  });
}

module.exports = { run };