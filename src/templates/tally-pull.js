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
    } catch (e) {
        console.error('[pull] loop error:', e.message);
    }
}

setInterval(pullLoop, 60 * 1000);
pullLoop();
