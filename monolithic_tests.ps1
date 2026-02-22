# ==========================================
# Monolithic runner (with pause checkpoints)
# - Brings stack down (removes volumes)
# - Pauses for confirmation
# - Brings stack up (build + detached)
# - Pauses so you can run `docker stats`
# - Runs scenarios 104..111 via tester-service
# - Writes logs: .\data\monolithic_perf_scenarioXXX.log
# ==========================================

param(
  [string]$ComposeFile = ".\infrastructure\docker-compose.monolith.yml",
  [string]$OutDir = ".\data"
)

$ErrorActionPreference = "Stop"

# Scenarios (monolith equivalents)
$Scenarios = 104,105,106,107,108,109,110,111

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "=== Bringing monolithic stack down ==="
docker compose -f $ComposeFile down -v --remove-orphans

Write-Host ""
Write-Host "Monolithic stack is DOWN."
Read-Host "Press ENTER to continue (this will bring the stack UP)"

Write-Host ""
Write-Host "=== Bringing monolithic stack up (build + detached) ==="
docker compose -f $ComposeFile up -d --build

Write-Host ""
Write-Host "=== Sanity check: current containers ==="
docker compose -f $ComposeFile ps

Write-Host ""
Write-Host "Stack should be RUNNING now."
Write-Host "Open another terminal and run: docker stats"
Read-Host "Press ENTER to start running scenarios"

Write-Host ""
Write-Host "=== Running scenarios (tester will NOT recreate dependencies) ==="

foreach ($s in $Scenarios) {
  $outfile = Join-Path $OutDir ("monolithic_perf_scenario{0}.log" -f $s)

  Write-Host ""
  Write-Host ("--- Scenario {0} => {1}" -f $s, $outfile)

  # --no-deps: do NOT touch other services, just run tester-service
  docker compose -f $ComposeFile run --rm --no-deps `
    -e SCENARIO=$s `
    tester-service | Tee-Object -FilePath $outfile
}

Write-Host ""
Write-Host "=== Done. Logs saved in $OutDir ==="