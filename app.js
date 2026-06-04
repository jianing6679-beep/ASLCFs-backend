const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();
const { isSqlMode, connectSql, closeSql } = require('./db/sql');

const toOrigin = (value) => {
  try {
    return value ? new URL(value).origin : null;
  } catch (error) {
    return null;
  }
};

const frontendOrigin = toOrigin(process.env.FRONTEND_URL);
const backendOrigin = toOrigin(process.env.BACKEND_URL);
const staticAllowedOrigins = [
  'https://aslcfs.github.io',
  'https://jianing6679-beep.github.io'
];
const connectSources = ["'self'", ...[frontendOrigin, backendOrigin, ...staticAllowedOrigins].filter(Boolean)];
const allowedCorsOrigins = new Set([frontendOrigin, backendOrigin, ...staticAllowedOrigins].filter(Boolean));
const isDevelopment = process.env.NODE_ENV === 'development';
const allowedCorsHostnames = new Set(['aslcfs.github.io', 'jianing6679-beep.github.io']);

const isAllowedCorsOrigin = (origin) => {
  if (!origin) return isDevelopment ? true : frontendOrigin;
  if (isDevelopment && origin === 'null') return origin;
  if (allowedCorsOrigins.has(origin)) return origin;

  try {
    const { hostname } = new URL(origin);
    if (allowedCorsHostnames.has(hostname)) return origin;

    if (isDevelopment && ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      return origin;
    }
  } catch (error) {
    return false;
  }

  return false;
};

const REQUIRED_ENV = {
  common: ['JWT_SECRET', 'FRONTEND_URL', 'BACKEND_URL'],
  mongo: ['MONGODB_URI'],
  sql: ['DB_HOST', 'DB_NAME', 'DB_USER']
};

const validateRuntimeConfig = () => {
  const mode = isSqlMode() ? 'sql' : 'mongo';
  const required = [...REQUIRED_ENV.common, ...REQUIRED_ENV[mode]];
  const missing = required.filter(name => !String(process.env[name] || '').trim());
  const weakJwtSecrets = new Set([
    'your_super_secret_jwt_key_change_this_in_production_2026',
    'your_super_secret_jwt_key_here'
  ]);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (weakJwtSecrets.has(process.env.JWT_SECRET) || String(process.env.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must be changed to a strong secret with at least 32 characters.');
  }
};

try {
  validateRuntimeConfig();
} catch (error) {
  console.error('Invalid runtime configuration:', error.message);
  process.exit(1);
}

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const announcementRoutes = require('./routes/announcements');
const inventoryRoutes = require('./routes/inventories');
const downloadsRoutes = require('./routes/downloads');
const visitRoutes = require('./routes/visits');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
      connectSrc: connectSources
    }
  }
}));

const corsOptions = {
  origin(origin, callback) {
    return callback(null, isAllowedCorsOrigin(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition', 'X-File-Count']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(compression());

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: {
    error: '请求过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.AUTH_RATE_LIMIT_MAX || 8,
  message: {
    error: '登录尝试过于频繁，请 15 分钟后重试'
  },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const connectDB = async () => {
  try {
    if (isSqlMode()) {
      await connectSql();
      return;
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('数据库连接失败:', error.message);
    process.exit(1);
  }
};

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/inventories', inventoryRoutes);
app.use('/api/downloads', downloadsRoutes);
app.use('/api/analytics', visitRoutes);

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: '服务器运行正常',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

app.get('/api', (req, res) => {
  res.json({
    message: '环境研究课题组网站 API',
    version: '1.0.0',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile',
        logout: 'POST /api/auth/logout'
      },
      users: {
        getAll: 'GET /api/users',
        getById: 'GET /api/users/:id',
        update: 'PUT /api/users/:id',
        delete: 'DELETE /api/users/:id'
      },
      health: 'GET /api/health'
    }
  });
});

app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'API 端点不存在',
    path: req.path,
    method: req.method
  });
});

app.use((err, req, res, next) => {
  console.error('全局错误:', err);

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(val => val.message);
    return res.status(400).json({
      error: '数据验证失败',
      details: errors
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      error: `${field} 已存在`
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: '无效的认证令牌'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: '认证令牌已过期'
    });
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? '服务器内部错误'
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const shutdown = async (signal) => {
  console.log(`收到 ${signal} 信号，正在关闭服务器...`);

  try {
    if (isSqlMode()) {
      await closeSql();
      console.log('SQL 连接已关闭');
    } else {
      await mongoose.connection.close();
      console.log('MongoDB 连接已关闭');
    }
    process.exit(0);
  } catch (error) {
    console.error('关闭数据库连接失败:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`
Environment research backend started
Server: http://localhost:${PORT}
Health: http://localhost:${PORT}/api/health
API docs: http://localhost:${PORT}/api
Environment: ${process.env.NODE_ENV || 'development'}
Database: ${isSqlMode() ? 'SQL connected' : (mongoose.connection.readyState === 1 ? 'MongoDB connected' : 'MongoDB not connected')}
      `);
    });
  } catch (error) {
    console.error('服务器启动失败:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
