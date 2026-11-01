param(
  [ValidateSet("web", "worker", "check")]
  [string]$Mode = "web"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

# Read local Supabase credentials at launch time. Nothing sensitive is tracked
# in Git or printed by this script.
$statusLines = & cmd.exe /c "npx supabase@latest status --output env 2>nul"
if ($LASTEXITCODE -ne 0) {
  throw "Local Supabase is not running. Start Docker Desktop, then run: npx supabase start"
}

$status = @{}
foreach ($line in $statusLines) {
  if ($line -match '^([A-Z_]+)=(.*)$') { $status[$Matches[1]] = $Matches[2].Trim('"') }
}
foreach ($required in @("API_URL", "ANON_KEY", "SERVICE_ROLE_KEY")) {
  if ([string]::IsNullOrWhiteSpace($status[$required])) { throw "Local Supabase did not return $required." }
}

$localSecretsPath = Join-Path $repoRoot ".vexqora-local.env"
$localSecrets = if (Test-Path -LiteralPath $localSecretsPath) {
  Get-Content -LiteralPath $localSecretsPath | Where-Object { $_ -match '^ENCRYPTION_MASTER_KEY=' } | Select-Object -First 1
}
if (-not $localSecrets) {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $key = [Convert]::ToBase64String($bytes)
  [System.IO.File]::WriteAllText($localSecretsPath, "ENCRYPTION_MASTER_KEY=$key`n")
  $localSecrets = "ENCRYPTION_MASTER_KEY=$key"
}

$env:NEXT_PUBLIC_SUPABASE_URL = $status["API_URL"]
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $status["ANON_KEY"]
$env:SUPABASE_URL = $status["API_URL"]
$env:SUPABASE_SERVICE_ROLE_KEY = $status["SERVICE_ROLE_KEY"]
$env:ENCRYPTION_MASTER_KEY = $localSecrets.Substring("ENCRYPTION_MASTER_KEY=".Length)

if ($Mode -eq "check") {
  Write-Output "Local Vexqora environment is ready."
  Write-Output "Web URL: http://localhost:3000"
  Write-Output "Supabase Studio: http://127.0.0.1:54323"
  exit 0
}

if ($Mode -eq "web") {
  npm run dev --workspace=@crypto-bot/web
} else {
  npm run dev --workspace=@crypto-bot/worker
}
