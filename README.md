# 环境研究课题组网站 - 后端API

基于Node.js + Express + MongoDB的安全后端API服务，用于环境研究课题组网站的用户认证和数据管理。

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 16.0.0
- **MongoDB**: >= 4.4
- **npm** 或 **yarn**

### 安装步骤

1. **克隆项目并进入后端目录**
   ```bash
   cd backend
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **环境配置**
   ```bash
   # 复制环境变量模板
   cp .env.example .env

   # 编辑 .env 文件，配置数据库连接和JWT密钥
   nano .env
   ```

4. **启动MongoDB**
   ```bash
   # 使用Docker启动MongoDB（推荐）
   docker run -d -p 27017:27017 --name mongodb mongo:latest

   # 或使用本地MongoDB服务
   mongod
   ```

5. **启动后端服务**
   ```bash
   # 开发模式
   npm run dev

   # 生产模式
   npm start
   ```

服务将在 `http://localhost:5000` 启动。

## 📋 API文档

### 基础信息
- **Base URL**: `http://localhost:5000/api`
- **认证方式**: JWT Bearer Token
- **数据格式**: JSON

### 主要端点

#### 认证相关
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/profile` - 获取用户信息
- `PUT /api/auth/profile` - 更新用户信息
- `PUT /api/auth/change-password` - 更改密码
- `POST /api/auth/logout` - 用户登出

#### 用户管理（管理员权限）
- `GET /api/users` - 获取用户列表
- `GET /api/users/:id` - 获取单个用户信息
- `PUT /api/users/:id` - 更新用户信息
- `DELETE /api/users/:id` - 禁用用户账户
- `POST /api/users/:id/activate` - 激活用户账户
- `GET /api/users/stats/overview` - 用户统计信息

#### 系统状态
- `GET /api/health` - 健康检查
- `GET /api` - API信息

## 🔧 配置说明

### 环境变量

| 变量名 | 描述 | 默认值 | 必需 |
|--------|------|--------|------|
| `NODE_ENV` | 运行环境 | `development` | 否 |
| `PORT` | 服务器端口 | `5000` | 否 |
| `MONGODB_URI` | MongoDB连接字符串 | - | 是 |
| `JWT_SECRET` | JWT签名密钥 | - | 是 |
| `JWT_EXPIRE` | JWT过期时间 | `7d` | 否 |
| `FRONTEND_URL` | 前端URL | `http://localhost:3000` | 否 |
| `RATE_LIMIT_WINDOW` | 请求频率限制窗口(分钟) | `15` | 否 |
| `RATE_LIMIT_MAX` | 最大请求次数 | `100` | 否 |
| `AUTH_RATE_LIMIT_MAX` | 认证请求最大次数 | `5` | 否 |

### 示例 .env 文件

```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/environment_db
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production_2026
JWT_EXPIRE=7d
FRONTEND_URL=http://localhost:3000
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100
AUTH_RATE_LIMIT_MAX=5
LOG_LEVEL=info
```

## 🛡️ 安全特性

### 密码安全
- **bcrypt哈希**: 12轮盐值哈希
- **密码强度验证**: 必须包含大小写字母和数字
- **密码历史**: 防止重复使用最近密码

### 认证安全
- **JWT Token**: 无状态认证
- **Token过期**: 7天自动过期
- **账户锁定**: 5次失败后2小时锁定

### 请求安全
- **频率限制**: 防止暴力攻击
- **输入验证**: 防止注入攻击
- **CORS配置**: 限制跨域访问
- **Helmet**: HTTP安全头

### 数据安全
- **数据验证**: 严格的输入验证
- **错误处理**: 不暴露敏感信息
- **日志记录**: 安全事件记录

## 🏗️ 项目结构

```
backend/
├── config/
│   └── database.js          # 数据库配置
├── middleware/
│   ├── auth.js             # JWT认证中间件
│   └── validation.js       # 输入验证中间件
├── models/
│   └── User.js             # 用户数据模型
├── routes/
│   ├── auth.js             # 认证路由
│   └── users.js            # 用户管理路由
├── app.js                  # 主应用文件
├── package.json            # 项目配置
├── .env.example            # 环境变量模板
└── README.md              # 项目文档
```

## 🧪 测试API

### 使用curl测试

```bash
# 注册用户
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@nju.edu.cn",
    "password": "TestPass123",
    "confirmPassword": "TestPass123",
    "profile": {
      "institution": "Nanjing University",
      "title": "master"
    }
  }'

# 登录
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "password": "TestPass123"
  }'

# 获取用户信息（需要Bearer token）
curl -X GET http://localhost:5000/api/auth/profile \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 使用Postman测试

1. 导入API端点
2. 设置Authorization为Bearer Token
3. 测试各个端点功能

## 🚀 部署到生产环境

### 1. 服务器准备
```bash
# 更新系统
sudo apt update && sudo apt upgrade

# 安装Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装MongoDB
sudo apt-get install gnupg
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
```

### 2. 部署应用
```bash
# 克隆代码
git clone <your-repo-url>
cd backend

# 安装依赖
npm install --production

# 配置环境变量
cp .env.example .env
nano .env  # 配置生产环境变量

# 使用PM2启动
npm install -g pm2
pm2 start app.js --name "env-website-api"
pm2 save
pm2 startup
```

### 3. 配置Nginx反向代理
```nginx
server {
    listen 80;
    server_name your-domain.com;

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

    location / {
        root /path/to/your/frontend;
        try_files $uri $uri/ /index.html;
    }
}
```

### 4. SSL证书配置
```bash
# 使用Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 📊 监控和维护

### 日志监控
```bash
# 查看PM2日志
pm2 logs env-website-api

# 查看MongoDB日志
tail -f /var/log/mongodb/mongod.log
```

### 性能监控
- 使用PM2监控: `pm2 monit`
- MongoDB监控: `mongotop`, `mongostat`
- 系统监控: `htop`, `iotop`

### 备份策略
```bash
# MongoDB备份
mongodump --db environment_db --out /path/to/backup

# 自动备份脚本
crontab -e
# 添加: 0 2 * * * mongodump --db environment_db --out /path/to/backup/$(date +\%Y\%m\%d)
```

## 🤝 贡献指南

1. Fork项目
2. 创建功能分支: `git checkout -b feature/new-feature`
3. 提交更改: `git commit -m 'Add new feature'`
4. 推送分支: `git push origin feature/new-feature`
5. 创建Pull Request

## 📄 许可证

本项目采用MIT许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 支持

如有问题，请通过以下方式联系：
- 邮箱: baojieli@nuist.edu.cn
- 问题跟踪: [GitHub Issues](https://github.com/your-repo/issues)

---

**南京信息工程大学环境科学与工程学院**  
*环境研究课题组网站后端API*
