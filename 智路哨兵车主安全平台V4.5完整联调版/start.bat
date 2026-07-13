@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js 18 或更高版本。
  pause
  exit /b 1
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
node server.js
pause
