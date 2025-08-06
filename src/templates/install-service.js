const Service = require("node-windows").Service;
const path = require("path");
const installDir = path.dirname(process.execPath);

const svc = new Service({
  name: "TallyWinAgent",
  description: "Syncs invoices to Tally",
   script: path.join(installDir, "agent.js"),
  workingDirectory: installDir,  
  nodeOptions: ["--harmony", "--max_old_space_size=4096"],
});

svc.on("install", () => {
  svc.start();
});
svc.install();