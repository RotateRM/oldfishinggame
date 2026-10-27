@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply-Patch.ps1" %*
if errorlevel 1 pause
