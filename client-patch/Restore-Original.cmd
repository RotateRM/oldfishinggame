@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restore-Original.ps1" %*
if errorlevel 1 pause
