@echo off
rem ============================================================
rem  CLAUDE.PET host builder (pure ASCII)
rem  Compiles ClaudePetHost.cs with the built-in .NET Framework csc
rem  and copies the WebView2 DLLs next to the exe.
rem ============================================================
setlocal
set "HOST=%~dp0"
set "LIB=%HOST%lib"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [ERR] csc.exe not found
  exit /b 1
)

"%CSC%" /nologo /platform:x64 /target:winexe /optimize+ ^
  /out:"%HOST%ClaudePet.Host.exe" ^
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll ^
  /r:"%LIB%\Microsoft.Web.WebView2.Core.dll" /r:"%LIB%\Microsoft.Web.WebView2.WinForms.dll" ^
  "%HOST%ClaudePetHost.cs"
if errorlevel 1 (
  echo [ERR] compile failed
  exit /b 1
)

copy /y "%LIB%\Microsoft.Web.WebView2.Core.dll" "%HOST%\" >nul
copy /y "%LIB%\Microsoft.Web.WebView2.WinForms.dll" "%HOST%\" >nul
copy /y "%LIB%\WebView2Loader.dll" "%HOST%\" >nul
echo [OK] built %HOST%ClaudePet.Host.exe
endlocal
exit /b 0
