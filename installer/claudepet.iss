; ============================================================
;  ClaudePet - Inno Setup installer
;  Detects node & claude, lets the user point to their directories,
;  writes app\runtime.ini so the pet runs even without node/claude on PATH.
;  Per-user install (no admin). Built by installer\build-setup.bat.
; ============================================================

#ifndef Root
  #define Root ".."
#endif

[Setup]
AppId={{A6B27F1C-3E2D-4D9B-9A0E-5F1C2B7E8D4A}
AppName=ClaudePet
AppVersion=1.1.0
AppVerName=ClaudePet 1.1.0
AppPublisher=sechenwag
AppPublisherURL=https://github.com/q2815798751/claude-code-desktop-pet
AppSupportURL=https://github.com/q2815798751/claude-code-desktop-pet
DefaultDirName={localappdata}\ClaudePet
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir={#Root}
OutputBaseFilename=ClaudePet-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#Root}\app\pet.ico
UninstallDisplayIcon={app}\app\pet.ico
ShowLanguageDialog=auto

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; --- app (exclude runtime user state) ---
Source: "{#Root}\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion; Excludes: "config.json,host.json,runtime.ini,term.pid,*.log,*.pid"
; --- host: prebuilt window exe + WebView2 DLLs + source + build script ---
Source: "{#Root}\host\ClaudePet.Host.exe"; DestDir: "{app}\host"; Flags: ignoreversion
Source: "{#Root}\host\ClaudePetHost.cs"; DestDir: "{app}\host"; Flags: ignoreversion
Source: "{#Root}\host\build.bat"; DestDir: "{app}\host"; Flags: ignoreversion
Source: "{#Root}\host\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}\host"; Flags: ignoreversion
Source: "{#Root}\host\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}\host"; Flags: ignoreversion
Source: "{#Root}\host\WebView2Loader.dll"; DestDir: "{app}\host"; Flags: ignoreversion
Source: "{#Root}\host\lib\*"; DestDir: "{app}\host\lib"; Flags: recursesubdirs ignoreversion
; --- root launchers + scripts ---
Source: "{#Root}\start-both.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\start-pet.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\stop-pet.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\uninstall.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\install.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\check-env.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\check-env.js"; DestDir: "{app}"; Flags: ignoreversion
; --- docs / readme ---
Source: "{#Root}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\README.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\CHANGELOG.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Root}\docs\*"; DestDir: "{app}\docs"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{userdesktop}\Claude Pet"; Filename: "{app}\start-both.bat"; WorkingDir: "{app}"; IconFilename: "{app}\app\pet.ico"; Tasks: desktopicon
Name: "{userprograms}\Claude Pet"; Filename: "{app}\start-both.bat"; WorkingDir: "{app}"; IconFilename: "{app}\app\pet.ico"

[Run]
Filename: "{app}\start-both.bat"; Description: "{cm:LaunchProgram,ClaudePet}"; Flags: nowait postinstall skipifsilent

[Code]
var
  EnvPage: TWizardPage;
  NodeEdit, ClaudeEdit: TEdit;
  NodeStat, ClaudeStat: TNewStaticText;
  NodeAuto, ClaudeAuto: String;

function RemoveQuotes(const S: String): String;
begin
  Result := S;
  if (Length(S) >= 2) and (S[1] = '"') and (S[Length(S)] = '"') then
    Result := Copy(S, 2, Length(S) - 2);
end;

// scan PATH for an executable, return full path or ''
function ScanPathFor(const ExeName: String): String;
var
  pp, p: String;
begin
  pp := GetEnv('PATH') + ';';
  while Pos(';', pp) > 0 do
  begin
    p := Copy(pp, 1, Pos(';', pp) - 1);
    Delete(pp, 1, Pos(';', pp));
    p := RemoveQuotes(p);
    if (p <> '') and FileExists(p + '\' + ExeName) then
    begin
      Result := p + '\' + ExeName;
      Exit;
    end;
  end;
  Result := '';
end;

function DetectNodeAuto(): String;
var
  c: Array[0..3] of String;
  i: Integer;
begin
  Result := ScanPathFor('node.exe');
  if Result <> '' then Exit;
  c[0] := ExpandConstant('{pf}\nodejs\node.exe');
  c[1] := ExpandConstant('{pf64}\nodejs\node.exe');
  c[2] := ExpandConstant('{localappdata}\Programs\nodejs\node.exe');
  c[3] := ExpandConstant('{pf}\Node.js\node.exe');
  for i := 0 to 3 do
    if FileExists(c[i]) then begin Result := c[i]; Exit; end;
  Result := '';
end;

function DetectClaudeAuto(): String;
var
  nc: String;
begin
  Result := ScanPathFor('claude.cmd');
  if Result = '' then Result := ScanPathFor('claude.exe');
  if Result <> '' then Exit;
  nc := ExpandConstant('{userappdata}\npm\claude.cmd');
  if FileExists(nc) then begin Result := nc; Exit; end;
  nc := ExpandConstant('{userappdata}\npm\claude.exe');
  if FileExists(nc) then begin Result := nc; Exit; end;
  nc := ExpandConstant('{pf}\ClaudeCode\claude.exe');
  if FileExists(nc) then begin Result := nc; Exit; end;
  Result := '';
end;

procedure UpdateStatus(Sender: TObject);
begin
  if (NodeEdit.Text = '') then NodeEdit.Text := NodeAuto;
  if (ClaudeEdit.Text = '') then ClaudeEdit.Text := ClaudeAuto;
  if NodeEdit.Text <> '' then
    NodeStat.Caption := 'detected: ' + NodeEdit.Text
  else
    NodeStat.Caption := 'NOT FOUND - Node.js is required';
  if ClaudeEdit.Text <> '' then
    ClaudeStat.Caption := 'detected: ' + ClaudeEdit.Text
  else
    ClaudeStat.Caption := 'NOT FOUND - Claude Code CLI is required';
end;

procedure Redetect(Sender: TObject);
begin
  NodeAuto := DetectNodeAuto();
  ClaudeAuto := DetectClaudeAuto();
  NodeEdit.Text := NodeAuto;
  ClaudeEdit.Text := ClaudeAuto;
  UpdateStatus(nil);end;

procedure InitializeWizard;
var
  lbl: TNewStaticText;
begin
  EnvPage := CreateCustomPage(wpSelectDir, 'Runtime environment',
    'Detect Node.js and Claude Code. You can point to their folders.');
  lbl := TNewStaticText.Create(EnvPage);
  lbl.AutoSize := True;
  lbl.Caption := 'The pet runs even when node/claude are not on PATH. The paths below are auto-detected and editable: paste or type the full path to node.exe and claude.cmd.';
  lbl.Parent := EnvPage.Surface;

  // Node.js row
  NodeStat := TNewStaticText.Create(EnvPage);
  NodeStat.Left := 0; NodeStat.Top := 40; NodeStat.AutoSize := True;
  NodeStat.Caption := 'Node.js:';
  NodeStat.Parent := EnvPage.Surface;

  NodeEdit := TNewEdit.Create(EnvPage);
  NodeEdit.Left := 0; NodeEdit.Top := 60; NodeEdit.Width := 400; NodeEdit.Height := 21;
  NodeEdit.OnChange := @UpdateStatus;
  NodeEdit.Parent := EnvPage.Surface;

  // Claude row
  ClaudeStat := TNewStaticText.Create(EnvPage);
  ClaudeStat.Left := 0; ClaudeStat.Top := 95; ClaudeStat.AutoSize := True;
  ClaudeStat.Caption := 'Claude Code:';
  ClaudeStat.Parent := EnvPage.Surface;

  ClaudeEdit := TNewEdit.Create(EnvPage);
  ClaudeEdit.Left := 0; ClaudeEdit.Top := 115; ClaudeEdit.Width := 400; ClaudeEdit.Height := 21;
  ClaudeEdit.OnChange := @UpdateStatus;
  ClaudeEdit.Parent := EnvPage.Surface;

  with TNewButton.Create(EnvPage) do
  begin
    Left := 0; Top := 150; Width := 120; Height := 23;
    Caption := 'Re-detect'; OnClick := @Redetect; Parent := EnvPage.Surface;
  end;

  NodeAuto := DetectNodeAuto();
  ClaudeAuto := DetectClaudeAuto();
  NodeEdit.Text := NodeAuto;
  ClaudeEdit.Text := ClaudeAuto;
end;

procedure WriteRuntimeIni;
var
  s: String;
begin
  s := '';
  if (NodeEdit.Text <> '') and FileExists(NodeEdit.Text) then
    s := s + 'NODE=' + NodeEdit.Text + #13#10;
  if (ClaudeEdit.Text <> '') and FileExists(ClaudeEdit.Text) then
    s := s + 'CLAUDE=' + ClaudeEdit.Text + #13#10;
  if s <> '' then
    SaveStringToFile(ExpandConstant('{app}\app\runtime.ini'), s, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    WriteRuntimeIni;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = EnvPage.ID then
  begin
  UpdateStatus(nil);    if (NodeEdit.Text = '') or (ClaudeEdit.Text = '') then
    begin
      MsgBox('Node.js and/or Claude Code were not found.' + #13#10 +
        'You can continue, but the pet will show a warning and may not start until you install them ' +
        'or re-point the paths above.', mbInformation, MB_OK);
    end;
  end;
end;
