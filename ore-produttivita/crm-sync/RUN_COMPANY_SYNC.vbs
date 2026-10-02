Option Explicit
Dim fso, shell, base, logDir, logFile, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\ColligoOreProduttivita")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = logDir & "\company-sync.log"
cmd = "cmd /c py """ & base & "\crm_company_agent.py"" --run >> """ & logFile & """ 2>&1"
shell.Run cmd, 0, True
