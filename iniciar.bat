@echo off
rem Arranca ChessRival en local: la web (http://localhost:8765) y el servidor intermedio (Worker, puerto 8787).
rem Antes de abrir nada comprueba que no haya ya uno en marcha: dos servidores en el mismo puerto se estorban y la
rem busqueda de jugadores se queda "Buscando..." para siempre.
rem Normalmente se lanza con ChessRival.vbs (sin ventanas). Para detenerlo todo: detener.bat.
setlocal
cd /d "%~dp0"

rem Sin ventana: si se ejecuta a mano, se relanza oculto a traves de ChessRival.vbs.
if /i not "%~1"=="oculto" (
  wscript.exe "%~dp0ChessRival.vbs"
  exit /b
)

rem No basta con que exista py.exe: puede no tener ningun Python registrado.
rem Se comprueba que el interprete realmente funciona y se prefiere python.
set "PYTHON_CHESSRIVAL="
python -c "import sys; sys.exit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
if not errorlevel 1 (
  set "PYTHON_CHESSRIVAL=python"
  goto python_listo
)
py -3 -c "import sys; sys.exit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
if not errorlevel 1 (
  set "PYTHON_CHESSRIVAL=py -3"
  goto python_listo
)
echo No se encuentra un Python 3 que funcione. > ".web.log"
exit /b 1

:python_listo
set "WORKER_CHESSRIVAL=1"

rem ---- Servidor intermedio (Worker) ----
netstat -ano | findstr /R /C:":8787 .*LISTENING" >nul
if not errorlevel 1 goto worker_ya
if not exist "worker\node_modules\.bin\wrangler.cmd" goto sin_worker
echo Arrancando el servidor intermedio...
start "" /b /d "worker" cmd /c "npm run dev > ..\.worker.log 2>&1"
goto web

:worker_ya
echo El servidor intermedio ya esta en marcha: no se abre otro.
goto web

:sin_worker
echo AVISO: falta instalar el servidor intermedio. Ejecuta "npm install" dentro de la carpeta worker.
echo Falta instalar el servidor intermedio. Ejecuta npm install dentro de worker. > ".worker.log"
set "WORKER_CHESSRIVAL=0"

rem ---- Web ----
:web
netstat -ano | findstr /R /C:":8765 .*LISTENING" >nul
if not errorlevel 1 goto web_ya
start "" /b %PYTHON_CHESSRIVAL% "%~dp0servidor.py" > ".web.log" 2>&1

:web_ya
rem Espera a una respuesta HTTP real antes de abrir el navegador.
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; for($intento=0; $intento -lt 40; $intento++){ try { $respuesta=Invoke-WebRequest 'http://localhost:8765/index.html' -UseBasicParsing -TimeoutSec 1; if($respuesta.StatusCode -eq 200 -and $respuesta.Content -match 'ChessRival'){ exit 0 } } catch {}; Start-Sleep -Milliseconds 250 }; exit 1"
if errorlevel 1 exit /b 1

if "%WORKER_CHESSRIVAL%"=="0" goto abrir_web
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; for($intento=0; $intento -lt 40; $intento++){ try { $respuesta=Invoke-RestMethod 'http://127.0.0.1:8787/' -TimeoutSec 1; if($respuesta.ok -and $respuesta.servicio -eq 'chessrival-worker'){ exit 0 } } catch {}; Start-Sleep -Milliseconds 250 }; exit 1"
if errorlevel 1 set "WORKER_CHESSRIVAL=0"

:abrir_web
rem El modo comprobar permite verificar el BAT sin abrir otra ventana del navegador.
if /i not "%~2"=="comprobar" start "" "http://localhost:8765/index.html?demo"
if "%WORKER_CHESSRIVAL%"=="0" exit /b 2
exit /b 0
