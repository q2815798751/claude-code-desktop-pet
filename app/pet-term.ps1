# CLAUDE.PET - terminal host (pure ASCII)
# Opens claude in the user's own home dir, so claude's data and project
# stay in the user profile even if this pet package is moved or deleted.
# Record our own PID so the pet can detect when this terminal/session dies.
Set-Content -LiteralPath (Join-Path $PSScriptRoot 'term.pid') -Value $PID -Encoding Ascii
Set-Location -LiteralPath $env:USERPROFILE

# Resolve claude: app\runtime.ini (installer-set) first, else PATH, else warn.
$claude = $null
$ini = Join-Path $PSScriptRoot 'runtime.ini'
if (Test-Path $ini) {
  foreach ($line in [System.IO.File]::ReadAllLines($ini)) {
    if ($line -match '^\s*CLAUDE\s*=\s*(.+?)\s*$') { $claude = $Matches[1].Trim() }
  }
}
if (-not $claude -or -not (Test-Path $claude)) {
  $cmd = Get-Command claude -ErrorAction SilentlyContinue
  if ($cmd) { $claude = $cmd.Source }
}
if ($claude -and (Test-Path $claude)) {
  & $claude
  exit $LASTEXITCODE
}
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show("Claude Code not found. Install it or point the installer to your claude directory. (npm i -g @anthropic-ai/claude-code)", 'ClaudePet - Error', 16) | Out-Null
exit 1
