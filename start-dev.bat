@echo off
rem MindAgentGraph dev launcher (double-click to run).
rem Closes both backend and frontend when this window is closed.

rem cd to the directory of this .bat regardless of where it was launched from.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH.
    echo Install from https://nodejs.org/ then re-run this script.
    pause
    exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
    echo [ERROR] Backend venv not found at backend\.venv
    echo First-time setup:
    echo   cd backend
    echo   uv venv --python 3.13
    echo   uv pip install -e .
    pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo [ERROR] Frontend dependencies not installed.
    echo First-time setup:
    echo   cd frontend
    echo   npm install
    pause
    exit /b 1
)

title MindAgentGraph dev
echo Starting MindAgentGraph...
echo.
echo To stop:  Ctrl+C  (cleanly kills backend + frontend)
echo Closing this window directly may leave orphan processes on ports 1420/8765.
echo If that happens, just run this script again - it auto-clears those ports.
echo.

rem Auto-clear orphan processes on our ports from a previous unclean exit.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":1420 .*LISTENING" 2^>nul') do taskkill /F /T /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8765 .*LISTENING" 2^>nul') do taskkill /F /T /PID %%a >nul 2>&1

node scripts\dev.mjs %*

rem If node exits with non-zero (error / dependency check failed), pause so
rem the user can read the message before the window vanishes.
if errorlevel 1 pause
