require("dotenv").config();
const express = require('express');
const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { spawn } = require("child_process");



const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

let invoices=[
{
    _id: "685d491e4e1c98e6a242d3c0",
    user: "6777a7ab5cd5d327209fa1db",
    company: "6777a90c5cd5d327209fa239",
    payment_method: "bank",
    title: "Invoice for June Services",
    biller: {
      name: "Timber Technologies",
      email: "billing@timber.me",
      country_code: "+971",
      mobile: "509876543",
      address: "15 Sheikh Zayed Road, Dubai, UAE",
      trn: "200987654300002",
      biller_id: null
    },
    customer: {
      name: "John Doe Enterprises",
      email: "john@doe.com",
      country_code: "+971",
      mobile: "501234567",
      address: "123 Business Bay, Dubai, UAE",
      trn: "100123456700003",
      customer_id: null
    },
    invoice_date: "2025-06-01T00:00:00.000Z",
    due_date: "2025-06-30T00:00:00.000Z",
    invoice_number: "INV-2025-022",
    place_of_supply: "UAE",
    currency: "AED",
    items: [
      { title: "Website Development", quantity: 1, rate: 5000, vat: 0, discount: 0, total: 5000 },
      { title: "Monthly Hosting", quantity: 1, rate: 300, vat: 0, discount: 0, total: 300 }
    ],
    notes: "Thank you for your business!",
    terms: "Payment due within 30 days of invoice date.",
    sub_total: 5300,
    vat_total: 0,
    discount_total: 0,
    shipping: 0,
    total: 5300,
    amount_paid: 5300,
    amount_due: 0,
    postdated_payment: 0,
    logo: "https://storagetimberuat.blob.core.windows.net/timberstorage/invoice/logo/logo_4fc8d63b18dd5355.png?...",
    status: "pending",
    is_deleted: false,
    guidelines: [],
    created_at: "2025-06-26T13:20:30.746Z",
    updated_at: "2025-07-31T06:34:43.616Z",
    __v: 0
  }
]

app.get("/download", async (req, res) => {
  console.log("[download] Request received, query:", req.query);
  try {
    const companyId = req.query.companyId;
    if (!companyId) {
      console.log("[download] Missing companyId");
      return res.status(400).send("Missing companyId");
    }

    const buildId = uuidv4();
    const buildDir = path.join(__dirname, "installers", `build-${buildId}`);
    console.log("[download] buildDir:", buildDir);

    await fs.mkdir(buildDir, { recursive: true });
    console.log("[download] buildDir created");

    console.log("[download] Copying agent.js...");
    await fs.copyFile(
      path.join(__dirname, "templates", "agent.js"),
      path.join(buildDir, "agent.js")
    );

    console.log("[download] Copying tally-pull.js...");
    await fs.copyFile(
      path.join(__dirname, "templates", "tally-pull.js"),
      path.join(buildDir, "tally-pull.js")
    );

    console.log("[download] Copying install-service.js...");
    await fs.copyFile(
      path.join(__dirname, "templates", "install-service.js"),
      path.join(buildDir, "install-service.js")
    );

    console.log("[download] Copying package.json...");
    await fs.copyFile(
      path.join(__dirname, "templates", "package.json"),
      path.join(buildDir, "package.json")
    );

    console.log("[download] Copying node_modules (this may take a while)...");
    await fs.copy(
      path.join(__dirname, "templates", "node_modules"),
      path.join(buildDir, "node_modules"),
      { overwrite: false, errorOnExist: false }
    );
    console.log("[download] node_modules copied");

    const dynamicEnv = `COMPANY_ID=${companyId}\nAPI_KEY=${process.env.API_KEY}\nSERVER_URL=${process.env.SERVER_URL || 'https://defaultserver.com'}\n`;
    await fs.writeFile(path.join(buildDir, ".env"), dynamicEnv);
    console.log("[download] .env written");

    const issTemplatePath = path.join(__dirname, "templates", "installer.iss");
    console.log("[download] Reading installer.iss from:", issTemplatePath);
    const issTemplate = await fs.readFile(issTemplatePath, "utf-8");

    const dynamicIss = issTemplate
      .replace(/OutputDir=.*/g, `OutputDir=${buildDir.replace(/\\/g, "\\\\")}`)
      .replace(/OutputBaseFilename=.*/g, `OutputBaseFilename=TallyAgent-${companyId}`);

    const dynamicIssPath = path.join(buildDir, "installer.iss");
    await fs.writeFile(dynamicIssPath, dynamicIss);
    console.log("[download] dynamic installer.iss written:", dynamicIssPath);
    console.log("[download] ISS content:\n", dynamicIss);

    const isccPath = process.env.ISCC_PATH || "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe";
    console.log("[download] Spawning ISCC:", isccPath);
    console.log("[download] ISCC exists:", fs.existsSync(isccPath));

    const iscc = spawn(isccPath, [dynamicIssPath], {
      cwd: buildDir,
      env: process.env,
    });

    iscc.on("error", (err) => {
      console.error("[download] Failed to spawn ISCC:", err.message);
      if (!res.headersSent) res.status(500).send(`ISCC spawn failed: ${err.message}`);
    });

    iscc.stdout.on("data", (data) => console.log(`[ISCC] ${data}`));
    iscc.stderr.on("data", (data) => console.error(`[ISCC ERROR] ${data}`));

    iscc.on("close", (code) => {
      console.log(`[download] ISCC exited with code ${code}`);
      if (code !== 0) {
        return res.status(500).send(`Installer compilation failed (ISCC exit code ${code})`);
      }

      const outputExe = path.join(buildDir, `TallyAgent-${companyId}.exe`);
      console.log("[download] Looking for exe:", outputExe);
      console.log("[download] Exe exists:", fs.existsSync(outputExe));

      if (!fs.existsSync(outputExe)) {
        return res.status(500).send("Installer .exe not found after compilation.");
      }

      console.log("[download] Sending file to client...");
      res.download(outputExe, `TallyAgent-${companyId}.exe`, (err) => {
        if (err) console.error("[download] res.download error:", err.message);
        else console.log("[download] File sent successfully");
      });
    });

  } catch (error) {
    console.error("[download] Caught error:", error);
    if (!res.headersSent) res.status(500).send(`Server error: ${error.message}`);
  }
});



app.post('/webhook', (req, res) => {
  const { event, data, apiKey } = req.body;
  console.log(event, data, apiKey,'webhook called');

  // ✅ 1. Auth check
  if (apiKey !== process.env.API_KEY) {
    console.log("Unauthorized",process.env.API_KEY);
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (event === "sync-request") {
    console.log("Sync request received");
    // 📨 Send pending invoices
    const pending = invoices.filter(i => i.status === "pending");
    return res.json({ invoices: pending });
  }

  if (event === "sync-status") {
    console.log("Sync status received");
    // 🛠 Update invoice sync status
    const { invoiceId, status, error } = data;
    console.log(invoiceId, status, error);
    invoices = invoices.map(inv =>
      inv._id === invoiceId ? { ...inv, status, error } : inv
    );
    return res.json({ updated: true });
  }

  res.status(400).json({ error: "Unknown event" });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});