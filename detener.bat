@echo off
rem Detiene los servidores de ChessRival (el servidor intermedio y la web local).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'workerd.exe' -or ($_.Name -match 'node.exe|python.exe|py.exe|pythonw.exe' -and $_.CommandLine -match 'wrangler|servidor\.py') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo ChessRival detenido.
timeout /t 2 >nul
