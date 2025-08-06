const { Service } = require("node-windows");

const svc = new Service({
  name: "TallyWinAgent3", // This must match your service display name exactly
  script: "C:\\Program Files (x86)\\TallyAgent\\daemon\\tallywinagent3.exe",
});

svc.on("uninstall", () => {
  console.log("Service uninstalled successfully.");
});

svc.uninstall();
