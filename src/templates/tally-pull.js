require('dotenv').config();
const axios = require('axios');

const TALLY_URL  = 'http://localhost:9000';
const SERVER_URL = process.env.SERVER_URL;
const API_KEY    = process.env.API_KEY;
const COMPANY_ID = process.env.COMPANY_ID;
const PULL_DAYS  = parseInt(process.env.PULL_WINDOW_DAYS || '30', 10);

function fmtDate(d) {
    return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildFetchXML(from, to) {
    return `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVFROMDATE>${from}</SVFROMDATE>
          <SVTODATE>${to}</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function parseTallyAmt(s) {
    return parseFloat((s || '0').split('/')[0]) || 0;
}

function parseTallyQty(s) {
    return parseFloat((s || '1').trim().split(/\s+/)[0]) || 1;
}

function sumLedger(blocks, name) {
    return blocks
        .filter(e => (e.ledger || '').toUpperCase().includes(name.toUpperCase()))
        .reduce((s, e) => s + Math.abs(parseTallyAmt(e.amount)), 0);
}

function parseVouchers(xml) {
    // Capture all VOUCHER blocks, then filter by VOUCHERTYPENAME in the body
    // (attribute-based VCHTYPE matching is unreliable; body tag is always present)
    const voucherBlocks = [...xml.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
        .filter(([, body]) => /<VOUCHERTYPENAME>\s*Sales\s*<\/VOUCHERTYPENAME>/i.test(body));
    return voucherBlocks.map(([, body]) => {
        const get = tag => {
            const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
            return m ? m[1].trim() : '';
        };

        const ledgerBlocks = [...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)]
            .map(([, b]) => {
                const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
                return { ledger: g('LEDGERNAME'), amount: g('AMOUNT') };
            });

        const invBlocks = [...body.matchAll(/<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>/g)]
            .map(([, b]) => {
                const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
                const rateBlocks = [...b.matchAll(/<RATEDETAILS\.LIST>([\s\S]*?)<\/RATEDETAILS\.LIST>/g)];
                const cgstBlock = rateBlocks.find(([, rb]) => /CGST/i.test(rb));
                const rateMatch = cgstBlock ? cgstBlock[1].match(/<GSTRATE>(.*?)<\/GSTRATE>/) : null;
                const halfRate = rateMatch ? parseFloat(rateMatch[1]) : 0;
                return {
                    name:     g('STOCKITEMNAME'),
                    qty:      parseTallyQty(g('BILLEDQTY')),
                    rate:     parseTallyAmt(g('RATE')),
                    amount:   Math.abs(parseTallyAmt(g('AMOUNT'))),
                    hsn:      g('HSNCODE'),
                    gst_rate: halfRate * 2
                };
            });

        const cgst = sumLedger(ledgerBlocks, 'CGST');
        const sgst = sumLedger(ledgerBlocks, 'SGST');
        const igst = sumLedger(ledgerBlocks, 'IGST');
        const subtotal = invBlocks.reduce((s, i) => s + i.amount, 0);

        return {
            voucher_number: get('VOUCHERNUMBER'),
            date:           get('DATE'),
            party_name:     get('PARTYNAME') || get('PARTYLEDGERNAME'),
            gstin:          get('PARTYGSTIN'),
            items:          invBlocks,
            subtotal,
            cgst,
            sgst,
            igst,
            total: subtotal + cgst + sgst + igst,
            narration: get('NARRATION')
        };
    }).filter(v => v.voucher_number);
}

function parseReceipts(xml) {
    const results = [];
    const receiptBlocks = [...xml.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
        .filter(([, body]) => /<VOUCHERTYPENAME>\s*Receipt\s*<\/VOUCHERTYPENAME>/i.test(body));

    for (const [, body] of receiptBlocks) {
        const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
        const receipt_number = get('VOUCHERNUMBER');
        const date = get('DATE');
        const party_name = get('PARTYNAME') || get('PARTYLEDGERNAME');
        if (!receipt_number) continue;

        // Receipt vouchers use ALLLEDGERENTRIES.LIST; Sales vouchers use LEDGERENTRIES.LIST
        const ledgerEntries = [...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)];

        for (const [, partyBody] of ledgerEntries) {
            const billAllocs = [...partyBody.matchAll(/<BILLALLOCATIONS\.LIST>([\s\S]*?)<\/BILLALLOCATIONS\.LIST>/g)];
            for (const [, allocBody] of billAllocs) {
                const ga = tag => { const m = allocBody.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
                const invoice_voucher_number = ga('NAME');
                const billType = ga('BILLTYPE');
                const amount = Math.abs(parseTallyAmt(ga('AMOUNT')));
                if (!invoice_voucher_number || amount <= 0) continue;
                if (billType && billType !== 'Agst Ref' && billType !== 'On Account') continue;
                results.push({ receipt_number, date, party_name, invoice_voucher_number, amount });
            }
        }
    }
    return results;
}

function parsePurchases(xml) {
    const purchaseBlocks = [...xml.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
        .filter(([, body]) => /<VOUCHERTYPENAME>\s*Purchase\s*<\/VOUCHERTYPENAME>/i.test(body));

    return purchaseBlocks.map(([, body]) => {
        const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };

        // Parse inventory entries (Item Invoice mode)
        const invBlocks = [...body.matchAll(/<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>/g)]
            .map(([, b]) => {
                const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
                // Unit is embedded in BILLEDQTY as "1 PIECES" or in RATE as "100/PIECES"
                const billedQtyStr = g('BILLEDQTY');
                const unitMatch = billedQtyStr.match(/[\d.]+\s+(\S+)/);
                const unit = unitMatch ? unitMatch[1] : 'PIECES';
                return {
                    name:   g('STOCKITEMNAME'),
                    qty:    parseTallyQty(billedQtyStr),
                    rate:   parseTallyAmt(g('RATE')),
                    amount: Math.abs(parseTallyAmt(g('AMOUNT'))),
                    hsn:    g('HSNCODE'),
                    unit,
                };
            })
            .filter(i => i.name);

        // Parse top-level ledger entries (both tag variants)
        const allLedgers = [
            ...[...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)].map(([, b]) => b),
            ...[...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)].map(([, b]) => b)
        ].map(b => {
            const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
            return { ledger: g('LEDGERNAME'), amount: g('AMOUNT') };
        });

        const cgst = sumLedger(allLedgers, 'CGST');
        const sgst = sumLedger(allLedgers, 'SGST');
        const igst = sumLedger(allLedgers, 'IGST');

        // For Item Invoice mode: taxable comes from inventory entry amounts
        // For accounting mode: taxable comes from purchase/expense ledger entries
        const taxableFromInv = invBlocks.reduce((s, i) => s + i.amount, 0);
        const taxableFromLedger = allLedgers
            .filter(e => /purchase/i.test(e.ledger) || /expense/i.test(e.ledger))
            .reduce((s, e) => s + Math.abs(parseTallyAmt(e.amount)), 0);
        const taxable = taxableFromInv || taxableFromLedger;
        const total = taxable + cgst + sgst + igst;

        return {
            voucher_number:       get('VOUCHERNUMBER'),
            date:                 get('DATE'),
            party_name:           get('PARTYNAME') || get('PARTYLEDGERNAME'),
            gstin:                get('PARTYGSTIN'),
            is_inventory_purchase: invBlocks.length > 0,
            line_items:           invBlocks,
            taxable,
            cgst,
            sgst,
            igst,
            total: total || Math.abs(parseTallyAmt(get('AMOUNT'))),
            narration: get('NARRATION')
        };
    }).filter(v => v.voucher_number && v.party_name);
}

function parsePayments(xml) {
    const results = [];
    const paymentBlocks = [...xml.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
        .filter(([, body]) => /<VOUCHERTYPENAME>\s*Payment\s*<\/VOUCHERTYPENAME>/i.test(body));

    for (const [, body] of paymentBlocks) {
        const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
        const payment_number = get('VOUCHERNUMBER');
        const date = get('DATE');
        const party_name = get('PARTYNAME') || get('PARTYLEDGERNAME');
        if (!payment_number) continue;

        const ledgerEntries = [...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)];
        for (const [, partyBody] of ledgerEntries) {
            const billAllocs = [...partyBody.matchAll(/<BILLALLOCATIONS\.LIST>([\s\S]*?)<\/BILLALLOCATIONS\.LIST>/g)];
            for (const [, allocBody] of billAllocs) {
                const ga = tag => { const m = allocBody.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
                const bill_voucher_number = ga('NAME');
                const billType = ga('BILLTYPE');
                const amount = Math.abs(parseTallyAmt(ga('AMOUNT')));
                if (!bill_voucher_number || amount <= 0) continue;
                if (billType && billType !== 'Agst Ref' && billType !== 'On Account') continue;
                results.push({ payment_number, date, party_name, bill_voucher_number, amount });
            }
        }
    }
    return results;
}

async function pullLoop() {
    try {
        const to = new Date();
        const from = new Date(to);
        from.setDate(from.getDate() - PULL_DAYS);

        const xml = buildFetchXML(fmtDate(from), fmtDate(to));
        const tallyRes = await axios.post(TALLY_URL, xml, {
            headers: { 'Content-Type': 'application/xml' },
            timeout: 10000
        });


        const vouchers = parseVouchers(tallyRes.data);
        console.log(`[pull] ${vouchers.length} Sales vouchers found in Tally`);

        for (const v of vouchers) {
            try {
                const r = await axios.post(`${SERVER_URL}/webhook`, {
                    apiKey: API_KEY,
                    companyId: COMPANY_ID,
                    event: 'tally-import',
                    data: v
                });
                console.log(`[pull] ${v.voucher_number}: ${r.data.imported ? 'imported' : r.data.reason}`);
            } catch (e) {
                console.error(`[pull] ${v.voucher_number} failed:`, e.message);
            }
        }

        const purchases = parsePurchases(tallyRes.data);
        console.log(`[pull] ${purchases.length} Purchase voucher(s) found in Tally`);
        for (const p of purchases) {
            try {
                const r = await axios.post(`${SERVER_URL}/webhook`, {
                    apiKey: API_KEY, companyId: COMPANY_ID, event: 'tally-purchase', data: p
                });
                console.log(`[pull] purchase ${p.voucher_number}: ${r.data.imported ? 'imported' : r.data.reason}`);
            } catch (e) {
                console.error(`[pull] purchase ${p.voucher_number} failed:`, e.message);
            }
        }

        const vendor_payments = parsePayments(tallyRes.data);
        console.log(`[pull] ${vendor_payments.length} Payment voucher(s) found in Tally`);
        for (const p of vendor_payments) {
            try {
                const r = await axios.post(`${SERVER_URL}/webhook`, {
                    apiKey: API_KEY, companyId: COMPANY_ID, event: 'tally-payment', data: p
                });
                console.log(`[pull] payment ${p.payment_number} → bill ${p.bill_voucher_number}: ${r.data.imported ? 'imported' : r.data.reason}`);
            } catch (e) {
                console.error(`[pull] payment ${p.payment_number} failed:`, e.message);
            }
        }

        const receipts = parseReceipts(tallyRes.data);
        console.log(`[pull] ${receipts.length} Receipt allocation(s) found in Tally`);

        for (const r of receipts) {
            try {
                const resp = await axios.post(`${SERVER_URL}/webhook`, {
                    apiKey: API_KEY,
                    companyId: COMPANY_ID,
                    event: 'tally-receipt',
                    data: r
                });
                console.log(`[pull] receipt ${r.receipt_number} → inv ${r.invoice_voucher_number}: ${resp.data.imported ? 'imported' : resp.data.reason}`);
            } catch (e) {
                console.error(`[pull] receipt ${r.receipt_number} failed:`, e.message);
            }
        }
    } catch (e) {
        console.error('[pull] loop error:', e.message);
    }
}

setInterval(pullLoop, 60 * 1000);
pullLoop();
