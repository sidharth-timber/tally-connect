const axios = require('axios');
const { DEFAULT_TALLY_URL } = require('./tallyClient');

// Chart-of-accounts export via an inline-TDL Collection request. Unlike the
// REPORTNAME exports (where only Day Book is safe — see tallyClient.js),
// <TYPE>COLLECTION</TYPE> with an inline <COLLECTION> definition does not
// route through Tally Prime's report UI, so it can't pop TDL error dialogs.
// NOTE: still needs one empirical pass against a live Tally Prime before the
// first release, same as was done for checkTallyStatus.

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCollectionXML({ id, objectType, companyName, nativeMethods }) {
  const methods = nativeMethods.map(m => `<NATIVEMETHOD>${m}</NATIVEMETHOD>`).join('');
  return `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>COLLECTION</TYPE>
    <ID>${id}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${id}" ISMODIFY="No">
            <TYPE>${objectType}</TYPE>
            ${methods}
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function buildLedgerCollectionXML(companyName) {
  return buildCollectionXML({
    id: 'TimberLedgers',
    objectType: 'Ledger',
    companyName,
    nativeMethods: ['NAME', 'PARENT', 'GUID', 'OPENINGBALANCE'],
  });
}

function buildGroupCollectionXML(companyName) {
  return buildCollectionXML({
    id: 'TimberGroups',
    objectType: 'Group',
    companyName,
    nativeMethods: ['NAME', 'PARENT', 'GUID'],
  });
}

function parseTallyAmt(s) {
  return parseFloat((s || '0').split('/')[0]) || 0;
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

// Tally marks top-level groups with the reserved parent "␄ Primary" (a
// control character + "Primary", verified against live Tally Prime) — that's
// a root marker, not a real group name.
function cleanParent(parent) {
  if (!parent) return null;
  // eslint-disable-next-line no-control-regex
  const trimmed = parent.replace(/[\u0000-\u001f]/g, '').trim();
  return !trimmed || /^primary$/i.test(trimmed) ? null : trimmed;
}

// Parses <LEDGER .../> or <GROUP .../> master blocks out of a collection
// response. Tally emits the object name both as a NAME attribute on the
// element and (usually) as a <NAME> child under LANGUAGENAME.LIST — prefer
// the child tag, fall back to the attribute.
function parseCollectionResponse(xml, objectTag) {
  const blockRe = new RegExp(`<${objectTag}\\b([^>]*)>([\\s\\S]*?)<\\/${objectTag}>`, 'gi');
  const results = [];
  for (const [, attrs, body] of xml.matchAll(blockRe)) {
    const get = tag => {
      // `(?:\s[^>]*)?` allows attributes but not dotted tags — `<NAME.LIST>`
      // must not match `<NAME>`.
      const m = body.match(new RegExp(`<${tag}(?:\\s[^>]*)?>(.*?)<\\/${tag}>`, 'i'));
      return m ? unescapeXml(m[1].trim()) : '';
    };
    const attrName = attrs.match(/NAME="([^"]*)"/i);
    const name = get('NAME') || (attrName ? unescapeXml(attrName[1].trim()) : '');
    if (!name) continue;
    const entry = { name, parent: cleanParent(get('PARENT')), guid: get('GUID') || null };
    if (objectTag === 'LEDGER') {
      const ob = get('OPENINGBALANCE');
      entry.opening_balance = ob ? parseTallyAmt(ob) : null;
    }
    results.push(entry);
  }
  return results;
}

// Fetches the full chart of accounts (group + ledger masters) for one Tally
// company. Throws on transport errors; returns { groups, ledgers }.
async function fetchCOA({ tallyUrl = DEFAULT_TALLY_URL, tallyCompanyName }) {
  const post = async xml => {
    const res = await axios.post(tallyUrl, xml, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 30000,
    });
    return res.data;
  };
  const groupsXml = await post(buildGroupCollectionXML(tallyCompanyName));
  const ledgersXml = await post(buildLedgerCollectionXML(tallyCompanyName));
  return {
    groups: parseCollectionResponse(groupsXml, 'GROUP'),
    ledgers: parseCollectionResponse(ledgersXml, 'LEDGER'),
  };
}

module.exports = {
  buildLedgerCollectionXML,
  buildGroupCollectionXML,
  parseCollectionResponse,
  fetchCOA,
};
