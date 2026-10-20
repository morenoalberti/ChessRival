' Lanzador de ChessRival sin ventanas: arranca el servidor intermedio y la web en segundo plano y abre el navegador.
' Para detenerlo todo, ejecuta detener.bat.
Set shell = CreateObject("WScript.Shell")
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = carpeta
comillas = Chr(34)
orden = "cmd.exe /d /s /c " & comillas & comillas & carpeta & "\iniciar.bat" & comillas & " oculto" & comillas
resultado = shell.Run(orden, 0, True)
If resultado = 1 Then
  MsgBox "No se ha podido iniciar la web de ChessRival. Revisa el archivo .web.log de la carpeta del proyecto.", vbExclamation, "ChessRival"
ElseIf resultado = 2 Then
  MsgBox "La web esta disponible, pero el servidor intermedio no ha arrancado. Revisa .worker.log en la carpeta del proyecto.", vbExclamation, "ChessRival"
End If
