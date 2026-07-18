$ErrorActionPreference = "Stop"

$cursorNodeHelper = "K:\Software\cursor\resources\app\resources\helpers"
if (Test-Path -LiteralPath $cursorNodeHelper) {
  $env:PATH = "$cursorNodeHelper;$env:PATH"
}

$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch '^v22\.') {
  throw "Translunar Desktop requires Node 22.x; found $nodeVersion."
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  & pnpm dev:desktop
  if ($LASTEXITCODE -ne 0) {
    throw "The desktop development process exited with code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
