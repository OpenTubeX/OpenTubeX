$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WindowsPortableSmoke
{
    private const int ShowWindowMinimize = 6;

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    public static IntPtr[] GetVisibleWindows(uint processId)
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, parameter) =>
        {
            GetWindowThreadProcessId(window, out uint ownerProcessId);
            if (ownerProcessId == processId && IsWindowVisible(window))
                windows.Add(window);
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static void MinimizeVisibleWindows(uint processId)
    {
        foreach (var window in GetVisibleWindows(processId))
            ShowWindow(window, ShowWindowMinimize);
    }

}
'@

function Get-MatchingRegistryState {
  param(
    [Parameter(Mandatory)] [string] $Root,
    [Parameter(Mandatory)] [string] $Search
  )

  $result = & reg.exe query $Root /s /f $Search 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }
  return @($result | ForEach-Object { $_.Trim() } | Where-Object {
    $_ -and $_ -notmatch '^End of search:'
  } | Sort-Object -Unique)
}

function Get-HostState {
  $programsDirectory = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $paths = @(
    (Join-Path $env:APPDATA 'OpenTubeX'),
    (Join-Path $env:LOCALAPPDATA 'OpenTubeX'),
    (Join-Path $env:TEMP 'Interposer.log')
  )
  $state = [System.Collections.Generic.List[string]]::new()
  foreach ($item in $paths) {
    if (Test-Path $item) {
      $state.Add($item)
      if ((Get-Item $item) -is [System.IO.DirectoryInfo]) {
        Get-ChildItem $item -Recurse | ForEach-Object { $state.Add($_.FullName) }
      }
    }
  }
  if (Test-Path $programsDirectory) {
    Get-ChildItem $programsDirectory -Filter '*OpenTubeX*.lnk' -Recurse |
      ForEach-Object { $state.Add($_.FullName) }
  }
  foreach ($root in @(
    'HKCU\Software\Classes',
    'HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications',
    'HKCU\Software\OpenTubeX'
  )) {
    foreach ($line in @(Get-MatchingRegistryState -Root $root -Search 'OpenTubeX')) {
      $state.Add("$root`: $line")
    }
  }
  return @($state | Sort-Object -Unique)
}

function Update-AppProcessIds {
  param(
    [Parameter(Mandatory)] [int] $RootProcessId,
    [Parameter(Mandatory)] [AllowEmptyCollection()]
    [System.Collections.Generic.HashSet[int]] $ProcessIds
  )

  $ProcessIds.Add($RootProcessId) | Out-Null
  $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  do {
    $added = $false
    foreach ($process in $processes) {
      if ($ProcessIds.Contains([int] $process.ParentProcessId) -and
          $ProcessIds.Add([int] $process.ProcessId)) {
        $added = $true
      }
    }
  } while ($added)
}

function Wait-ForMainWindow {
  param(
    [Parameter(Mandatory)] [int] $ProcessId,
    [int] $TimeoutSeconds = 45
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ([WindowsPortableSmoke]::GetVisibleWindows($ProcessId).Count -gt 0) {
      return
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for the packaged OpenTubeX window from process $ProcessId"
}

function Wait-ForInterposerState {
  param(
    [Parameter(Mandatory)] [string] $RegistryFile,
    [Parameter(Mandatory)] [int] $RootProcessId,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]] $ProcessIds,
    [int] $TimeoutSeconds = 45
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    Update-AppProcessIds -RootProcessId $RootProcessId -ProcessIds $ProcessIds
    $registryContents = ''
    if (Test-Path $RegistryFile) {
      try {
        $registryContents = Get-Content $RegistryFile -Raw
      } catch [System.IO.IOException] {
        # Interposer rewrites this file while registry calls are in flight.
        # Retry on the next poll if it temporarily holds an exclusive lock.
      }
    }
    if ($registryContents -match '(?i)LocalServer32') {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Interposer did not persist the registry write locally'
}

function Get-PortableDiagnostics {
  param(
    [Parameter(Mandatory)] [string] $RegistryFile,
    [Parameter(Mandatory)] [string] $Shortcut,
    [Parameter(Mandatory)] [string] $DataDirectory,
    [Parameter(Mandatory)] [string] $ReminderFile,
    [Parameter(Mandatory)] [string] $LogDirectory,
    [Parameter(Mandatory)] [int] $RootProcessId,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]] $ProcessIds
  )

  Update-AppProcessIds -RootProcessId $RootProcessId -ProcessIds $ProcessIds
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("Root process: $RootProcessId")
  foreach ($trackedId in $ProcessIds) {
    $process = Get-Process -Id $trackedId -ErrorAction SilentlyContinue
    if ($process) {
      $lines.Add("Process $trackedId is running: $($process.ProcessName)")
    } else {
      $lines.Add("Process $trackedId has exited")
    }
  }
  $lines.Add("Shortcut exists: $(Test-Path $Shortcut)")
  $lines.Add("Reminder file exists: $(Test-Path $ReminderFile)")
  if (Test-Path $ReminderFile) {
    $lines.Add("Reminder contents: $(Get-Content $ReminderFile -Raw)")
  }
  $lines.Add('Portable data files:')
  if (Test-Path $DataDirectory) {
    Get-ChildItem $DataDirectory -Recurse | ForEach-Object {
      $lines.Add($_.FullName)
    }
  }
  $lines.Add('Virtual registry contents:')
  if (Test-Path $RegistryFile) {
    $lines.Add((Get-Content $RegistryFile -Raw))
  }
  if (Test-Path $LogDirectory) {
    foreach ($logFile in Get-ChildItem $LogDirectory -File | Sort-Object LastWriteTime) {
      $lines.Add("Interposer log: $($logFile.FullName)")
      Get-Content $logFile.FullName -Tail 200 | ForEach-Object { $lines.Add($_) }
    }
  }
  return $lines -join "`n"
}

function Stop-RegistryTrace {
  param([Parameter(Mandatory)] [string] $SessionName)

  $output = & logman.exe stop $SessionName -ets 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop the registry trace:`n$output"
  }
}

function Convert-RegistryEventNumber {
  param([Parameter(Mandatory)] [string] $Value)

  $trimmedValue = $Value.Trim()
  if ($trimmedValue -match '^0[xX](?<Hex>[0-9a-fA-F]+)') {
    return [Convert]::ToUInt32($Matches.Hex, 16)
  }
  if ($trimmedValue -match '^(?<Decimal>[0-9]+)') {
    return [Convert]::ToUInt32($Matches.Decimal, 10)
  }
  return $null
}

function Test-SuccessfulRegistryMutation {
  param(
    [Parameter(Mandatory)] [int] $EventId,
    [Parameter(Mandatory)] [hashtable] $EventData
  )

  if (-not $EventData.ContainsKey('Status') -or
      (Convert-RegistryEventNumber $EventData.Status) -ne 0) {
    return $false
  }

  switch ($EventId) {
    1 {
      # CreateKey also reports ordinary opens. Disposition 1 means that the
      # call created a new key; disposition 2 means that it opened one.
      return $EventData.ContainsKey('Disposition') -and
        (Convert-RegistryEventNumber $EventData.Disposition) -eq 1
    }
    { $_ -in 3, 5, 6, 15 } { return $true }
    11 {
      # Only KeyWriteTimeInformation (0) changes persisted key metadata.
      # Other information classes configure the open handle or runtime state.
      return $EventData.ContainsKey('InfoClass') -and
        ((Convert-RegistryEventNumber $EventData.InfoClass) -eq 0 -or
         $EventData.InfoClass -eq 'KeyWriteTimeInformation')
    }
    default { return $false }
  }
}

function Assert-NoHostRegistryWrites {
  param(
    [Parameter(Mandatory)] [string] $TraceFile,
    [Parameter(Mandatory)] [string] $OutputFile,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]] $ProcessIds
  )

  $output = & tracerpt.exe $TraceFile -of XML -o $OutputFile -y 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not decode the registry trace:`n$output"
  }

  [xml] $trace = Get-Content $OutputFile -Raw
  $appRegistryWrites = [System.Collections.Generic.List[string]]::new()
  $externalOpenTubeXRegistryWrites = [System.Collections.Generic.List[string]]::new()
  $registryKeyPaths = @{}

  foreach ($event in $trace.SelectNodes("//*[local-name()='Event']")) {
    $system = $event.SelectSingleNode("./*[local-name()='System']")
    if (-not $system) {
      continue
    }
    $execution = $system.SelectSingleNode("./*[local-name()='Execution']")
    $eventIdNode = $system.SelectSingleNode("./*[local-name()='EventID']")
    if (-not $execution -or -not $eventIdNode) {
      continue
    }

    $eventProcessId = [int] $execution.GetAttribute('ProcessID')
    $eventId = [int] $eventIdNode.InnerText
    $eventData = @{}
    foreach ($dataNode in $event.SelectNodes(
      "./*[local-name()='EventData']/*[local-name()='Data']"
    )) {
      $eventData[$dataNode.GetAttribute('Name')] = $dataNode.InnerText
    }
    if ($eventId -in 1, 2 -and
        $eventData.ContainsKey('Status') -and
        (Convert-RegistryEventNumber $eventData.Status) -eq 0 -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject) {
      $basePath = if ($eventData.ContainsKey('BaseName')) {
        $eventData.BaseName.Trim()
      } else { '' }
      $baseObject = if ($eventData.ContainsKey('BaseObject')) {
        $eventData.BaseObject.Trim()
      } else { '' }
      if (-not $basePath -and $registryKeyPaths.ContainsKey($baseObject)) {
        $basePath = $registryKeyPaths[$baseObject]
      }
      $relativePath = if ($eventData.ContainsKey('RelativeName')) {
        $eventData.RelativeName.Trim()
      } else { '' }
      $keyPath = if ($basePath -and $relativePath) {
        "$basePath\$relativePath"
      } elseif ($relativePath) {
        $relativePath
      } else {
        $basePath
      }
      if ($keyPath) {
        $registryKeyPaths[$eventData.KeyObject.Trim()] = $keyPath
      }
    }
    $keyName = if ($eventData.ContainsKey('KeyName')) {
      $eventData.KeyName.Trim()
    } else { '' }
    if (-not $keyName -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject -and
        $registryKeyPaths.ContainsKey($eventData.KeyObject.Trim())) {
      $eventData.ResolvedKeyName = $registryKeyPaths[$eventData.KeyObject.Trim()]
    }
    $payload = @($eventData.GetEnumerator() | Sort-Object Key |
      ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '
    $description = "event $eventId, process $eventProcessId`: $payload"
    if ($eventId -eq 13 -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject) {
      $registryKeyPaths.Remove($eventData.KeyObject.Trim())
    }
    if (-not (Test-SuccessfulRegistryMutation -EventId $eventId -EventData $eventData)) {
      continue
    }
    if ($ProcessIds.Contains($eventProcessId)) {
      $appRegistryWrites.Add($description)
    } elseif ($payload -match '(?i)OpenTubeX|electron\.app\.OpenTubeX') {
      $externalOpenTubeXRegistryWrites.Add($description)
    }
  }

  if ($appRegistryWrites.Count -gt 0) {
    $details = $appRegistryWrites | Select-Object -First 30 | Out-String
    throw "The portable OpenTubeX process changed the host registry:`n$details"
  }
  if ($externalOpenTubeXRegistryWrites.Count -gt 0) {
    $details = $externalOpenTubeXRegistryWrites | Select-Object -First 30 | Out-String
    throw "Windows changed OpenTubeX registry state outside the portable process:`n$details"
  }
}

$portableDirectory = Resolve-Path 'build\win-unpacked'
$executable = Join-Path $portableDirectory 'OpenTubeX.exe'
$interposer = Join-Path $portableDirectory 'version.dll'
$marker = Join-Path $portableDirectory 'portable.marker'
$license = Join-Path $portableDirectory 'LANCommander.Interposer.LICENSE.txt'
$registryFile = Join-Path $portableDirectory '.interposer\Registry.reg'
$interposerConfig = Join-Path $portableDirectory '.interposer\Config.yml'
$interposerLogDirectory = Join-Path $portableDirectory '.interposer\Logs'
$dataDirectory = Join-Path $portableDirectory 'OpenTubeX-data'
$shortcut = Join-Path $dataDirectory 'OpenTubeX.lnk'
$remindersPath = Join-Path $dataDirectory 'live-reminders.db'
$notificationTitle = 'Portable registry isolation smoke test'
$appProcess = $null
$appProcessIds = [System.Collections.Generic.HashSet[int]]::new()
$traceId = [Guid]::NewGuid().ToString('N')
$traceDirectory = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$traceSession = "OpenTubeX-portable-$traceId"
$traceFile = Join-Path $traceDirectory "$traceSession.etl"
$traceOutputFile = Join-Path $traceDirectory "$traceSession.xml"
$kernelRegistryProvider = '{70EB4F03-C1DE-4F73-A051-33D13D5413BD}'
$allRegistryKeywords = '0xffff'
$verboseTraceLevel = 5
$traceStarted = $false

foreach ($requiredFile in @(
  $executable, $interposer, $marker, $license, $registryFile, $interposerConfig
)) {
  if (-not (Test-Path $requiredFile)) {
    throw "The Windows portable package is missing $requiredFile"
  }
}

$hostStateBefore = @(Get-HostState)
if (Test-Path $dataDirectory) {
  Remove-Item $dataDirectory -Recurse -Force
}
New-Item $dataDirectory -ItemType Directory | Out-Null
$reminder = [ordered]@{
  _id = 'portable01A'
  videoId = 'portable01A'
  startTimestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 20000
  notificationTitle = $notificationTitle
  notificationBody = 'The registry write must remain beside OpenTubeX.'
}
Set-Content $remindersPath -Value ($reminder | ConvertTo-Json -Compress) -Encoding utf8
$diagnosticConfig = Get-Content $interposerConfig -Raw
$diagnosticConfig = $diagnosticConfig.Replace('Files: false', 'Files: true')
$diagnosticConfig = $diagnosticConfig.Replace('Registry: false', 'Registry: true')
$diagnosticConfig = $diagnosticConfig.Replace('Level: Info', 'Level: Debug')
Set-Content $interposerConfig -Value $diagnosticConfig -Encoding utf8

try {
  $traceOutput = & logman.exe start $traceSession -p $kernelRegistryProvider `
    $allRegistryKeywords $verboseTraceLevel `
    -o $traceFile -ets 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not start the registry trace:`n$traceOutput"
  }
  $traceStarted = $true

  $appProcess = Start-Process $executable -PassThru
  Wait-ForMainWindow -ProcessId $appProcess.Id
  Update-AppProcessIds -RootProcessId $appProcess.Id -ProcessIds $appProcessIds

  $loadedModulePaths = @((Get-Process -Id $appProcess.Id).Modules | ForEach-Object {
    $_.FileName
  })
  if ($loadedModulePaths -notcontains $interposer) {
    throw 'The packaged OpenTubeX process did not load LANCommander Interposer'
  }

  [WindowsPortableSmoke]::MinimizeVisibleWindows($appProcess.Id)
  Wait-ForInterposerState -RegistryFile $registryFile `
    -RootProcessId $appProcess.Id -ProcessIds $appProcessIds
  Update-AppProcessIds -RootProcessId $appProcess.Id -ProcessIds $appProcessIds
}
catch {
  if ($appProcess) {
    Write-Output (Get-PortableDiagnostics -RegistryFile $registryFile `
      -Shortcut $shortcut -DataDirectory $dataDirectory -ReminderFile $remindersPath `
      -LogDirectory $interposerLogDirectory -RootProcessId $appProcess.Id `
      -ProcessIds $appProcessIds)
  }
  throw
}
finally {
  if ($appProcess) {
    Update-AppProcessIds -RootProcessId $appProcess.Id -ProcessIds $appProcessIds
  }
  if ($appProcess -and -not $appProcess.HasExited) {
    foreach ($trackedId in $appProcessIds) {
      Stop-Process -Id $trackedId -Force -ErrorAction SilentlyContinue
    }
    $appProcess.WaitForExit()
  }
  if ($traceStarted) {
    Stop-RegistryTrace -SessionName $traceSession
  }
}

Assert-NoHostRegistryWrites -TraceFile $traceFile -OutputFile $traceOutputFile `
  -ProcessIds $appProcessIds
$hostStateAfter = @(Get-HostState)
$hostChanges = @(Compare-Object $hostStateBefore $hostStateAfter)
if ($hostChanges.Count -gt 0) {
  throw "The portable package changed app-owned host state:`n$($hostChanges | Out-String)"
}

Write-Output 'Interposer-backed Windows portable package smoke test passed.'
exit 0
