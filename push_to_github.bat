@echo off
title Push Project to GitHub
echo ===================================================
echo   Prime Client - GitHub Push Helper
echo ===================================================
echo.

:: Check if git is installed
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo Git is not installed on this system.
    echo Attempting to install Git via winget...
    echo Please click "Yes" on any Administrator/UAC prompts that appear.
    echo.
    winget install --id Git.Git -e --source winget
    if %errorlevel% neq 0 (
        echo.
        echo Git installation failed. Please install Git manually from https://git-scm.com/download/win
        echo and then run this script again.
        pause
        exit /b 1
    )
    echo.
    echo Git installed successfully! Re-checking path...
    :: Refresh path variables
    set "PATH=%PATH%;C:\Program Files\Git\cmd"
)

:: Re-verify git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo Git was installed, but the command prompt needs to be restarted to reload variables.
    echo Please close this window and open push_to_github.bat again!
    pause
    exit /b 0
)

echo Git is ready.
echo.

:: Get GitHub Repository details
set /p repo="Enter your GitHub Repository in 'username/repository' format (e.g. owner/repo): "
if "%repo%"=="" (
    echo Repository name cannot be empty.
    pause
    exit /b 1
)

:: Get GitHub Token/Password
set /p token="Enter your GitHub Personal Access Token (PAT): "
if "%token%"=="" (
    echo Token cannot be empty.
    pause
    exit /b 1
)

:: Parse username
for /f "tokens=1 delims=/" %%a in ("%repo%") do set "username=%%a"

echo.
echo Initializing Git repository...
git init
git branch -M main

echo.
echo Adding files...
git add .

echo.
echo Committing files...
git commit -m "Initialize Prime Client Repository"

echo.
echo Setting remote repository...
git remote remove origin >nul 2>nul
:: Use token in URL to authenticate the push automatically
git remote add origin https://%username%:%token%@github.com/%repo%.git

echo.
echo Pushing to GitHub (main branch)...
git push -u origin main

echo.
echo ===================================================
echo Done! Your source code is now on GitHub!
echo ===================================================
echo.
pause
