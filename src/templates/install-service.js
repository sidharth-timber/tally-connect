require("dotenv").config();
const Service = require("node-windows").Service;
const path = require("path");
const installDir = process.cwd();

// Use CA_KEY-based name (new) or legacy COMPANY_ID-based name to avoid
// service name collisions when multiple agents are installed on the same machine.
const caKey = process.env.CA_KEY;
const companyId = process.env.COMPANY_ID;
const agentSuffix = caKey
  ? caKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)
  : (companyId ? companyId.slice(0, 20) : 'default');
const serviceName = `TallyAgent-${agentSuffix}`;

const svc = new Service({
  name: serviceName,
  description: "Timber Tally Agent — syncs financial data to Tally Prime",
  script: path.join(installDir, "agent.js"),
  workingDirectory: installDir,
  nodeOptions: ["--harmony", "--max_old_space_size=4096"],
});

svc.on("install", () => {
  svc.start();
});
svc.install();