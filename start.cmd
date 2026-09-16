@echo off
cd /d "%~dp0"
node scripts/open-web.mjs
if errorlevel 1 pause
