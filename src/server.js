require("dotenv").config();
const express = require('express');
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