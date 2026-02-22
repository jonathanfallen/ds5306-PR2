"use strict";

const path = require("path");
const { startSpinner } = require("./util/progress");

const scenario = (process.env.SCENARIO || "1").trim();

const scenarioMap = {
  "1": "./scenarios/scenario1_login_single_user",
  "2": "./scenarios/scenario2_multiuser_login_and_gateway",
  "3": "./scenarios/scenario_3_area_51_test",

  // Login-only
  "4": "./scenarios/scenario4_login_10",
  "5": "./scenarios/scenario5_login_100",
  "6": "./scenarios/scenario6_login_1000",
  "7": "./scenarios/scenario7_login_5000",

  // Login + chat for 2 minutes
  "8": "./scenarios/scenario8_login_10_chat_2m",
  "9": "./scenarios/scenario9_login_100_chat_2m",
  "10": "./scenarios/scenario10_login_1000_chat_2m",
  "11": "./scenarios/scenario11_login_5000_chat_2m",
  
    // --- MONOLITH (mono_) ---

  // Mono: Login-only
  "104": "./scenarios/mono_4_login_10",
  "105": "./scenarios/mono_5_login_100",
  "106": "./scenarios/mono_6_login_1000",
  "107": "./scenarios/mono_7_login_5000",

  // Mono: Login + chat for 2 minutes
  "108": "./scenarios/mono_8_login_10_chat_2m",
  "109": "./scenarios/mono_9_login_100_chat_2m",
  "110": "./scenarios/mono_10_login_1000_chat_2m",
  "111": "./scenarios/mono_11_login_5000_chat_2m",
};

if (!scenarioMap[scenario]) {
  console.error(
    `Unknown SCENARIO="${scenario}". Valid: ${Object.keys(scenarioMap).join(", ")}`
  );
  process.exit(1);
}

console.log(`Tester: starting Scenario ${scenario}...`);

(async () => {
  const spinner = startSpinner(`Scenario ${scenario} running`);

  try {
    const modPath = path.resolve(__dirname, scenarioMap[scenario]);
    const scenarioModule = require(modPath);

    if (typeof scenarioModule.run !== "function") {
      spinner.fail(`Scenario ${scenario} invalid module`);
      console.error(`Scenario ${scenario} module must export: run({ env })`);
      process.exit(1);
    }

    await scenarioModule.run({ env: process.env });

    spinner.stop(`Scenario ${scenario} complete`);
    console.log(`Tester: Scenario ${scenario} complete.`);
    process.exit(0);
  } catch (err) {
    spinner.fail(`Scenario ${scenario} failed`);
    console.error("Tester failed:", err);
    process.exit(1);
  }
})();
