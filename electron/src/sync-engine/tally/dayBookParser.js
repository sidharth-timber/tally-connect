// Pure parsing helpers for Tally's Day Book XML export — moved from tally-pull.js.

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

// Per-line ledger names for the backend's COA mapping (TallyLedgerMap →
// coa_id). Tally's export convention: negative amount = debit.
function toLedgerEntries(blocks) {
  return blocks
    .filter(e => e.ledger)
    .map(e => {
      const raw = parseTallyAmt(e.amount);
      return { ledger_name: e.ledger, amount: Math.abs(raw), is_debit: raw < 0 };
    });
}

// Capture all VOUCHER blocks, then filter by VOUCHERTYPENAME in the body
// (attribute-based VCHTYPE matching is unreliable; body tag is always present)
function parseVouchers(xml) {
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
          name: g('STOCKITEMNAME'),
          qty: parseTallyQty(g('BILLEDQTY')),
          rate: parseTallyAmt(g('RATE')),
          amount: Math.abs(parseTallyAmt(g('AMOUNT'))),
          hsn: g('HSNCODE'),
          gst_rate: halfRate * 2
        };
      });

    const cgst = sumLedger(ledgerBlocks, 'CGST');
    const sgst = sumLedger(ledgerBlocks, 'SGST');
    const igst = sumLedger(ledgerBlocks, 'IGST');
    const subtotal = invBlocks.reduce((s, i) => s + i.amount, 0);

    return {
      voucher_number: get('VOUCHERNUMBER'),
      // Voucher-level "Reference" field, when set — Tally defaults a
      // Receipt's bill-wise "Agst Ref" allocation name to this ahead of the
      // voucher number, so the backend needs it to match receipts back.
      reference_no: get('REFERENCE'),
      date: get('DATE'),
      party_name: get('PARTYNAME') || get('PARTYLEDGERNAME'),
      gstin: get('PARTYGSTIN'),
      items: invBlocks,
      subtotal,
      cgst,
      sgst,
      igst,
      total: subtotal + cgst + sgst + igst,
      narration: get('NARRATION'),
      ledger_entries: toLedgerEntries(ledgerBlocks)
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

    const ledgerEntries = [...body.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g)];
    const voucherLedgerEntries = toLedgerEntries(ledgerEntries.map(([, b]) => {
      const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
      return { ledger: g('LEDGERNAME'), amount: g('AMOUNT') };
    }));

    for (const [, partyBody] of ledgerEntries) {
      const billAllocs = [...partyBody.matchAll(/<BILLALLOCATIONS\.LIST>([\s\S]*?)<\/BILLALLOCATIONS\.LIST>/g)];
      for (const [, allocBody] of billAllocs) {
        const ga = tag => { const m = allocBody.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
        const invoice_voucher_number = ga('NAME');
        const billType = ga('BILLTYPE');
        const amount = Math.abs(parseTallyAmt(ga('AMOUNT')));
        if (!invoice_voucher_number || amount <= 0) continue;
        if (billType && billType !== 'Agst Ref' && billType !== 'On Account') continue;
        results.push({
          receipt_number,
          date,
          party_name,
          invoice_voucher_number,
          amount,
          ledger_entries: voucherLedgerEntries
        });
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

    const invBlocks = [...body.matchAll(/<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>/g)]
      .map(([, b]) => {
        const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
        const billedQtyStr = g('BILLEDQTY');
        const unitMatch = billedQtyStr.match(/[\d.]+\s+(\S+)/);
        const unit = unitMatch ? unitMatch[1] : 'PIECES';
        return {
          name: g('STOCKITEMNAME'),
          qty: parseTallyQty(billedQtyStr),
          rate: parseTallyAmt(g('RATE')),
          amount: Math.abs(parseTallyAmt(g('AMOUNT'))),
          hsn: g('HSNCODE'),
          unit,
        };
      })
      .filter(i => i.name);

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

    const taxableFromInv = invBlocks.reduce((s, i) => s + i.amount, 0);
    const taxableFromLedger = allLedgers
      .filter(e => /purchase/i.test(e.ledger) || /expense/i.test(e.ledger))
      .reduce((s, e) => s + Math.abs(parseTallyAmt(e.amount)), 0);
    const taxable = taxableFromInv || taxableFromLedger;
    const total = taxable + cgst + sgst + igst;

    return {
      voucher_number: get('VOUCHERNUMBER'),
      // "Supplier Invoice No." on the Purchase voucher — Tally defaults a
      // Payment's bill-wise "Agst Ref" allocation name to this ahead of the
      // voucher number, so the backend needs it to match payments back.
      supplier_invoice_no: get('REFERENCE'),
      date: get('DATE'),
      party_name: get('PARTYNAME') || get('PARTYLEDGERNAME'),
      gstin: get('PARTYGSTIN'),
      is_inventory_purchase: invBlocks.length > 0,
      line_items: invBlocks,
      taxable,
      cgst,
      sgst,
      igst,
      total: total || Math.abs(parseTallyAmt(get('AMOUNT'))),
      narration: get('NARRATION'),
      ledger_entries: toLedgerEntries(allLedgers)
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
    const voucherLedgerEntries = toLedgerEntries(ledgerEntries.map(([, b]) => {
      const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
      return { ledger: g('LEDGERNAME'), amount: g('AMOUNT') };
    }));
    for (const [, partyBody] of ledgerEntries) {
      const billAllocs = [...partyBody.matchAll(/<BILLALLOCATIONS\.LIST>([\s\S]*?)<\/BILLALLOCATIONS\.LIST>/g)];
      for (const [, allocBody] of billAllocs) {
        const ga = tag => { const m = allocBody.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
        const bill_voucher_number = ga('NAME');
        const billType = ga('BILLTYPE');
        const amount = Math.abs(parseTallyAmt(ga('AMOUNT')));
        if (!bill_voucher_number || amount <= 0) continue;
        if (billType && billType !== 'Agst Ref' && billType !== 'On Account') continue;
        results.push({ payment_number, date, party_name, bill_voucher_number, amount, ledger_entries: voucherLedgerEntries });
      }
    }
  }
  return results;
}

// Credit Note and Debit Note vouchers share this parser — same Invoice
// Voucher View / Item Invoice shape as Sales/Purchase (see buildNoteXML on
// the push side), just parameterized on the voucher type ("Credit Note" /
// "Debit Note" — the type name has a space, hence \s+ in the filter regex).
function parseNotes(xml, vchType) {
  const typeRe = new RegExp(`<VOUCHERTYPENAME>\\s*${vchType.replace(/ /g, '\\s+')}\\s*</VOUCHERTYPENAME>`, 'i');
  const blocks = [...xml.matchAll(/<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g)]
    .filter(([, body]) => typeRe.test(body));

  return blocks.map(([, body]) => {
    const get = tag => { const m = body.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };

    const ledgerBlocks = [...body.matchAll(/<LEDGERENTRIES\.LIST>([\s\S]*?)<\/LEDGERENTRIES\.LIST>/g)]
      .map(([, b]) => {
        const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
        return {
          ledger: g('LEDGERNAME'),
          amount: g('AMOUNT'),
          isParty: /<ISPARTYLEDGER>\s*Yes\s*<\/ISPARTYLEDGER>/i.test(b),
          raw: b
        };
      });

    const invBlocks = [...body.matchAll(/<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>/g)]
      .map(([, b]) => {
        const g = t => { const m = b.match(new RegExp(`<${t}>(.*?)<\\/${t}>`)); return m ? m[1].trim() : ''; };
        return {
          name: g('STOCKITEMNAME'),
          qty: parseTallyQty(g('BILLEDQTY')),
          rate: parseTallyAmt(g('RATE')),
          amount: Math.abs(parseTallyAmt(g('AMOUNT'))),
          hsn: g('HSNCODE')
        };
      })
      .filter(i => i.name);

    const cgst = sumLedger(ledgerBlocks, 'CGST');
    const sgst = sumLedger(ledgerBlocks, 'SGST');
    const igst = sumLedger(ledgerBlocks, 'IGST');
    const subtotal = invBlocks.reduce((s, i) => s + i.amount, 0);

    // The party's own bill allocation tells us whether this note settles an
    // existing invoice ("Agst Ref" → linked_invoice_ref) or opens its own
    // reference ("New Ref" — left unset here, matching a standalone note).
    const partyBlock = ledgerBlocks.find(b => b.isParty);
    let linked_invoice_ref = '';
    if (partyBlock) {
      const allocMatch = partyBlock.raw.match(/<BILLALLOCATIONS\.LIST>([\s\S]*?)<\/BILLALLOCATIONS\.LIST>/);
      if (allocMatch) {
        const ga = tag => { const m = allocMatch[1].match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`)); return m ? m[1].trim() : ''; };
        if (ga('BILLTYPE') === 'Agst Ref') {
          linked_invoice_ref = ga('NAME');
        }
      }
    }

    return {
      voucher_number: get('VOUCHERNUMBER'),
      date: get('DATE'),
      party_name: get('PARTYNAME') || get('PARTYLEDGERNAME'),
      gstin: get('PARTYGSTIN'),
      items: invBlocks,
      subtotal,
      cgst,
      sgst,
      igst,
      total: subtotal + cgst + sgst + igst,
      narration: get('NARRATION'),
      linked_invoice_ref,
      ledger_entries: toLedgerEntries(ledgerBlocks)
    };
  }).filter(v => v.voucher_number && v.party_name);
}

function parseCreditNotes(xml) {
  return parseNotes(xml, 'Credit Note');
}

function parseDebitNotes(xml) {
  return parseNotes(xml, 'Debit Note');
}

module.exports = {
  parseVouchers, parseReceipts, parsePurchases, parsePayments,
  parseCreditNotes, parseDebitNotes,
};
