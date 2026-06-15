/**
 * Reject with 405 if req.method is not in `allowed`.
 * Returns true if the response was sent (caller should return).
 */
export function allowMethods(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({ error: `Method ${req.method} not allowed` });
    return true;
  }
  return false;
}

/**
 * Async handler wrapper: catches thrown errors and sends a JSON response.
 * Errors with .status get that code; everything else becomes 500.
 */
export function withErrors(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      const status = e?.status ?? 500;
      if (status >= 500) {
        console.error(e); // log server-side, NO al cliente
        res.status(status).json({ error: 'Internal error' });
        return;
      }
      res.status(status).json({ error: e?.message ?? 'Error' });
    }
  };
}
