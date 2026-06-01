@echo off
setlocal

echo ==================================================
echo 环境研究课题组网站后端 (Windows) 测试脚本
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

rem 如果 node_modules 缺失，则安装依赖
if not exist "node_modules" (
  echo 正在安装依赖包...
  npm install
  if errorlevel 1 (
    echo ERROR: 依赖安装失败。
    exit /b 1
  )
)

echo 运行后端测试...
npm test

endlocal
