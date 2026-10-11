/** Constant script, arguments come from a local job file, never from shell interpolation. */
export const buildScript = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$jobFile = $env:OFFICE_DEV_APK_JOB
$job = Get-Content -LiteralPath $jobFile -Raw | ConvertFrom-Json
$folder = Split-Path -Parent $jobFile
$source = $job.config.sourceDir
$script = Join-Path $source 'Tools\Build-Quest.ps1'
. (Join-Path $source 'Tools\BuildLock.ps1')
Set-Content -LiteralPath (Join-Path $folder 'phase.txt') -Value 'waiting'
$lock = Enter-BuildLock 'Global\zrb-build-folder' -OnWait { Write-Output 'Warte auf den gemeinsamen Unity-Build-Platz...' } -OnAbandoned { Write-Output 'Verlassenen Build-Platz übernommen.' }
try {
  Set-Content -LiteralPath (Join-Path $folder 'phase.txt') -Value 'building'
  & git -C $source fetch --quiet origin
  if ($LASTEXITCODE -ne 0) { throw 'Abruf des aktuellen Branches fehlgeschlagen. Kein veralteter Build.' }
  $revision = (& git -C $source rev-parse --verify ($job.config.ref + '^{commit}')).Trim()
  if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Build-Commit konnte nicht ermittelt werden.' }
  Set-Content -LiteralPath (Join-Path $folder 'revision.txt') -Value $revision
  Write-Output ('Baue Commit ' + $revision)
  $started = [DateTime]::UtcNow
  $arguments = @{ Ref = $revision; Main = $source; Folder = $job.config.buildDir }
  if ($job.kind -eq 'store') {
    if (-not $job.config.storeApkName) { throw 'Store-APK-Dateiname fehlt.' }
    $arguments.Store = $true
    $apkName = $job.config.storeApkName
  } elseif (-not $job.kind -or $job.kind -eq 'development') {
    $arguments.Development = $true
    $apkName = $job.config.apkName
  } else { throw 'Unbekannte APK-Auswahl.' }
  if ($job.config.launcher) { $arguments.Launcher = $job.config.launcher }
  & $script @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Build-Script fehlgeschlagen.' }
  $apk = Join-Path $source ('Builds\Quest\' + $apkName)
  $file = Get-Item -LiteralPath $apk
  if ($file.Length -lt 4 -or $file.LastWriteTimeUtc -lt $started.AddSeconds(-2)) { throw 'Keine neue APK erzeugt. Vorherige APK wird nicht als neuer Build veröffentlicht.' }
  Set-Content -LiteralPath (Join-Path $folder 'phase.txt') -Value 'publishing'
  # Copy under the same named mutex: the next Unity job cannot replace this file during publication.
  Copy-Item -LiteralPath $apk -Destination (Join-Path $folder 'app.apk.part')
} finally { $lock.ReleaseMutex(); $lock.Dispose() }
`;
