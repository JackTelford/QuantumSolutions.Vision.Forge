@echo off
setlocal
rem Vision.Forge setup for Windows. Checks for Node.js 24, ffmpeg, a browser and Blender 5.2,
rem installs the missing ones with -Install, then runs npm ci and doctor.
rem Usage: Setup-VisionForge.cmd [-Install] [-CheckOnly] [-SkipBlender] [-DataDir <dir>]
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Setup did not finish ^(exit code %EXITCODE%^). Read the message above for what to do next.
  pause
)
endlocal & exit /b %EXITCODE%
