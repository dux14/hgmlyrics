import { allowMethods, withErrors } from './_lib/http.js';

export default withErrors(async (req, res) => {
  if (allowMethods(req, res, ['GET'])) return;
  res.status(200).send('ok');
});
