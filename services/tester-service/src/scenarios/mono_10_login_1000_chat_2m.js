const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({
    env,
    scenarioName: "mono_10_login_1000_chat_2m",
    usersTotal: 1000,
    mode: "login_chat",
  });
}

module.exports = { run };