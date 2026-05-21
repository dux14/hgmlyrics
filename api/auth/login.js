import { allowMethods, withErrors } from '../_lib/http.js';
import { signAdminToken } from '../_lib/auth.js';

const PIN = process.env.ADMIN_PIN;
if (!PIN) {
  throw new Error('ADMIN_PIN is required');
}

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['POST'])) return;
  const { pin } = req.body ?? {};
  if (!pin) {
    res.status(400).json({ error: 'PIN is required' });
    return;
  }
  if (pin !== PIN) {
    res.status(401).json({ error: 'Invalid PIN' });
    return;
  }
  res.status(200).json({ token: signAdminToken() });
});
