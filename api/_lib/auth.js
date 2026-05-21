import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  throw new Error('JWT_SECRET is required');
}

/**
 * Verify the `Authorization: Bearer <token>` header.
 * Throws an Error with .status = 401 on missing/invalid token.
 * Returns the decoded payload on success.
 */
export function requireAdmin(req) {
  const header = req.headers?.authorization;
  if (!header) {
    const e = new Error('No token provided');
    e.status = 401;
    throw e;
  }
  const token = header.startsWith('Bearer ') ? header.slice(7) : header.split(' ')[1];
  try {
    return jwt.verify(token, SECRET);
  } catch {
    const e = new Error('Invalid or expired token');
    e.status = 401;
    throw e;
  }
}

export function signAdminToken() {
  return jwt.sign({ admin: true }, SECRET, { expiresIn: '7d' });
}
