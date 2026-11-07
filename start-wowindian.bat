@echo off
REM One-click local start for WowIndian (SQLite demo DB, no Docker needed)
cd /d "%~dp0"

where node >nul 2>nul || (echo [!] Node.js not found. Install Node 20+ from https://nodejs.org then run this again. & pause & exit /b 1)

if not exist ".env" copy ".env.example" ".env" >nul

REM ---- Backend setup (first run only) ----
if not exist "backend\.venv\Scripts\python.exe" (
  echo Setting up Python environment - first run takes a few minutes...
  where uv >nul 2>nul && (
    pushd backend & uv venv --python 3.12 .venv & uv pip install --python .venv\Scripts\python.exe -r requirements.txt & popd
  ) || (
    py -3.12 --version >nul 2>nul || (echo [!] Python 3.12 not found. Install it from https://www.python.org/downloads/ ^(tick "Add to PATH"^) then run this again. & pause & exit /b 1)
    pushd backend & py -3.12 -m venv .venv & .venv\Scripts\python.exe -m pip install -r requirements.txt & popd
  )
)
if not exist "backend\var\news-local.db" (
  echo Creating demo database. SAVE the demo logins printed below!
  pushd backend & .venv\Scripts\python.exe scripts\init_dev_db.py --fresh & popd
  pause
)

REM ---- Frontend setup (first run only) ----
if not exist "frontend\node_modules" (
  echo Installing website packages...
  pushd frontend & call npm install & popd
)

REM ---- Start both servers in their own windows ----
start "WowIndian API (keep open)" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe scripts\run_dev.py"
start "WowIndian Website (keep open)" cmd /k "cd /d %~dp0frontend && npm run dev -- --port 5174 --strictPort"

echo Waiting for servers to start...
timeout /t 12 /nobreak >nul
start "" http://localhost:5174
echo.
echo WowIndian is running at http://localhost:5174  (API docs: http://localhost:8000/docs)
echo Keep the two server windows open. Close them to stop.
pause
