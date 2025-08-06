package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/beevik/etree"
	"github.com/joho/godotenv"
)

var (
	serverURL string
	apiKey    string
	tallyURL  = "http://localhost:9000"
	logger    *log.Logger
)

func init() {
	// Create logger first
	logFile, err := os.OpenFile(`C:\TallyAgent-run-log.txt`, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Printf("❌ Failed to open log file: %v\n", err)
		logger = log.New(os.Stdout, "", log.LstdFlags)
	} else {
		logger = log.New(logFile, "", log.LstdFlags)
	}

	logger.Println("🚀 Agent initializing...")

	// Load environment variables with better path detection
	loadEnvironmentVariables()

	logger.Println("🔄 Agent initialization completed.")
}

func loadEnvironmentVariables() {
	// Get current working directory
	pwd, _ := os.Getwd()
	logger.Printf("📁 Working directory: %s", pwd)

	// Get executable path
	exePath, err := os.Executable()
	if err != nil {
		logger.Printf("⚠️  Could not get executable path: %v", err)
	} else {
		exeDir := filepath.Dir(exePath)
		logger.Printf("📁 Executable directory: %s", exeDir)
	}

	// Try multiple possible .env locations in order of preference
	envPaths := []string{}
	
	if exePath != "" {
		exeDir := filepath.Dir(exePath)
		envPaths = append(envPaths, filepath.Join(exeDir, ".env"))
	}
	
	envPaths = append(envPaths, 
		".env",                    // Current working directory
		"C:\\Program Files\\TallyAgent\\.env",  // Default install location
	)

	var loadedFrom string
	var loadErr error

	for _, envPath := range envPaths {
		logger.Printf("🔍 Trying .env at: %s", envPath)
		
		// Check if file exists
		if _, err := os.Stat(envPath); os.IsNotExist(err) {
			logger.Printf("   ❌ File does not exist")
			continue
		}

		// Try to load
		err = godotenv.Load(envPath)
		if err != nil {
			logger.Printf("   ❌ Failed to load: %v", err)
			loadErr = err
			continue
		}

		logger.Printf("   ✅ Successfully loaded .env from: %s", envPath)
		loadedFrom = envPath
		break
	}

	if loadedFrom == "" {
		logger.Printf("⚠️  Could not load .env from any location. Last error: %v", loadErr)
	}

	// Load environment variables
	serverURL = strings.TrimSpace(os.Getenv("SERVER_URL"))
	apiKey = strings.TrimSpace(os.Getenv("API_KEY"))
	companyId := strings.TrimSpace(os.Getenv("COMPANY_ID"))
	
	// Override tallyURL if specified
	if customTallyURL := strings.TrimSpace(os.Getenv("TALLY_URL")); customTallyURL != "" {
		tallyURL = customTallyURL
	}

	logger.Printf("🔧 Configuration loaded:")
	logger.Printf("   SERVER_URL: '%s'", serverURL)
	logger.Printf("   API_KEY: '%s'", maskString(apiKey))
	logger.Printf("   COMPANY_ID: '%s'", companyId)
	logger.Printf("   TALLY_URL: '%s'", tallyURL)

	// Validate required configuration
	if serverURL == "" {
		logger.Println("❌ SERVER_URL is empty!")
		// Try to read .env file manually to debug
		if loadedFrom != "" {
			debugEnvFile(loadedFrom)
		}
	}
	if apiKey == "" {
		logger.Println("❌ API_KEY is empty!")
	}

	// Log all environment variables for debugging
	logger.Println("📋 All environment variables:")
	for _, env := range os.Environ() {
		if strings.Contains(strings.ToUpper(env), "SERVER") || 
		   strings.Contains(strings.ToUpper(env), "API") || 
		   strings.Contains(strings.ToUpper(env), "COMPANY") ||
		   strings.Contains(strings.ToUpper(env), "TALLY") {
			logger.Printf("   %s", env)
		}
	}
}

func debugEnvFile(envPath string) {
	logger.Printf("🔍 Debug: Reading .env file manually from %s", envPath)
	content, err := os.ReadFile(envPath)
	if err != nil {
		logger.Printf("❌ Could not read .env file: %v", err)
		return
	}
	
	logger.Printf("📄 .env file contents:")
	lines := strings.Split(string(content), "\n")
	for i, line := range lines {
		logger.Printf("   Line %d: '%s'", i+1, line)
	}
}

func maskString(s string) string {
	if len(s) <= 4 {
		return strings.Repeat("*", len(s))
	}
	return s[:2] + strings.Repeat("*", len(s)-4) + s[len(s)-2:]
}

func startAgent() {
	logger.Println("🚀 Starting agent main loop...")
	
	// Reload environment variables before starting (in case service started before file was ready)
	logger.Println("🔄 Reloading environment variables...")
	loadEnvironmentVariables()
	
	// Do an immediate sync first
	logger.Println("🔄 Performing initial sync...")
	syncInvoices()
	
	// Then start the ticker
	ticker := time.NewTicker(60 * time.Second)
	logger.Println("⏰ Starting 60-second sync interval...")
	
	for {
		select {
		case <-ticker.C:
			logger.Println("⏰ Timer triggered - syncing invoices...")
			
			// Periodically reload env vars in case they change
			loadEnvironmentVariables()
			
			syncInvoices()
		}
	}
}

func syncInvoices() {
	logger.Println("📡 Starting syncInvoices...")
	
	// Double-check configuration before each sync
	if serverURL == "" {
		logger.Println("❌ SERVER_URL is empty, reloading environment...")
		loadEnvironmentVariables()
	}
	
	if serverURL == "" || apiKey == "" {
		logger.Println("❌ Missing required configuration (SERVER_URL or API_KEY)")
		logger.Printf("   Current SERVER_URL: '%s'", serverURL)
		logger.Printf("   Current API_KEY: '%s'", maskString(apiKey))
		return
	}

	reqBody := map[string]interface{}{
		"apiKey": apiKey,
		"event":  "sync-request",
	}

	bodyJSON, err := json.Marshal(reqBody)
	if err != nil {
		logger.Printf("❌ Failed to marshal request: %v", err)
		return
	}

	webhookURL := serverURL + "/webhook"
	logger.Printf("📤 Making request to: %s", webhookURL)

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Post(webhookURL, "application/json", bytes.NewBuffer(bodyJSON))
	if err != nil {
		logger.Printf("❌ Failed to fetch invoices: %v", err)
		return
	}
	defer resp.Body.Close()

	logger.Printf("📥 Response status: %s", resp.Status)

	if resp.StatusCode != http.StatusOK {
		logger.Printf("❌ Server returned error status: %d", resp.StatusCode)
		respBody, _ := io.ReadAll(resp.Body)
		logger.Printf("📥 Error response body: %s", string(respBody))
		return
	}

	var res struct {
		Invoices []map[string]interface{} `json:"invoices"`
		Success  bool                     `json:"success"`
		Message  string                   `json:"message"`
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.Printf("❌ Failed to read response body: %v", err)
		return
	}

	err = json.Unmarshal(respBody, &res)
	if err != nil {
		logger.Printf("❌ Failed to parse response JSON: %v", err)
		logger.Printf("📥 Raw response: %s", string(respBody))
		return
	}

	logger.Printf("📋 Processing %d invoice(s)", len(res.Invoices))
	
	if len(res.Invoices) == 0 {
		logger.Println("ℹ️  No invoices to process")
		return
	}

	for i, invoice := range res.Invoices {
		logger.Printf("🔄 Processing invoice %d/%d", i+1, len(res.Invoices))
		processInvoice(invoice)
	}
	
	logger.Println("✅ Sync completed successfully")
}

// ... rest of your existing functions remain the same
func processInvoice(invoice map[string]interface{}) {
	id := invoice["_id"]
	logger.Printf("🔄 Processing invoice %v", id)

	err := ensureMasterData(invoice)
	if err != nil {
		logger.Printf("❌ Master data error: %v", err)
		reportStatus(id, "error", err.Error())
		return
	}

	xmlStr, err := buildInvoiceXML(invoice)
	if err != nil {
		logger.Printf("❌ Failed to build invoice XML: %v", err)
		reportStatus(id, "error", err.Error())
		return
	}

	logger.Printf("📤 Sending invoice XML to Tally:\n%s", xmlStr)
	
	client := &http.Client{Timeout: 30 * time.Second}
	tallyResp, err := client.Post(tallyURL, "application/xml", strings.NewReader(xmlStr))
	if err != nil {
		logger.Printf("❌ Failed posting invoice: %v", err)
		reportStatus(id, "error", err.Error())
		return
	}
	defer tallyResp.Body.Close()
	
	respBytes, _ := io.ReadAll(tallyResp.Body)
	respStr := string(respBytes)
	logger.Printf("📥 Tally response: %s", respStr)

	lineErr := extractLineError(respStr)
	if lineErr != "" {
		logger.Printf("❌ Invoice error: %s", lineErr)
		reportStatus(id, "error", lineErr)
		return
	}

	logger.Printf("✅ Synced invoice %v", id)
	reportStatus(id, "success", "")
}

func reportStatus(id interface{}, status, errMsg string) {
	logger.Printf("📊 Reporting status for invoice %v: %s", id, status)
	
	data := map[string]interface{}{
		"apiKey": apiKey,
		"event":  "sync-status",
		"data": map[string]interface{}{
			"invoiceId": id,
			"status":    status,
			"error":     errMsg,
		},
	}
	
	bodyJSON, _ := json.Marshal(data)
	webhookURL := serverURL + "/webhook"
	
	logger.Printf("📤 Sending status to: %s", webhookURL)
	
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Post(webhookURL, "application/json", bytes.NewBuffer(bodyJSON))
	if err != nil {
		logger.Printf("❌ Failed to report status: %v", err)
		return
	}
	defer resp.Body.Close()
	
	logger.Printf("📥 Status report response: %s", resp.Status)
}

func extractLineError(response string) string {
	re := regexp.MustCompile(`<LINEERROR>(.*?)</LINEERROR>`)
	matches := re.FindStringSubmatch(response)
	if len(matches) > 1 {
		return matches[1]
	}
	return ""
}

// Keep your existing helper functions
func ensureMasterData(invoice map[string]interface{}) error {
	steps := []struct {
		name string
		xml  string
	}{
		{"Unit PIECES", buildUnitXML()},
		{"StockGroup Primary", buildStockGroupXML()},
		{"Sales Ledger", buildSalesLedgerXML()},
		{"Customer Ledger", buildLedgerXML(getCustomerName(invoice))},
	}

	for _, s := range steps {
		logger.Printf("🔧 Ensuring %s", s.name)
		resp, err := http.Post(tallyURL, "application/xml", strings.NewReader(s.xml))
		if err != nil {
			return fmt.Errorf("%s post error: %v", s.name, err)
		}
		defer resp.Body.Close()
		respBytes, _ := io.ReadAll(resp.Body)
		respStr := string(respBytes)
		logger.Printf("📥 %s response: %s", s.name, respStr)
		if errMsg := extractLineError(respStr); errMsg != "" && !strings.Contains(strings.ToLower(errMsg), "already exists") {
			return fmt.Errorf("%s creation failed: %s", s.name, errMsg)
		}
	}

	items := invoice["items"].([]interface{})
	for _, it := range items {
		itemMap := it.(map[string]interface{})
		itemName := getItemName(itemMap)
		itemXML := buildItemXML(itemName)
		logger.Printf("🔧 Ensuring Item %s", itemName)
		resp, err := http.Post(tallyURL, "application/xml", strings.NewReader(itemXML))
		if err != nil {
			return fmt.Errorf("Item %s post error: %v", itemName, err)
		}
		defer resp.Body.Close()
		respBytes, _ := io.ReadAll(resp.Body)
		respStr := string(respBytes)
		if errMsg := extractLineError(respStr); errMsg != "" && !strings.Contains(strings.ToLower(errMsg), "already exists") {
			return fmt.Errorf("Item %s creation failed: %s", itemName, errMsg)
		}
	}
	return nil
}

func getCustomerName(invoice map[string]interface{}) string {
	if customer, ok := invoice["customer"].(map[string]interface{}); ok {
		if name, ok := customer["name"].(string); ok {
			return name
		}
	}
	if name, ok := invoice["customerName"].(string); ok {
		return name
	}
	return "Unknown Customer"
}

func getItemName(item map[string]interface{}) string {
	if t, ok := item["title"].(string); ok {
		return t
	}
	if n, ok := item["name"].(string); ok {
		return n
	}
	return "Unknown Item"
}

// Keep your existing XML building functions
func buildUnitXML() string {
	doc := etree.NewDocument()
	env := doc.CreateElement("ENVELOPE")
	header := env.CreateElement("HEADER")
	header.CreateElement("TALLYREQUEST").SetText("Import Data")
	body := env.CreateElement("BODY")
	importData := body.CreateElement("IMPORTDATA")
	reqDesc := importData.CreateElement("REQUESTDESC")
	reqDesc.CreateElement("REPORTNAME").SetText("All Masters")
	reqData := importData.CreateElement("REQUESTDATA")
	tallyMsg := reqData.CreateElement("TALLYMESSAGE")
	unit := tallyMsg.CreateElement("UNIT")
	unit.CreateAttr("NAME", "PIECES")
	unit.CreateAttr("ACTION", "Create")
	unit.CreateElement("NAME").SetText("PIECES")
	unit.CreateElement("ISSIMPLEUNIT").SetText("Yes")
	unit.CreateElement("DECIMALPLACES").SetText("0")
	xml, _ := doc.WriteToString()
	return xml
}

func buildStockGroupXML() string { return buildGenericLedgerXML("STOCKGROUP", "Primary") }
func buildSalesLedgerXML() string { return buildGenericLedgerXML("LEDGER", "Sales Account") }
func buildLedgerXML(name string) string { return buildGenericLedgerXML("LEDGER", name) }
func buildItemXML(name string) string { return buildGenericLedgerXML("STOCKITEM", name) }

func buildGenericLedgerXML(tag, name string) string {
	doc := etree.NewDocument()
	env := doc.CreateElement("ENVELOPE")
	header := env.CreateElement("HEADER")
	header.CreateElement("TALLYREQUEST").SetText("Import Data")
	body := env.CreateElement("BODY")
	importData := body.CreateElement("IMPORTDATA")
	reqDesc := importData.CreateElement("REQUESTDESC")
	reqDesc.CreateElement("REPORTNAME").SetText("All Masters")
	reqData := importData.CreateElement("REQUESTDATA")
	tallyMsg := reqData.CreateElement("TALLYMESSAGE")
	entity := tallyMsg.CreateElement(tag)
	entity.CreateAttr("NAME", name)
	entity.CreateAttr("ACTION", "Create")
	entity.CreateElement("NAME").SetText(name)
	xml, _ := doc.WriteToString()
	return xml
}

func buildInvoiceXML(invoice map[string]interface{}) (string, error) {
	doc := etree.NewDocument()
	env := doc.CreateElement("ENVELOPE")
	header := env.CreateElement("HEADER")
	header.CreateElement("TALLYREQUEST").SetText("Import Data")

	body := env.CreateElement("BODY")
	importData := body.CreateElement("IMPORTDATA")

	reqDesc := importData.CreateElement("REQUESTDESC")
	reqDesc.CreateElement("REPORTNAME").SetText("Vouchers")

	reqData := importData.CreateElement("REQUESTDATA")
	tallyMsg := reqData.CreateElement("TALLYMESSAGE")
	tallyMsg.CreateAttr("xmlns:UDF", "TallyUDF")

	vch := tallyMsg.CreateElement("VOUCHER")
	vch.CreateAttr("REMOTEID", invoice["_id"].(string))
	vch.CreateAttr("VCHTYPE", "Sales")
	vch.CreateAttr("ACTION", "Create")
	vch.CreateAttr("OBJVIEW", "Invoice Voucher View")

	vch.CreateElement("DATE").SetText(formatTallyDate(invoice["date"].(string)))
	vch.CreateElement("GUID").SetText(invoice["_id"].(string))
	vch.CreateElement("NARRATION").SetText("Sales Invoice")
	vch.CreateElement("VOUCHERTYPENAME").SetText("Sales")
	vch.CreateElement("PARTYLEDGERNAME").SetText(getCustomerName(invoice))
	vch.CreateElement("PERSISTEDVIEW").SetText("Invoice Voucher View")
	vch.CreateElement("BASICBASEPARTYNAME").SetText(getCustomerName(invoice))
	vch.CreateElement("VCHENTRYMODE").SetText("Item Invoice")

	// Ledger Entry (Customer)
	ledgerEntry := vch.CreateElement("ALLLEDGERENTRIES.LIST")
	ledgerEntry.CreateElement("LEDGERNAME").SetText(getCustomerName(invoice))
	ledgerEntry.CreateElement("ISDEEMEDPOSITIVE").SetText("Yes")
	ledgerEntry.CreateElement("AMOUNT").SetText(fmt.Sprintf("-%v", invoice["totalAmount"]))

	// Ledger Entry (Sales)
	salesLedger := vch.CreateElement("ALLLEDGERENTRIES.LIST")
	salesLedger.CreateElement("LEDGERNAME").SetText("Sales Account")
	salesLedger.CreateElement("ISDEEMEDPOSITIVE").SetText("No")
	salesLedger.CreateElement("AMOUNT").SetText(fmt.Sprintf("%v", invoice["totalAmount"]))

	items := invoice["items"].([]interface{})
	for _, item := range items {
		itm := item.(map[string]interface{})

		invEntry := vch.CreateElement("INVENTORYENTRIES.LIST")
invEntry.CreateElement("STOCKITEMNAME").SetText(getItemName(itm))
invEntry.CreateElement("ISDEEMEDPOSITIVE").SetText("No")
invEntry.CreateElement("RATE").SetText(fmt.Sprintf("%v/PCS", itm["rate"]))
invEntry.CreateElement("AMOUNT").SetText(fmt.Sprintf("%v", itm["amount"]))
invEntry.CreateElement("ACTUALQTY").SetText(fmt.Sprintf("%v PCS", itm["quantity"]))
invEntry.CreateElement("BILLEDQTY").SetText(fmt.Sprintf("%v PCS", itm["quantity"]))
invEntry.CreateElement("BATCHALLOCATIONS.LIST") // Empty but required

accAlloc := invEntry.CreateElement("ACCOUNTINGALLOCATIONS.LIST")
accAlloc.CreateElement("LEDGERNAME").SetText("Sales Account")
accAlloc.CreateElement("ISDEEMEDPOSITIVE").SetText("No")
accAlloc.CreateElement("AMOUNT").SetText(fmt.Sprintf("%v", itm["amount"]))

	}

	xml, err := doc.WriteToString()
	if err != nil {
		return "", fmt.Errorf("failed to serialize XML: %v", err)
	}
	return xml, nil
}

func formatTallyDate(isoDate string) string {
	t, err := time.Parse(time.RFC3339, isoDate)
	if err != nil {
		return "20250101" // fallback
	}
	return t.Format("20060102")
}
