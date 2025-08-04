const Service = require("node-windows").Service;

const svc = new Service({
  name: "TallySyncAgent",
  description: "Syncs invoices to Tally",
  script: "D:\timber\tally-agent\agent.js",
  nodeOptions: ["--harmony", "--max_old_space_size=4096"],
});

svc.on("install", () => {
  svc.start();
});
svc.install();