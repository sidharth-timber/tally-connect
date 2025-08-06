const Service = require("node-windows").Service;
const path = require("path");

const svc = new Service({
  name: "TallyWinAgent",
  description: "Syncs invoices to Tally",
   script: path.join(__dirname, "agent.js"),
  nodeOptions: ["--harmony", "--max_old_space_size=4096"],
});

svc.on("install", () => {
  svc.start();
});
svc.install();