const jwt = require('jsonwebtoken');
const User = require('../models/User');

const AUTH_COOKIE_NAME = 'authToken';

const isApprovedUser = (user) => {
  return Boolean(user && user.isActive && (!user.status || user.status === 'approved'));
};

const parseCookies = (cookieHeader = '') => {
  return String(cookieHeader || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index === -1) return cookies;
      const key = decodeURIComponent(part.slice(0, index).trim());
      const value = decodeURIComponent(part.slice(index + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
};

const getRequestToken = (req) => {
  const authHeader = req.header('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] || '';
};

const loadUserFromToken = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return User.findById(decoded.userId);
};

const auth = async (req, res, next) => {
  try {
    const token = getRequestToken(req);

    if (!token) {
      return res.status(401).json({
        error: '访问被拒绝：未提供认证令牌'
      });
    }

    const user = await loadUserFromToken(token);

    if (!user) {
      return res.status(401).json({
        error: '认证失败：用户不存在'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        error: '账号已被禁用'
      });
    }

    if (user.status && user.status !== 'approved') {
      return res.status(401).json({
        error: '账号未通过审核'
      });
    }

    req.user = user;
    req.token = token;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: '无效的认证令牌'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: '认证令牌已过期'
      });
    }

    console.error('认证中间件错误:', error);
    res.status(500).json({
      error: '服务器认证错误'
    });
  }
};

const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: '访问被拒绝：需要管理员权限'
    });
  }
  next();
};

const researcherAuth = (req, res, next) => {
  if (!['admin', 'researcher'].includes(req.user.role)) {
    return res.status(403).json({
      error: '访问被拒绝：需要研究员或管理员权限'
    });
  }
  next();
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = getRequestToken(req);

    if (token) {
      const user = await loadUserFromToken(token);

      if (isApprovedUser(user)) {
        req.user = user;
        req.token = token;
      }
    }

    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  AUTH_COOKIE_NAME,
  auth,
  adminAuth,
  researcherAuth,
  optionalAuth
};
