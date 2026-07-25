$ErrorActionPreference = "Stop"

$cursorNodeHelper = "K:\Software\cursor\resources\app\resources\helpers"
if (Test-Path -LiteralPath $cursorNodeHelper) {
  $env:PATH = "$cursorNodeHelper;$env:PATH"
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repositoryRoot
try {
  & node scripts/check-node-version.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "The Node.js version check failed."
  }
  & pnpm dev:desktop
  if ($LASTEXITCODE -ne 0) {
    throw "The desktop development process exited with code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
