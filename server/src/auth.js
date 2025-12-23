const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return secret;
}

function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '90d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ error: 'unauthorized' });

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

module.exports = { signToken, authMiddleware };

