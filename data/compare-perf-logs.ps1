<#
Compare perf logs by explicit pairs.

You provide $Comparisons as:
  @(
    @("monoFile.log","microFile.log","BehaviorName",Load),
    ...
  )

Outputs:
  - comparison_summary.csv
    One row per comparison pair per metric_name (e.g., login, send_message)

Example:
  $Comparisons = @(
    @("monolithic_perf_scenario104.log","perf_scenario4.log","Login",10),
    @("monolithic_perf_scenario105.log","perf_scenario5.log","Login",100),
    ...
  )
  .\compare-perf-logs.ps1 -BasePath . -OutCsv comparison_summary.csv -Comparisons $Comparisons
#>

param(
  [Parameter(Mandatory=$false)]
  [string]$BasePath = ".",

  [Parameter(Mandatory=$false)]
  [string]$OutCsv = "comparison_summary.csv",

  [Parameter(Mandatory=$true)]
  [object[]]$Comparisons
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-JsonSubstring {
  param([string]$Line)
  if ([string]::IsNullOrWhiteSpace($Line)) { return $null }
  $start = $Line.IndexOf("{")
  if ($start -lt 0) { return $null }
  $end = $Line.LastIndexOf("}")
  if ($end -le $start) { return $null }
  return $Line.Substring($start, $end - $start + 1)
}

function Try-ParseJsonFromLine {
  param([string]$Line)
  $json = Get-JsonSubstring $Line
  if (-not $json) { return $null }
  try { return ($json | ConvertFrom-Json) } catch { return $null }
}

function Get-Prop {
  param([object]$Obj, [string[]]$Names)
  foreach ($n in $Names) {
    $p = $Obj.PSObject.Properties[$n]
    if ($null -ne $p) { return $Obj.$n }
  }
  return $null
}

function Get-P95FromHistogram {
  param([double[]]$BucketsMs, [long[]]$Buckets)

  if (-not $BucketsMs -or -not $Buckets) { return $null }
  $total = 0L
  foreach ($b in $Buckets) { $total += [long]$b }
  if ($total -le 0) { return $null }

  $target = [math]::Ceiling(0.95 * $total)
  $cum = 0L

  for ($i = 0; $i -lt $Buckets.Count; $i++) {
    $cum += [long]$Buckets[$i]
    if ($cum -ge $target) {
      if ($i -lt $BucketsMs.Count) { return [double]$BucketsMs[$i] }
      return [double]$BucketsMs[$BucketsMs.Count - 1]
    }
  }
  return [double]$BucketsMs[$BucketsMs.Count - 1]
}

function Parse-LogMetrics {
  <#
    Returns a list of metric rows (one per tester_metrics record) for one file:
      metric_name, throughput_per_sec, avg_ms, p95_ms, count, err, users_total, scenario, mode, duration_sec
  #>
  param([string]$FilePath)

  $usersCandidates     = @("users_total","users","concurrency","clients","users_attempted")
  $durationCandidates  = @("duration_sec","duration_s","durationSeconds","run_seconds")
  $countCandidates     = @("count","requests","messages","ok","success","completed")
  $errCandidates       = @("err","errors","failed","fail")

  $rows = New-Object System.Collections.Generic.List[object]
  $runStart = $null

  Get-Content -LiteralPath $FilePath | ForEach-Object {
    $obj = Try-ParseJsonFromLine $_
    if ($null -eq $obj) { return }

    if ($obj.kind -eq "tester_run_start") { $runStart = $obj; return }
    if ($obj.kind -ne "tester_metrics") { return }

    $scenario = $obj.scenario
    if (-not $scenario -and $runStart) { $scenario = $runStart.scenario }

    $mode = $null
    if ($runStart) { $mode = $runStart.mode }

    $users = Get-Prop -Obj $obj -Names $usersCandidates
    if (-not $users -and $runStart) { $users = Get-Prop -Obj $runStart -Names $usersCandidates }

    $runDuration = $null
    if ($runStart) { $runDuration = Get-Prop -Obj $runStart -Names $durationCandidates }

    $metricDuration = Get-Prop -Obj $obj -Names $durationCandidates
    $duration = $metricDuration
    if (-not $duration) { $duration = $runDuration }

    $count = Get-Prop -Obj $obj -Names $countCandidates
    $err   = Get-Prop -Obj $obj -Names $errCandidates

    $avgMs = Get-Prop -Obj $obj -Names @("avg_ms","avgMs","mean_ms","meanMs","latency_avg_ms")
    $p95Ms = $null

    $bms = Get-Prop -Obj $obj -Names @("buckets_ms","bucket_ms","latency_buckets_ms")
    $bct = Get-Prop -Obj $obj -Names @("buckets","bucket_counts","latency_buckets")

    if ($bms -and $bct) {
      try {
        $bmsD = @($bms | ForEach-Object { [double]$_ })
        $bctL = @($bct | ForEach-Object { [long]$_ })
        $p95Ms = Get-P95FromHistogram -BucketsMs $bmsD -Buckets $bctL
      } catch { $p95Ms = $null }
    }

    $throughput = Get-Prop -Obj $obj -Names @("msg_throughput_per_sec","throughput_per_sec","throughput","rps","tps")
    if (-not $throughput) {
      if ($count -and $duration -and ([double]$duration -gt 0)) {
        try { $throughput = [double]$count / [double]$duration } catch { $throughput = $null }
      }
    }

    $rows.Add([PSCustomObject]@{
      metric_name        = $obj.name
      throughput_per_sec = $throughput
      avg_ms             = $avgMs
      p95_ms             = $p95Ms
      count              = $count
      err                = $err
      users_total        = $users
      scenario           = $scenario
      mode               = $mode
      duration_sec       = $duration
    }) | Out-Null
  }

  return $rows
}

function Index-ByMetricName {
  param([object[]]$MetricRows)

  $map = @{}
  foreach ($r in $MetricRows) {
    # if duplicates exist, keep the last one (usually the final summary line)
    $map[$r.metric_name] = $r
  }
  return $map
}

$all = New-Object System.Collections.Generic.List[object]

foreach ($c in $Comparisons) {
  if ($c.Count -lt 2) { throw "Each comparison entry must have at least 2 items: monoFile, microFile." }

  $monoFile  = [string]$c[0]
  $microFile = [string]$c[1]
  $behavior  = if ($c.Count -ge 3) { [string]$c[2] } else { "" }
  $load      = if ($c.Count -ge 4) { $c[3] } else { $null }

  $monoPath  = Join-Path $BasePath $monoFile
  $microPath = Join-Path $BasePath $microFile

  if (-not (Test-Path -LiteralPath $monoPath))  { throw "Missing file: $monoPath" }
  if (-not (Test-Path -LiteralPath $microPath)) { throw "Missing file: $microPath" }

  $monoRows  = Parse-LogMetrics -FilePath $monoPath
  $microRows = Parse-LogMetrics -FilePath $microPath

  $monoBy = Index-ByMetricName -MetricRows $monoRows
  $microBy = Index-ByMetricName -MetricRows $microRows

  # Union of metric names found in either file
  $metricNames = @($monoBy.Keys + $microBy.Keys | Sort-Object -Unique)

  foreach ($m in $metricNames) {
    $mr = $monoBy[$m]
    $xr = $microBy[$m]

    $all.Add([PSCustomObject]@{
      behavior = $behavior
      load     = $load
      metric_name = $m

      mono_file = $monoFile
      mono_users_total = if ($mr) { $mr.users_total } else { $null }
      mono_throughput_per_sec = if ($mr) { $mr.throughput_per_sec } else { $null }
      mono_avg_ms = if ($mr) { $mr.avg_ms } else { $null }
      mono_p95_ms = if ($mr) { $mr.p95_ms } else { $null }
      mono_count  = if ($mr) { $mr.count } else { $null }
      mono_err    = if ($mr) { $mr.err } else { $null }

      micro_file = $microFile
      micro_users_total = if ($xr) { $xr.users_total } else { $null }
      micro_throughput_per_sec = if ($xr) { $xr.throughput_per_sec } else { $null }
      micro_avg_ms = if ($xr) { $xr.avg_ms } else { $null }
      micro_p95_ms = if ($xr) { $xr.p95_ms } else { $null }
      micro_count  = if ($xr) { $xr.count } else { $null }
      micro_err    = if ($xr) { $xr.err } else { $null }
    }) | Out-Null
  }
}

$all | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $OutCsv
Write-Host "Wrote: $OutCsv"
Write-Host "Rows:  $($all.Count)"