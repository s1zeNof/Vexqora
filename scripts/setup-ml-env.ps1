# Vexqora Local Machine Learning Environment Setup Script
# Sets up standalone Python 3.11 + Polars + PyArrow + CatBoost + LightGBM via Astral uv

$ErrorActionPreference = "Stop"

Write-Host "`n🧠 Vexqora ML Environment Setup" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════" -ForegroundColor Cyan

# 1. Check or install Astral uv
Write-Host "1. Checking Astral uv package manager..." -ForegroundColor Yellow
$uvCmd = Get-Command "uv" -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  $uvLocal = "$HOME\.local\bin\uv.exe"
  $uvCargo = "$HOME\.cargo\bin\uv.exe"
  if (Test-Path $uvLocal) {
    $env:PATH = "$HOME\.local\bin;" + $env:PATH
  } elseif (Test-Path $uvCargo) {
    $env:PATH = "$HOME\.cargo\bin;" + $env:PATH
  } else {
    Write-Host "Installing uv (ultra-fast Python package manager)..." -ForegroundColor Cyan
    powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
    $env:PATH = "$HOME\.local\bin;" + $env:PATH
  }
}

Write-Host "✅ uv is ready: $(uv --version)" -ForegroundColor Green

# 2. Install standalone Python 3.11 via uv
Write-Host "`n2. Provisioning isolated Python 3.11 environment..." -ForegroundColor Yellow
uv python install 3.11

# 3. Create virtual environment
$venvPath = Join-Path $PSScriptRoot "..\.venv"
if (-not (Test-Path $venvPath)) {
  Write-Host "Creating .venv virtual environment..." -ForegroundColor Cyan
  uv venv "$venvPath" --python 3.11
}

# 4. Install ML & Quant Data stack
Write-Host "`n3. Installing high-performance Quantitative ML stack (Polars, PyArrow, CatBoost, LightGBM, DuckDB)..." -ForegroundColor Yellow
uv pip install --python "$venvPath" polars pyarrow duckdb catboost lightgbm fastapi uvicorn

Write-Host "`n══════════════════════════════════════════════" -ForegroundColor Green
Write-Host "🎉 Vexqora ML Environment successfully configured!" -ForegroundColor Green
Write-Host "Python location: $venvPath\Scripts\python.exe" -ForegroundColor White
Write-Host "To activate in PowerShell:" -ForegroundColor White
Write-Host "  .venv\Scripts\Activate.ps1" -ForegroundColor Yellow
Write-Host "══════════════════════════════════════════════`n" -ForegroundColor Green
