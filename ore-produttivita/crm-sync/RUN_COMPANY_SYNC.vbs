Option Explicit
Dim fso, shell, base, logDir, logFile, cmd, pyCmd, rc, out
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\ColligoOreProduttivita")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\company-sync.log"

pyCmd = "py"
If shell.Run("cmd /c where py >nul 2>nul", 0, True) <> 0 Then pyCmd = "python"

Set out = fso.OpenTextFile(logFile, 8, True)
out.WriteLine "[" & Now & "] Avvio ciclo CRM con " & pyCmd & "."
out.Close

cmd = "cmd /c " & pyCmd & " """ & base & "\crm_company_agent.py"" --run >> """ & logFile & """ 2>&1"
rc = shell.Run(cmd, 0, True)

Set out = fso.OpenTextFile(logFile, 8, True)
out.WriteLine "[" & Now & "] Fine ciclo CRM - exit code " & rc & "."
out.Close

WScript.Quit rc
