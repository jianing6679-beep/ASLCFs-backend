const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { AUTH_COOKIE_NAME, auth } = require('../middleware/auth');
const { checkIpBlock, recordIpFail, resetIpFail } = require('../middleware/risk');
const { sendMail } = require('../config/mailer');
const { isWhitelistedEmail } = require('../config/whitelist');
const {
  validateRegister,
  validateLogin,
  validateProfileUpdate,
  validatePasswordChange
} = require('../middleware/validation');

const router = express.Router();

const createVerifyToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
};

const createPasswordResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
};

const getVerifyLink = (token) => {
  const base = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`;
  return `${base}/api/auth/verify-email?token=${token}`;
};

const getPasswordResetLink = (token) => {
  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
  return `${frontendBase.replace(/\/$/, '')}/reset-password.html?token=${token}`;
};

const isStrongPassword = (value = '') => {
  return value.length >= 6 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
};

const getJwtMaxAgeMs = () => {
  const value = String(process.env.JWT_EXPIRE || '7d').trim();
  const match = value.match(/^(\d+)([smhd])$/i);
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const amount = Number(match[1]);
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  return amount * multipliers[match[2].toLowerCase()];
};

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/'
});

const setAuthCookie = (res, token) => {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...getCookieOptions(),
    maxAge: getJwtMaxAgeMs()
  });
};

const clearAuthCookie = (res) => {
  res.clearCookie(AUTH_COOKIE_NAME, getCookieOptions());
};


// @route   POST /api/auth/register
// @desc    注册新用户
// @access  Public
router.post('/register', checkIpBlock, validateRegister, async (req, res) => {
  try {
    const { username, email, password, profile = {} } = req.body;

    // 检查用户名是否已存在
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({
        error: '用户名已被使用'
      });
    }

    // 检查邮箱是否已存在
    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({
        error: '邮箱已被注册'
      });
    }

    const approvedByWhitelist = isWhitelistedEmail(email);
    const { rawToken, tokenHash, expiresAt } = createVerifyToken();

    // 创建新用户
    const user = new User({
      username,
      email,
      password,
      profile,
      status: approvedByWhitelist ? 'approved' : 'pending',
      isActive: approvedByWhitelist,
      emailVerified: false,
      emailVerifyToken: tokenHash,
      emailVerifyExpires: expiresAt
    });

    await user.save();

    const verifyLink = getVerifyLink(rawToken);
    await sendMail({
      to: email,
      subject: '请验证您的邮箱',
      text: `请点击以下链接验证邮箱：${verifyLink}`,
      html: `<p>请点击以下链接验证邮箱：</p><p><a href="${verifyLink}">${verifyLink}</a></p>`
    });

    if (!approvedByWhitelist) {
      return res.status(201).json({
        message: '注册申请已提交，请等待审核并验证邮箱',
        status: user.status
      });
    }

    // 生成JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
    setAuthCookie(res, token);

    // 返回用户信息（不包含密码）
    res.status(201).json({
      message: '注册成功',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile,
        createdAt: user.createdAt
      }
    });

  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({
      error: '注册失败，请稍后重试'
    });
  }
});

// @route   POST /api/auth/login
// @desc    用户登录
// @access  Public
router.post('/login', checkIpBlock, validateLogin, async (req, res) => {
  try {
    const { username, password } = req.body;

    // 使用自定义方法验证凭据
    const user = await User.findByCredentials(username, password);

    // 生成JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
    setAuthCookie(res, token);

    // 返回用户信息
    resetIpFail(req);
    res.json({
      message: '登录成功',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile,
        lastLogin: user.lastLogin
      }
    });

  } catch (error) {
    recordIpFail(req);
    console.error('登录错误:', error);

    let statusCode = 500;
    let errorMessage = '登录失败，请稍后重试';

    if (error.message.includes('不存在')) {
      statusCode = 401;
      errorMessage = '用户名或密码错误';
    } else if (error.message.includes('密码错误')) {
      statusCode = 401;
      errorMessage = '用户名或密码错误';
    } else if (error.message.includes('审核')) {
      statusCode = 403;
      errorMessage = '账户待审核';
    } else if (error.message.includes('禁用')) {
      statusCode = 403;
      errorMessage = '账户已被禁用';
    } else if (error.message.includes('邮箱未验证')) {
      statusCode = 403;
      errorMessage = '邮箱未验证';
    } else if (error.message.includes('锁定')) {
      statusCode = 423;
      errorMessage = '账户已被锁定，请稍后再试';
    }

    res.status(statusCode).json({
      error: errorMessage
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send a password reset link to the user's educational email.
// @access  Public
router.post('/forgot-password', checkIpBlock, async (req, res) => {
  const genericMessage = 'If this email is registered, a password reset link has been sent.';

  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ message: genericMessage });
    }

    const { rawToken, tokenHash, expiresAt } = createPasswordResetToken();
    user.passwordResetToken = tokenHash;
    user.passwordResetExpires = expiresAt;
    await user.save();

    const resetLink = getPasswordResetLink(rawToken);
    await sendMail({
      to: user.email,
      subject: 'Password reset request',
      text: `Use this link to reset your password within 30 minutes: ${resetLink}`,
      html: `<p>Use the link below to reset your password. It will expire in 30 minutes.</p><p><a href="${resetLink}">${resetLink}</a></p>`
    });

    res.json({ message: genericMessage });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Unable to send password reset email.' });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with a one-time token.
// @access  Public
router.post('/reset-password', checkIpBlock, async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Password confirmation does not match.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: 'Password must include uppercase, lowercase, and a number.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() }
    }).select('+passwordResetToken +passwordResetExpires +password');

    if (!user) {
      return res.status(400).json({ error: 'Reset link is invalid or expired.' });
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.json({ message: 'Password has been reset. Please sign in again.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Unable to reset password.' });
  }
});

// @route   GET /api/auth/verify-email
// @desc    验证邮箱
// @access  Public
router.get('/verify-email', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ error: '缺少验证令牌' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      emailVerifyToken: tokenHash,
      emailVerifyExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ error: '验证链接无效或已过期' });
    }

    user.emailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    if (user.status === 'approved') {
      user.isActive = true;
    }
    await user.save();

    res.json({ message: '邮箱验证成功' });
  } catch (error) {
    console.error('邮箱验证失败:', error);
    res.status(500).json({ error: '邮箱验证失败' });
  }
});

// @route   GET /api/auth/profile
// @desc    获取当前用户信息
// @access  Private
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      error: '获取用户信息失败'
    });
  }
});

// @route   PUT /api/auth/profile
// @desc    更新用户信息
// @access  Private
router.put('/profile', auth, validateProfileUpdate, async (req, res) => {
  try {
    const allowedUpdates = [
      'email',
      'profile.firstName',
      'profile.lastName',
      'profile.institution',
      'profile.title',
      'profile.department',
      'profile.researchInterests'
    ];

    const updates = {};

    // 只允许更新允许的字段
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // 如果更新邮箱，检查是否已被使用
    if (updates.email) {
      const existingUser = await User.findOne({
        email: updates.email,
        _id: { $ne: req.user._id }
      });
      if (existingUser) {
        return res.status(400).json({
          error: '邮箱已被其他用户使用'
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );

    res.json({
      message: '用户信息更新成功',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        profile: user.profile,
        updatedAt: user.updatedAt
      }
    });

  } catch (error) {
    console.error('更新用户信息错误:', error);
    res.status(500).json({
      error: '更新用户信息失败'
    });
  }
});

// @route   PUT /api/auth/change-password
// @desc    更改密码
// @access  Private
router.put('/change-password', auth, validatePasswordChange, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // 验证当前密码
    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(400).json({
        error: '当前密码错误'
      });
    }

    // 更新密码
    user.password = newPassword;
    await user.save();

    res.json({
      message: '密码更改成功'
    });

  } catch (error) {
    console.error('更改密码错误:', error);
    res.status(500).json({
      error: '更改密码失败'
    });
  }
});

// @route   POST /api/auth/logout
// @desc    用户登出
// @access  Private
router.post('/logout', auth, (req, res) => {
  clearAuthCookie(res);
  res.json({
    message: '登出成功'
  });
});

// @route   POST /api/auth/verify-token
// @desc    验证token有效性
// @access  Private
router.post('/verify-token', auth, (req, res) => {
  res.json({
    valid: true,
    user: {
      id: req.user._id,
      username: req.user.username,
      role: req.user.role
    }
  });
});

module.exports = router;
