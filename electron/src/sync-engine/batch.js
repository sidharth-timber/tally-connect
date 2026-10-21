// Paging state for the push loops. A sync asks the backend for pending documents a batch at a
// time; the ids of documents that failed in this run are sent back with each request so a
// document that keeps failing can't sit at the head of the queue and hide the ones behind it.
const DEFAULT_BATCH_SIZE = 100;

function createBatch(size) {
  return { size: size || Number(process.env.TALLYAGENT_BATCH_SIZE) || DEFAULT_BATCH_SIZE, skip: new Map() };
}

const keyOf = (companyId, event) => companyId + '|' + event;

// The `data` of a *-sync-request (undefined without paging: the backend then returns everything).
function pendingData(batch, companyId, event) {
  if (!batch) return undefined;
  return { batch_size: batch.size, exclude_ids: [...(batch.skip.get(keyOf(companyId, event)) || [])] };
}

function noteFailed(batch, companyId, event, id) {
  if (!batch || id == null) return;
  const key = keyOf(companyId, event);
  if (!batch.skip.has(key)) batch.skip.set(key, new Set());
  batch.skip.get(key).add(id);
}

module.exports = { createBatch, pendingData, noteFailed, DEFAULT_BATCH_SIZE };
