@echo off
setlocal

echo ==================================================
echo 环境研究课题组网站后端 (Windows) 启动脚本
echo ==================================================

rem 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: 未检测到 Node.js，请先安装 Node.js 16+。
  exit /b 1
)

rem 检查 npm
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: 未检测到 npm，请确保 Node.js 已正确安装。
  exit /b 1
)

rem 如果 .env 不存在，则从模板复制
if not exist ".env" (
  echo .env 文件不存在，正在从 .env.example 复制...
  copy ".env.example" ".env" >nul
  echo 请编辑 .env 文件以配置 MongoDB 连接和 JWT 密钥。
)

rem 安装依赖
if not exist "node_modules" (
  echo 正在安装依赖包...
  npm install
  if errorlevel 1 (
    echo ERROR: 依赖安装失败。
    exit /b 1
  )
)

echo 启动后端服务...
npm run dev

endlocal
