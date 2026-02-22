const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({
    env,
    scenarioName: "mono_8_login_10_chat_2m",
    usersTotal: 10,
    mode: "login_chat",
  });
}

module.exports = { run };