@echo off
setlocal EnableExtensions
title QrPrinter agent setup

rem Installing a Windows service needs administrator rights, so ask for them
rem once here rather than making the shop open an elevated shell by hand.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator rights...
    powershell -NoProfile -Command "Start-Process -LiteralPath '%~f0' -Verb RunAs"
    exit /b
)

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set RESULT=%errorlevel%
echo.
if not "%RESULT%"=="0" echo Setup did not finish. Read the message above.
pause
exit /b %RESULT%