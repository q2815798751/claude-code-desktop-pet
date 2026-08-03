# CLAUDE.PET - terminal host (pure ASCII)
# Opens claude in the user's own home dir, so claude's data and project
# stay in C:\Users\sechen even if this pet package is moved or deleted.
Set-Location -LiteralPath $env:USERPROFILE
claude
