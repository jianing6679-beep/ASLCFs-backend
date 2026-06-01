const failedMap = new Map();

const WINDOW_MS = Number(process.env.AUTH_FAIL_WINDOW || 15 * 60 * 1000);
const MAX_FAILS = Number(process.env.AUTH_FAIL_MAX || 5);
const BLOCK_MS = Number(process.env.AUTH_FAIL_BLOCK || 15 * 60 * 1000);

const normalizeIp = (req) => {
  return req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
};

const checkIpBlock = (req, res, next) => {
  const ip = normalizeIp(req);
  const entry = failedMap.get(ip);
  if (entry && entry.blockedUntil > Date.now()) {
    return res.status(429).json({
      error: '登录尝试过于频繁，请稍后再试'
    });
  }
  next();
};

const recordIpFail = (req) => {
  const ip = normalizeIp(req);
  const now = Date.now();
  const entry = failedMap.get(ip);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    failedMap.set(ip, {
      firstAttempt: now,
      count: 1,
      blockedUntil: 0
    });
    return;
  }

  entry.count += 1;
  if (entry.count >= MAX_FAILS) {
    entry.blockedUntil = now + BLOCK_MS;
  }
  failedMap.set(ip, entry);
};

const resetIpFail = (req) => {
  const ip = normalizeIp(req);
  failedMap.delete(ip);
};

module.exports = {
  checkIpBlock,
  recordIpFail,
  resetIpFail
};
