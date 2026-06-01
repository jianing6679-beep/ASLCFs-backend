# 安全用户认证系统 - Node.js + Express + MongoDB

## 技术栈
- **后端**: Node.js + Express.js
- **数据库**: MongoDB (或 PostgreSQL/MySQL)
- **认证**: JWT (JSON Web Tokens)
- **密码哈希**: bcrypt
- **输入验证**: Joi 或 express-validator

## 项目结构
```
server/
├── models/
│   └── User.js          # 用户模型
├── routes/
│   ├── auth.js          # 认证路由
│   └── users.js         # 用户管理路由
├── middleware/
│   ├── auth.js          # JWT认证中间件
│   └── validation.js    # 输入验证中间件
├── config/
│   └── database.js      # 数据库配置
├── app.js               # 主应用文件
└── package.json
```

## 核心文件示例

### models/User.js
```javascript
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    minlength: 3,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// 密码哈希中间件
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 验证密码方法
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
```

### routes/auth.js
```javascript
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// 注册路由
router.post('/register', [
  body('username').isLength({ min: 3, max: 50 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    // 检查用户是否已存在
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        message: '用户名或邮箱已被注册' 
      });
    }

    // 创建新用户
    const user = new User({ username, email, password });
    await user.save();

    // 生成JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: '注册成功',
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 登录路由
router.post('/login', [
  body('username').trim().escape(),
  body('password').exists()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 验证密码
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: '用户名或密码错误' });
    }

    // 生成JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: '登录成功',
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '服务器错误' });
    }
});

module.exports = router;
```

### middleware/auth.js
```javascript
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: '未提供认证令牌' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: '无效的认证令牌' });
  }
};

module.exports = auth;
```

### app.js
```javascript
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');

const app = express();

// 安全中间件
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// 请求频率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100 // 限制每个IP 15分钟内最多100次请求
});
app.use(limiter);

// 登录请求特殊限制
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 5, // 限制登录尝试次数
  message: '登录尝试过于频繁，请15分钟后重试'
});
app.use('/api/auth/login', authLimiter);

// 解析JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 数据库连接
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// 路由
app.use('/api/auth', authRoutes);

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: '服务器内部错误' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## 前端更新

### 更新 script.js 中的认证函数
```javascript
// 更新登录函数
async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok) {
      // 存储token到localStorage
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      alert('登录成功！');
      window.location.href = 'index.html';
    } else {
      alert(data.message || '登录失败');
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('网络错误，请重试');
  }
}

// 更新注册函数
async function handleRegister(event) {
  event.preventDefault();
  const username = document.getElementById("regUsername").value;
  const email = document.getElementById("regEmail").value;
  const password = document.getElementById("regPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    alert("密码不匹配！");
    return;
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, email, password })
    });

    const data = await response.json();

    if (response.ok) {
      alert('注册成功！请登录。');
      window.location.href = 'login.html';
    } else {
      alert(data.message || '注册失败');
    }
  } catch (error) {
    console.error('Register error:', error);
    alert('网络错误，请重试');
  }
}

// 检查登录状态的函数
function checkAuthStatus() {
  const token = localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  
  if (token && user) {
    // 显示用户信息，隐藏登录/注册链接
    document.getElementById('navLogin').style.display = 'none';
    document.getElementById('navRegister').style.display = 'none';
    // 可以添加用户信息显示
  }
}

// 在页面加载时检查认证状态
document.addEventListener("DOMContentLoaded", () => {
  // ... 现有代码 ...
  checkAuthStatus();
});
```

## 环境变量配置

创建 `.env` 文件：
```
MONGODB_URI=mongodb://localhost:27017/environment_db
JWT_SECRET=your_super_secret_jwt_key_here
PORT=5000
FRONTEND_URL=http://your-school-server.com
NODE_ENV=production
```

## 部署到学校服务器

### 1. 服务器要求
- Node.js 16+
- MongoDB 4.4+
- PM2 (进程管理)

### 2. 安装依赖
```bash
npm install
```

### 3. 启动服务
```bash
# 开发环境
npm run dev

# 生产环境
npm start
```

### 4. 使用PM2管理
```bash
npm install -g pm2
pm2 start app.js --name "env-website-api"
pm2 save
pm2 startup
```

### 5. Nginx反向代理配置
```nginx
server {
    listen 80;
    server_name your-school-server.com;

    # 静态文件
    location / {
        root /path/to/your/website;
        try_files $uri $uri/ /index.html;
    }

    # API代理
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 安全增强措施

### 1. HTTPS配置
- 获取SSL证书（Let's Encrypt）
- 配置Nginx强制HTTPS

### 2. 数据库安全
- 使用强密码
- 限制数据库用户权限
- 定期备份

### 3. 服务器安全
- 定期更新系统
- 配置防火墙
- 使用fail2ban防止暴力攻击

### 4. 监控和日志
- 设置日志轮转
- 监控服务器资源使用
- 配置错误告警

这个实现提供了企业级的用户认证系统，具有良好的安全性和可扩展性。