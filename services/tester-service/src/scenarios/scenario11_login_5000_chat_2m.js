const { runPerf } = require("./perf_common");

async function run({ env }) {
  return runPerf({ env, scenarioName: "11_login_5000_chat_2m", usersTotal: 5000, mode: "login_chat" });
}
module.exports = { run };
