function isNonEmptyString(x) {
  return typeof x === 'string' && x.trim().length > 0;
}

function validateUsername(username) {
  if (!isNonEmptyString(username)) return 'username required';
  const u = username.trim();
  if (u.length < 3) return 'username too short';
  if (u.length > 32) return 'username too long';
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return 'username invalid';
  return null;
}

function validatePassword(password) {
  if (!isNonEmptyString(password)) return 'password required';
  if (password.length < 8) return 'password too short';
  if (password.length > 128) return 'password too long';
  return null;
}

module.exports = { validateUsername, validatePassword };

