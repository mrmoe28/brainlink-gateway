@echo off
title Brain Link Gateway
cd /d C:\Users\Dell\Desktop\brainlink-local-agent

:loop
echo [%date% %time%] Clearing port 7400...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| find "LISTENING" ^| find ":7400 "') do (
  taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

echo [%date% %time%] Starting Brain Link Gateway...
node dist\index.js >> logs\gateway.log 2>&1
echo [%date% %time%] Gateway exited (code %errorlevel%). Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
