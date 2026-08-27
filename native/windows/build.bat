@echo off
setlocal

rem %~dp0 ends with a backslash; quoting that path as "dir\" breaks cmd parsing.
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "BUILD_DIR=%SCRIPT_DIR%\build"
set "PACKAGE_DIR=%SCRIPT_DIR%\..\win32"
set "ARCH=%~1"
if "%ARCH%"=="" set "ARCH=x64"

where cmake >nul 2>nul
if errorlevel 1 (
  echo CMake was not found on PATH. 1>&2
  exit /b 1
)

cmake -S "%SCRIPT_DIR%" -B "%BUILD_DIR%" -A "%ARCH%"
if errorlevel 1 exit /b %errorlevel%

cmake --build "%BUILD_DIR%" --config Release
if errorlevel 1 exit /b %errorlevel%

if not exist "%PACKAGE_DIR%" mkdir "%PACKAGE_DIR%"
copy /Y "%BUILD_DIR%\Release\smart-zoom-helper.exe" "%PACKAGE_DIR%\smart-zoom-helper.exe" >nul
if errorlevel 1 exit /b %errorlevel%

echo Packaged %PACKAGE_DIR%\smart-zoom-helper.exe
