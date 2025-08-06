const Service = require("node-windows").Service;
const path = require("path");
const installDir = process.cwd();

const svc = new Service({
  name: "TallyWinAgent3",
  description: "Syncs invoices to Tally",
  script: path.join(installDir, "agent.js"),
  workingDirectory: installDir,   // 👈 ensures .env is picked from here
  nodeOptions: ["--harmony", "--max_old_space_size=4096"],
});

svc.on("install", () => {
  svc.start();
});
svc.install();