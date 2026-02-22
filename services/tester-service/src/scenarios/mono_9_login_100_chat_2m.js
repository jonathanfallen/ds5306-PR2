const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({
    env,
    scenarioName: "mono_9_login_100_chat_2m",
    usersTotal: 100,
    mode: "login_chat",
  });
}

module.exports = { run };