require("dotenv").config();
const express = require('express');
const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { spawn } = require("child_process");
const crypto = require('crypto');



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
      name: "Nafa Enterprises",
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
  try {
    const companyId = req.query.companyId;
    if (!companyId) return res.status(400).send("Missing companyId");

    const buildId = crypto.randomUUID();
    const buildDir = path.join(__dirname, "installers", `build-${buildId}`);
    
    console.log("Creating build directory:", buildDir);
    await fs.mkdir(buildDir, { recursive: true });

    // Paths for source files
    const sourceAgentPath = path.join(__dirname, "agent", "TallyAgent.exe");
    const targetAgentPath = path.join(buildDir, "TallyAgent.exe");

    // Check if source agent exists
    if (!fs.existsSync(sourceAgentPath)) {
      console.error("Source TallyAgent.exe not found at:", sourceAgentPath);
      return res.status(500).send("Agent executable not found");
    }

    // Copy the pre-built TallyAgent.exe binary to build folder
    console.log("Copying agent from:", sourceAgentPath);
    console.log("Copying agent to:", targetAgentPath);
    await fs.copyFile(sourceAgentPath, targetAgentPath);

    // Write dynamic .env file
    const dynamicEnv = `COMPANY_ID=${companyId}
API_KEY=${process.env.API_KEY || ''}
SERVER_URL=${process.env.SERVER_URL || 'https://defaultserver.com'}
`;

    const envPath = path.join(buildDir, ".env");
    await fs.writeFile(envPath, dynamicEnv);
    console.log("Dynamic .env written to:", envPath);

    // Read installer.iss template
    const templatePath = path.join(__dirname, "templates", "installer.iss");
    
    if (!fs.existsSync(templatePath)) {
      console.error("Template not found at:", templatePath);
      return res.status(500).send("Installer template not found");
    }

    const issTemplate = await fs.readFile(templatePath, "utf-8");

    // Convert Windows path separators for ISS - use forward slashes or double backslashes
    const buildDirForIss = buildDir.replace(/\\/g, "/");
    const outputFilename = `TallyAgent-${companyId}`;

    // Create dynamic ISS content with proper variable definitions
    const dynamicIss = `; Auto-generated installer script
#define MyBuildDir "${buildDirForIss}"
#define OutputFilename "${outputFilename}"
#define CompanyId "${companyId}"

` + issTemplate;

    const dynamicIssPath = path.join(buildDir, "installer.iss");
    await fs.writeFile(dynamicIssPath, dynamicIss);
    console.log("Dynamic ISS file written to:", dynamicIssPath);

    // Run ISCC on dynamic installer.iss
    console.log("Starting ISCC compilation...");
    const iscc = spawn("ISCC", [dynamicIssPath], {
      cwd: buildDir,
      env: process.env,
      shell: true // Important for Windows
    });

    let stdout = '';
    let stderr = '';

    iscc.stdout.on("data", (data) => {
      const output = data.toString();
      console.log(`ISCC: ${output}`);
      stdout += output;
    });

    iscc.stderr.on("data", (data) => {
      const error = data.toString();
      console.error(`ISCC ERROR: ${error}`);
      stderr += error;
    });

    iscc.on("error", (error) => {
      console.error("Failed to start ISCC process:", error);
      return res.status(500).send("Failed to start installer compilation");
    });

    iscc.on("close", async (code) => {
      console.log(`ISCC exited with code ${code}`);
      
      if (stdout) console.log("ISCC stdout:", stdout);
      if (stderr) console.log("ISCC stderr:", stderr);

      if (code !== 0) {
        console.error("ISCC compilation failed with code:", code);
        return res.status(500).send(`Installer compilation failed. Exit code: ${code}`);
      }

      // The output file should be in the build directory
      const outputExe = path.join(buildDir, `${outputFilename}.exe`);
      console.log("Looking for installer at:", outputExe);

      if (!fs.existsSync(outputExe)) {
        console.error("Installer not found at expected location!");
        
        // List files in build directory for debugging
        try {
          const files = await fs.readdir(buildDir);
          console.log("Files in build directory:", files);
        } catch (e) {
          console.error("Could not list build directory:", e);
        }
        
        return res.status(500).send("Installer file not found after compilation");
      }

      console.log("Sending file:", outputExe);
      
      // Set proper headers
      res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}.exe"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      
      res.download(outputExe, `${outputFilename}.exe`, (err) => {
        if (err) {
          console.error("Error sending file:", err);
        } else {
          console.log("File sent successfully");
        }
        
        // Clean up build directory after a delay
        setTimeout(async () => {
          try {
            await fs.rm(buildDir, { recursive: true, force: true });
            console.log("Cleaned up build directory:", buildDir);
          } catch (cleanupError) {
            console.error("Failed to clean up build directory:", cleanupError);
          }
        }, 10000); // 10 seconds delay
      });
    });

  } catch (error) {
    console.error("Download route error:", error);
    return res.status(500).send(`Server error: ${error.message}`);
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