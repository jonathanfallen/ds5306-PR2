const path = require("path");

const scenario = (process.env.SCENARIO || "1").trim();

const scenarioMap = {
  "1": "./scenarios/scenario1_login_single_user",
  "2": "./scenarios/scenario2_multiuser_login_and_gateway",
};

if (!scenarioMap[scenario]) {
  console.error(`Unknown SCENARIO="${scenario}". Valid: ${Object.keys(scenarioMap).join(", ")}`);
  process.exit(1);
}

console.log(`Tester: starting Scenario ${scenario}...`);

(async () => {
  const modPath = path.resolve(__dirname, scenarioMap[scenario]);
  const scenarioModule = require(modPath);

  if (typeof scenarioModule.run !== "function") {
    console.error(`Scenario ${scenario} module must export: run({ env })`);
    process.exit(1);
  }

  await scenarioModule.run({ env: process.env });
  console.log(`Tester: Scenario ${scenario} complete.`);
  process.exit(0);
})().catch((err) => {
  console.error("Tester failed:", err);
  process.exit(1);
});
