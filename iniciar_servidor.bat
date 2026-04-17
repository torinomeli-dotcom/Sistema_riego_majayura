@echo off
title RIEGO IOT — Servidor Majayura
color 0A

echo.
echo  =============================================
echo    RIEGO IOT v2.0 — Majayura, La Guajira
echo  =============================================
echo.

:: Ir a la carpeta del servidor
cd /d "%~dp0server"

:: Verificar si Node.js esta instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js no esta instalado.
    echo  Descargalo en: https://nodejs.org
    echo.
    pause
    exit /b
)

echo  [OK] Node.js detectado:
node -v

:: Instalar dependencias si no existen
if not exist "node_modules" (
    echo.
    echo  [INFO] Instalando dependencias por primera vez...
    echo.
    npm install
    if %errorlevel% neq 0 (
        color 0C
        echo  [ERROR] Fallo npm install.
        pause
        exit /b
    )
    echo.
    echo  [OK] Dependencias instaladas.
)

:: Mostrar IP local para configurar el .env
echo.
echo  [INFO] Tu IP local:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    echo         %%a
)

echo.
echo  [INFO] Recuerda configurar server\.env con la IP del ESP32
echo.
echo  =============================================
echo    Dashboard: http://localhost:3000
echo    Usuario:   admin
echo    Contrasena: riego2024
echo  =============================================
echo.
echo  Iniciando servidor... (Ctrl+C para detener)
echo.

node server.js

echo.
echo  Servidor detenido.
pause
