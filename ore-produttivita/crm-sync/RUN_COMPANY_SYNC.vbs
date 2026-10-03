Option Explicit
Dim fso, shell, base, runner
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
runner = Chr(34) & base & "\RUN_COMPANY_SYNC.bat" & Chr(34)
shell.Run runner, 0, True
