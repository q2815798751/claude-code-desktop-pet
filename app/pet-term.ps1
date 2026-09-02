# CLAUDE.PET - terminal host (pure ASCII)
# Opens claude in the user's own home dir, so claude's data and project
# stay in C:\Users\sechen even if this pet package is moved or deleted.
# Record our own PID so the pet can detect when this terminal/session dies.
Set-Content -LiteralPath (Join-Path $PSScriptRoot 'term.pid') -Value $PID -Encoding Ascii
Set-Location -LiteralPath $env:USERPROFILE
claude
