const fs = require('fs');
const path = require('path');

const WHITELIST_PATH = path.join(__dirname, 'whitelist.json');
let cachedWhitelist = null;

const loadWhitelistFromDisk = () => {
  try {
    const raw = fs.readFileSync(WHITELIST_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const domains = Array.isArray(parsed.allowed_domains) ? parsed.allowed_domains : [];
    return domains
      .map(domain => String(domain).trim().toLowerCase())
      .filter(Boolean);
  } catch (error) {
    return [];
  }
};

const getWhitelist = () => {
  if (!cachedWhitelist) {
    cachedWhitelist = loadWhitelistFromDisk();
  }
  return cachedWhitelist;
};

const reloadWhitelist = () => {
  cachedWhitelist = loadWhitelistFromDisk();
  return cachedWhitelist;
};

const isWhitelistedEmail = (email) => {
  if (!email || !email.includes('@')) return false;
  const domain = email.split('@').pop().toLowerCase();
  const whitelist = getWhitelist();
  return whitelist.some(allowed =>
    domain === allowed || domain.endsWith(`.${allowed}`)
  );
};

module.exports = {
  getWhitelist,
  reloadWhitelist,
  isWhitelistedEmail
};
