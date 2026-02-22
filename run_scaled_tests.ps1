# ============================
# Scaled microservices runner
# Option A: keep stack up; run tester with --no-deps
# Adds:
#  - REQUIRED -N argument (exits if omitted)
#  - pause after DOWN (user presses Enter)
#  - pause after UP (user verifies via docker stats, then Enter)
#  - output filename includes users: scaledx_n_scenario_y_users_z.log
# ============================

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [int]$N
)

$ErrorActionPreference = "Stop"

# Require explicit -N. (Do NOT allow default.)
if (-not $PSBoundParameters.ContainsKey('N')) {
  Write-Host "ERROR: Missing required argument -N <replicaCount>." -ForegroundColor Red
  Write-Host "Example: .\run_scaled_tests.ps1 -N 2" -ForegroundColor Yellow
  exit 1
}

if ($N -lt 1) {
  Write-Host "ERROR: -N must be >= 1." -ForegroundColor Red
  exit 1
}

# Scenarios
$Scenarios = 4,5,6,7,8,9,10,11

# Map scenario -> user load (based on your scenario definitions)
$ScenarioUsers = @{
  4  = 10
  5  = 100
  6  = 1000
  7  = 5000
  8  = 10
  9  = 100
  10 = 1000
  11 = 5000
}

# Paths
$ComposeFile = ".\infrastructure\docker-compose.yml"
$OutDir      = ".\data"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "=== Bringing stack down ==="
docker compose -f $ComposeFile down -v --remove-orphans

Write-Host ""
Write-Host "=== Old stack is DOWN. ===" -ForegroundColor Green
Read-Host "Press ENTER to continue and bring the scaled stack UP"

Write-Host ""
Write-Host "=== Bringing stack up with scaling (N=$N) ==="
docker compose -f $ComposeFile up -d --build `
  --scale gateway-service=$N `
  --scale login-service=$N `
  --scale chat-service=$N

Write-Host ""
Write-Host "=== Sanity check: containers and replicas ==="
docker compose -f $ComposeFile ps

Write-Host ""
Write-Host "=== PAUSE: Verify the stack is stable ===" -ForegroundColor Cyan
Write-Host "In another terminal, run:  docker stats" -ForegroundColor Cyan
Write-Host "Then confirm no replicas are crash-looping and resource usage looks reasonable." -ForegroundColor Cyan
Read-Host "Press ENTER to start running scenarios"

Write-Host ""
Write-Host "=== Running scenarios (tester will NOT touch other services) ==="

foreach ($s in $Scenarios) {
  $users = $ScenarioUsers[$s]
  if (-not $users) {
    Write-Host "ERROR: No user-count mapping found for scenario $s" -ForegroundColor Red
    exit 1
  }

  $outfile = Join-Path $OutDir ("scaledx_{0}_scenario_{1}_users_{2}.log" -f $N, $s, $users)
  Write-Host ("--- Scenario {0} (users={1}) => {2}" -f $s, $users, $outfile)

  # IMPORTANT: --no-deps prevents Compose from reconciling scaled services back to 1
  docker compose -f $ComposeFile run --rm --no-deps `
    -e SCENARIO=$s `
    tester-service | Tee-Object -FilePath $outfile
}

Write-Host ""
Write-Host "=== Done. Logs saved in $OutDir ===" -ForegroundColor Green