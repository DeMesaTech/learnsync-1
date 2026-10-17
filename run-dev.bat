@echo off
setlocal

set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\.venv\Scripts\python.exe"

if not exist "%ROOT%.env" goto :missing_env
if not exist "%PYTHON%" goto :missing_python
if not exist "%ROOT%frontend\node_modules\vite\bin\vite.js" goto :missing_frontend
if /i "%~1"=="--check" goto :check_ok

pushd "%ROOT%backend"
start "" /b "%PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port 8001
popd

pushd "%ROOT%frontend"
start "" /b cmd /c npm run dev -- --host 127.0.0.1
popd

echo LearnSync API and frontend started in this terminal.
echo API:      http://127.0.0.1:8001
echo Frontend: http://127.0.0.1:5173
exit /b 0

:check_ok
echo LearnSync startup prerequisites are present.
exit /b 0

:missing_env
echo Missing .env at the repository root. Follow the README configuration steps first.
exit /b 1

:missing_python
echo Missing backend\.venv\Scripts\python.exe. Create and install the backend environment first.
exit /b 1

:missing_frontend
echo Missing frontend dependencies. Run npm install from the frontend directory first.
exit /b 1