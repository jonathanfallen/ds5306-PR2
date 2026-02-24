<#
.SYNOPSIS
  Generate a README.md Markdown section describing project structure.

.EXAMPLE
  .\Generate-ProjectStructureReadme.ps1 -Root "." -ReadmePath ".\README.md" -ReplaceTaggedSection

.EXAMPLE
  .\Generate-ProjectStructureReadme.ps1 -Root "C:\repo" | Set-Content .\structure.md -Encoding UTF8
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$Root = ".",

  [Parameter(Mandatory = $false)]
  [string]$ReadmePath = ".\README.md",

  [Parameter(Mandatory = $false)]
  [int]$MaxDepth = 8,

  [Parameter(Mandatory = $false)]
  [int]$MaxFilesPerDir = 200,

  [Parameter(Mandatory = $false)]
  [switch]$ReplaceTaggedSection
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Directories to exclude (common build/cache folders)
$ExcludeDirs = @(
  ".git", ".svn", ".hg",
  "bin", "obj", ".vs",
  "node_modules", "dist", "build", ".next", ".nuxt",
  ".idea", ".vscode",
  "packages", # comment out if you want monorepo packages included
  ".gradle", ".terraform",
  "__pycache__", ".pytest_cache", ".mypy_cache",
  ".venv", "venv"
)

# File patterns to exclude
$ExcludeFiles = @(
  "*.user", "*.suo", "*.cache", "*.log",
  "*.pdb", "*.dll", "*.exe",
  "*.nupkg", "*.snupkg",
  "*.zip", "*.7z", "*.tar", "*.gz",
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.ico", "*.webp"
)

function Resolve-FullPath([string]$Path) {
  return (Resolve-Path -Path $Path).Path
}

function Should-ExcludePath([string]$FullPath) {
  # Exclude if any segment is in $ExcludeDirs
  $segments = $FullPath.Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries)
  foreach ($s in $segments) {
    if ($ExcludeDirs -contains $s) { return $true }
  }
  return $false
}

function Should-ExcludeFileName([string]$Name) {
  foreach ($pat in $ExcludeFiles) {
    if ($Name -like $pat) { return $true }
  }
  return $false
}

function Get-RelativePath([string]$Base, [string]$Path) {
  $baseUri = [Uri]((Resolve-FullPath $Base).TrimEnd('\') + '\')
  $pathUri = [Uri](Resolve-FullPath $Path)
  $rel = $baseUri.MakeRelativeUri($pathUri).ToString()
  return $rel -replace '/', '\'
}

function Get-TreeLines([string]$RootPath, [int]$DepthLimit) {
  $rootFull = Resolve-FullPath $RootPath
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add((Split-Path $rootFull -Leaf) + "\")

  function Recurse([string]$dir, [int]$depth, [string]$prefix) {
    if ($depth -ge $DepthLimit) { return }

    $children = Get-ChildItem -LiteralPath $dir -Force |
      Where-Object {
        if ($_.PSIsContainer) {
          -not (Should-ExcludePath $_.FullName)
        } else {
          -not (Should-ExcludePath $_.FullName) -and -not (Should-ExcludeFileName $_.Name)
        }
      } |
      Sort-Object @{Expression="PSIsContainer";Descending=$true}, Name

    $count = $children.Count
    for ($i = 0; $i -lt $count; $i++) {
      $c = $children[$i]
      $isLast = ($i -eq $count - 1)
      $branch = if ($isLast) { "└── " } else { "├── " }
      $nextPrefix = $prefix + (if ($isLast) { "    " } else { "│   " })

      if ($c.PSIsContainer) {
        $lines.Add($prefix + $branch + $c.Name + "\")
        Recurse -dir $c.FullName -depth ($depth + 1) -prefix $nextPrefix
      } else {
        $lines.Add($prefix + $branch + $c.Name)
      }
    }
  }

  Recurse -dir $rootFull -depth 0 -prefix ""
  return $lines
}

function Get-Inventory([string]$RootPath, [int]$DepthLimit, [int]$MaxFiles) {
  $rootFull = Resolve-FullPath $RootPath

  # Collect directories up to depth
  $dirs = New-Object System.Collections.Generic.List[string]
  $dirs.Add($rootFull)

  $allDirs = Get-ChildItem -LiteralPath $rootFull -Directory -Recurse -Force |
    Where-Object { -not (Should-ExcludePath $_.FullName) }

  foreach ($d in $allDirs) {
    # Depth check based on relative path segments
    $rel = Get-RelativePath $rootFull $d.FullName
    $depth = ($rel.Split('\', [StringSplitOptions]::RemoveEmptyEntries)).Count
    if ($depth -le $DepthLimit) { $dirs.Add($d.FullName) }
  }

  $sections = New-Object System.Collections.Generic.List[string]

  foreach ($dir in ($dirs | Sort-Object)) {
    $relDir = if ($dir -eq $rootFull) { "." } else { ".\" + (Get-RelativePath $rootFull $dir) }
    $sections.Add("### $relDir")
    $sections.Add("")

    $files = Get-ChildItem -LiteralPath $dir -File -Force |
      Where-Object { -not (Should-ExcludeFileName $_.Name) } |
      Sort-Object Name

    if ($files.Count -eq 0) {
      $sections.Add("_No files_")
      $sections.Add("")
      continue
    }

    if ($files.Count -gt $MaxFiles) {
      $sections.Add("_Too many files to list ($($files.Count)). Showing first $MaxFiles._")
      $sections.Add("")
      $files = $files | Select-Object -First $MaxFiles
    }

    $sections.Add("| File | Size (KB) | Last Modified |")
    $sections.Add("|---|---:|---|")

    foreach ($f in $files) {
      $kb = [Math]::Round(($f.Length / 1KB), 1)
      $lm = $f.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
      $sections.Add("| $($f.Name) | $kb | $lm |")
    }

    $sections.Add("")
  }

  return $sections
}

function Build-Markdown([string]$RootPath) {
  $rootFull = Resolve-FullPath $RootPath
  $now = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

  $tree = Get-TreeLines -RootPath $rootFull -DepthLimit $MaxDepth
  $inv = Get-Inventory -RootPath $rootFull -DepthLimit $MaxDepth -MaxFiles $MaxFilesPerDir

  $md = New-Object System.Collections.Generic.List[string]
  $md.Add("## Project Structure")
  $md.Add("")
  $md.Add("> Generated on $now")
  $md.Add("> Root: $rootFull")
  $md.Add("")
  $md.Add("### Directory Tree")
  $md.Add("")
  $md.Add("```text")
  $md.AddRange($tree)
  $md.Add("```")
  $md.Add("")
  $md.Add("### Directory Inventory")
  $md.Add("")
  $md.AddRange($inv)

  return $md -join "`r`n"
}

function Replace-SectionInReadme([string]$Readme, [string]$NewSection) {
  $startTag = "<!-- PROJECT_STRUCTURE_START -->"
  $endTag   = "<!-- PROJECT_STRUCTURE_END -->"

  if (-not (Test-Path -LiteralPath $Readme)) {
    # Create if missing
    $content = @(
      "# README"
      ""
      $startTag
      $NewSection
      $endTag
      ""
    ) -join "`r`n"
    Set-Content -LiteralPath $Readme -Value $content -Encoding UTF8
    return
  }

  $existing = Get-Content -LiteralPath $Readme -Raw
  if ($existing -notmatch [Regex]::Escape($startTag) -or $existing -notmatch [Regex]::Escape($endTag)) {
    # Append tagged section if tags missing
    $append = @(
      ""
      $startTag
      $NewSection
      $endTag
      ""
    ) -join "`r`n"
    Set-Content -LiteralPath $Readme -Value ($existing + $append) -Encoding UTF8
    return
  }

  $pattern = "(?s)$([Regex]::Escape($startTag)).*?$([Regex]::Escape($endTag))"
  $replacement = "$startTag`r`n$NewSection`r`n$endTag"
  $updated = [Regex]::Replace($existing, $pattern, $replacement)
  Set-Content -LiteralPath $Readme -Value $updated -Encoding UTF8
}

# ---- Main ----
$section = Build-Markdown -RootPath $Root

if ($ReplaceTaggedSection) {
  Replace-SectionInReadme -Readme $ReadmePath -NewSection $section
  Write-Host "Updated README section in: $ReadmePath"
  Write-Host "Tags used:"
  Write-Host "  <!-- PROJECT_STRUCTURE_START -->"
  Write-Host "  <!-- PROJECT_STRUCTURE_END -->"
} else {
  # Print to stdout
  $section
}