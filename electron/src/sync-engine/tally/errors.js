// Node's connection errors (ECONNREFUSED etc.) often arrive as an AggregateError
// whose .message is empty, which ended up as a blank error on the Timber
// document. Turn them into something a person can act on.
function describeError(err) {
  const code = err?.code || err?.errors?.[0]?.code;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return 'Could not reach Tally Prime (' + code + '). Make sure Tally is open with the company loaded and its XML server is enabled, then sync again.';
  }
  return err?.response?.data?.message || err?.response?.data?.error || err?.message || String(err || 'Unknown error');
}

module.exports = { describeError };
