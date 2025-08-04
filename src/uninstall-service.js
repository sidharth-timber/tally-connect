const { Service } = require("node-windows");

const svc = new Service({
  name: "TallySyncAgent1",
  description: "Syncs invoices to Tally",
  script: "D:\\timber\\tallyPOC\\src\\agent.js",
});

svc.on("uninstall", () => {
  console.log("Service uninstalled successfully.");
});

svc.uninstall();
