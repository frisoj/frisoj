@echo off
chcp 65001 >nul
title Bitvavo-bot
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul

echo.
echo  Onderdelen controleren. De eerste keer duurt dit een paar minuten...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto installfail

echo.
echo  De bot start nu. LAAT DIT VENSTER OPEN: sluit je het, dan stopt de bot.
echo  Het dashboard gaat zo vanzelf open in je browser.
echo.
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start "" http://127.0.0.1:4321"
call npm start
echo.
echo  De bot is gestopt.
pause
exit /b 0

:nonode
echo.
echo  Node.js is niet gevonden op deze computer.
echo  Installeer eerst de LTS-versie van https://nodejs.org
echo  en dubbelklik daarna opnieuw op dit bestand.
echo.
pause
exit /b 1

:installfail
echo.
echo  Het installeren is mislukt. Maak een schermafbeelding van dit venster
echo  en stuur die door.
echo.
pause
exit /b 1
