@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-Client.ps1" %*
if errorlevel 1 pause
