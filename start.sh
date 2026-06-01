#!/bin/bash

# 环境研究课题组网站后端启动脚本
# 用于快速启动开发环境

echo "🚀 启动环境研究课题组网站后端服务..."

# 检查Node.js是否安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 16+"
    exit 1
fi

# 检查npm是否安装
if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装"
    exit 1
fi

# 检查MongoDB是否运行
if ! pgrep mongod > /dev/null; then
    echo "⚠️  MongoDB 未运行，尝试启动..."
    if command -v mongod &> /dev/null; then
        mongod --dbpath /usr/local/var/mongodb --logpath /usr/local/var/log/mongodb/mongo.log --fork
        echo "✅ MongoDB 已启动"
    else
        echo "❌ MongoDB 未安装，请先安装 MongoDB"
        echo "   Docker方式: docker run -d -p 27017:27017 --name mongodb mongo:latest"
        exit 1
    fi
fi

# 检查是否存在.env文件
if [ ! -f ".env" ]; then
    echo "📝 创建环境配置文件..."
    cp .env.example .env
    echo "⚠️  请编辑 .env 文件配置数据库连接和JWT密钥"
    echo "   nano .env"
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖包..."
    npm install
fi

# 启动服务
echo "🔥 启动后端服务..."
npm run dev