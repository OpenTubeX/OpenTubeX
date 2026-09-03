$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windowsPortableRegistryTrace.ps1')
& (Join-Path $PSScriptRoot 'testWindowsPortableRegistryTrace.ps1')

$processStartEventId = 1
$fileEventId = @{
  NameCreate = 10
  NameDelete = 11
  Write = 16
  SetInformation = 17
  SetDelete = 18
  Rename = 19
  Flush = 21
  DeletePath = 26
  RenamePath = 27
  SetLinkPath = 28
  RenameAlternate = 29
  CreateNewFile = 30
}
$registryProviderName = 'Microsoft-Windows-Kernel-Registry'
$processProviderName = 'Microsoft-Windows-Kernel-Process'
$fileProviderName = 'Microsoft-Windows-Kernel-File'

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
      $pathItem = Get-Item $item
      $state.Add("$($pathItem.FullName)|$($pathItem.LastWriteTimeUtc.Ticks)")
      if ($pathItem -is [System.IO.DirectoryInfo]) {
        Get-ChildItem $item -Recurse | ForEach-Object {
          $state.Add("$($_.FullName)|$($_.LastWriteTimeUtc.Ticks)")
          if ($_ -isnot [System.IO.DirectoryInfo]) {
            $state.Add("$($_.FullName)|$((Get-FileHash -LiteralPath $_.FullName).Hash)")
          }
        }
      } else {
        $state.Add("$($pathItem.FullName)|$((Get-FileHash -LiteralPath $pathItem.FullName).Hash)")
      }
    }
  }
  if (Test-Path $programsDirectory) {
    Get-ChildItem $programsDirectory -Filter '*OpenTubeX*.lnk' -Recurse |
      ForEach-Object { $state.Add($_.FullName) }
  }
  foreach ($root in @('HKCU\Software')) {
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

function Wait-ForInterposerStateChange {
  param(
    [Parameter(Mandatory)] [string] $RegistryFile,
    [Parameter(Mandatory)] [string] $InitialContents,
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
    if ($registryContents -and $registryContents -ne $InitialContents) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Interposer did not persist any registry state change during startup'
}

function Get-PortableDiagnostics {
  param(
    [Parameter(Mandatory)] [string] $RegistryFile,
    [Parameter(Mandatory)] [string] $Shortcut,
    [Parameter(Mandatory)] [string] $DataDirectory,
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

function Get-TraceEventData {
  param([Parameter(Mandatory)] [System.Xml.XmlElement] $Event)

  $eventData = @{}
  foreach ($dataNode in $Event.SelectNodes(
    "./*[local-name()='EventData']/*[local-name()='Data']"
  )) {
    $eventData[$dataNode.GetAttribute('Name')] = $dataNode.InnerText
  }
  return $eventData
}

function Get-NormalizedTraceEvents {
  param([Parameter(Mandatory)] [xml] $Trace)

  foreach ($event in $Trace.SelectNodes("//*[local-name()='Event']")) {
    $system = $event.SelectSingleNode("./*[local-name()='System']")
    if (-not $system) {
      continue
    }
    $provider = $system.SelectSingleNode("./*[local-name()='Provider']")
    $eventIdNode = $system.SelectSingleNode("./*[local-name()='EventID']")
    if (-not $provider -or -not $eventIdNode) {
      continue
    }
    $execution = $system.SelectSingleNode("./*[local-name()='Execution']")
    $processId = if ($execution -and $execution.HasAttribute('ProcessID')) {
      [int] $execution.GetAttribute('ProcessID')
    } else { $null }

    [PSCustomObject]@{
      ProviderName = $provider.GetAttribute('Name')
      EventId = [int] $eventIdNode.InnerText
      ProcessId = $processId
      Data = Get-TraceEventData $event
    }
  }
}

function Get-ComparablePathTail {
  param([Parameter(Mandatory)] [string] $Path)

  $normalized = $Path.Replace('/', '\').TrimEnd('\').ToUpperInvariant()
  if ($normalized -match '^[A-Z]:(?<Tail>\\.*)$') {
    return $Matches.Tail
  }
  return $normalized
}

function Test-AppOwnedHostPath {
  param(
    [Parameter(Mandatory)] [string] $Candidate,
    [Parameter(Mandatory)] [string[]] $DirectoryTails,
    [Parameter(Mandatory)] [string[]] $FileTails
  )

  $candidatePath = Get-ComparablePathTail $Candidate
  foreach ($directoryTail in $DirectoryTails) {
    if ($candidatePath.EndsWith($directoryTail) -or
        $candidatePath.Contains("$directoryTail\")) {
      return $true
    }
  }
  foreach ($fileTail in $FileTails) {
    if ($candidatePath.EndsWith($fileTail)) {
      return $true
    }
  }
  return $false
}

function Assert-NoHostWrites {
  param(
    [Parameter(Mandatory)] [string] $TraceFile,
    [Parameter(Mandatory)] [string] $OutputFile,
    [Parameter(Mandatory)] [System.Collections.Generic.HashSet[int]] $ProcessIds,
    [Parameter(Mandatory)] [string[]] $HostDirectoryTails,
    [Parameter(Mandatory)] [string[]] $HostFileTails
  )

  $output = & tracerpt.exe $TraceFile -of XML -o $OutputFile -y 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not decode the registry trace:`n$output"
  }

  [xml] $trace = Get-Content $OutputFile -Raw
  $traceEvents = @(Get-NormalizedTraceEvents -Trace $trace)
  $appRegistryWrites = [System.Collections.Generic.List[string]]::new()
  $externalOpenTubeXRegistryWrites = [System.Collections.Generic.List[string]]::new()
  $registryKeyPaths = @{}

  $processParents = @{}
  foreach ($event in $traceEvents) {
    if ($event.ProviderName -ne $processProviderName -or
        $event.EventId -ne $processStartEventId) {
      continue
    }

    $eventData = $event.Data
    if ($eventData.ContainsKey('ProcessID') -and
        $eventData.ContainsKey('ParentProcessID')) {
      $processParents[[int] $eventData.ProcessID] =
        [int] $eventData.ParentProcessID
    }
  }
  do {
    $addedProcess = $false
    foreach ($entry in $processParents.GetEnumerator()) {
      if ($ProcessIds.Contains($entry.Value) -and $ProcessIds.Add($entry.Key)) {
        $addedProcess = $true
      }
    }
  } while ($addedProcess)

  $filePaths = @{}
  $appHostFileWrites = [System.Collections.Generic.List[string]]::new()
  $fileMutationEventIds = @(
    $fileEventId.Write,
    $fileEventId.SetInformation,
    $fileEventId.SetDelete,
    $fileEventId.Rename,
    $fileEventId.Flush,
    $fileEventId.DeletePath,
    $fileEventId.RenamePath,
    $fileEventId.SetLinkPath,
    $fileEventId.RenameAlternate,
    $fileEventId.CreateNewFile
  )

  foreach ($event in $traceEvents) {
    if ($null -eq $event.ProcessId -or
        $event.ProviderName -ne $fileProviderName) {
      continue
    }

    $eventProcessId = $event.ProcessId
    $eventId = $event.EventId
    $eventData = $event.Data
    $eventPath = if ($eventData.ContainsKey('FilePath')) {
      $eventData.FilePath.Trim()
    } elseif ($eventData.ContainsKey('FileName')) {
      $eventData.FileName.Trim()
    } else { '' }
    foreach ($objectName in @('FileObject', 'FileKey')) {
      if ($eventPath -and $eventData.ContainsKey($objectName) -and
          $eventData[$objectName]) {
        $filePaths[$eventData[$objectName].Trim()] = $eventPath
      }
    }
    if (-not $eventPath) {
      foreach ($objectName in @('FileObject', 'FileKey')) {
        if ($eventData.ContainsKey($objectName) -and $eventData[$objectName] -and
            $filePaths.ContainsKey($eventData[$objectName].Trim())) {
          $eventPath = $filePaths[$eventData[$objectName].Trim()]
          break
        }
      }
    }
    if ($ProcessIds.Contains($eventProcessId) -and
        $eventId -in $fileMutationEventIds -and $eventPath -and
        (Test-AppOwnedHostPath -Candidate $eventPath `
          -DirectoryTails $HostDirectoryTails -FileTails $HostFileTails)) {
      $payload = @($eventData.GetEnumerator() | Sort-Object Key |
        ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' '
      $appHostFileWrites.Add(
        "event $eventId, process $eventProcessId, path $eventPath`: $payload"
      )
    }
    if ($eventId -eq $fileEventId.NameDelete -and
        $eventData.ContainsKey('FileKey') -and $eventData.FileKey) {
      $filePaths.Remove($eventData.FileKey.Trim())
    }
  }

  foreach ($event in $traceEvents) {
    if ($null -eq $event.ProcessId -or
        $event.ProviderName -ne $registryProviderName) {
      continue
    }

    $eventProcessId = $event.ProcessId
    $eventId = $event.EventId
    $eventData = $event.Data
    if ($eventId -in @($registryEventId.CreateKey, $registryEventId.OpenKey) -and
        $eventData.ContainsKey('Status') -and
        (Convert-RegistryEventNumber $eventData.Status) -eq
          $registrySuccessStatus -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject) {
      $basePath = if ($eventData.ContainsKey('BaseName')) {
        $eventData.BaseName.Trim()
      } else { '' }
      $baseObject = if ($eventData.ContainsKey('BaseObject')) {
        $eventData.BaseObject.Trim()
      } else { '' }
      if ($registryKeyPaths.ContainsKey($baseObject)) {
        $trackedBasePath = $registryKeyPaths[$baseObject]
        if (-not $basePath) {
          $basePath = $trackedBasePath
        } elseif ($basePath -notmatch '^(?:\\REGISTRY\\|HKEY_)') {
          $basePath = "$trackedBasePath\$basePath"
        }
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
    if ($eventId -eq $registryEventId.Close -and
        $eventData.ContainsKey('KeyObject') -and $eventData.KeyObject) {
      $registryKeyPaths.Remove($eventData.KeyObject.Trim())
    }
    $isAppProcess = $ProcessIds.Contains($eventProcessId)
    if (-not (Test-PortableHostRegistryMutation -EventId $eventId `
        -EventData $eventData -IsAppProcess $isAppProcess)) {
      continue
    }
    if ($isAppProcess) {
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
  if ($appHostFileWrites.Count -gt 0) {
    $details = $appHostFileWrites | Select-Object -First 30 | Out-String
    throw "The portable OpenTubeX process changed app-owned host files:`n$details"
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
$appProcess = $null
$appProcessIds = [System.Collections.Generic.HashSet[int]]::new()
$traceId = [Guid]::NewGuid().ToString('N')
$traceDirectory = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$traceSession = "OpenTubeX-portable-$traceId"
$traceFile = Join-Path $traceDirectory "$traceSession.etl"
$traceOutputFile = Join-Path $traceDirectory "$traceSession.xml"
$traceProvidersFile = Join-Path $traceDirectory "$traceSession-providers.txt"
$kernelRegistryProvider = '{70EB4F03-C1DE-4F73-A051-33D13D5413BD}'
$kernelProcessProvider = '{22FB2CD6-0E7B-422B-A0C7-2FAD1FD0E716}'
$kernelFileProvider = '{EDD08927-9CC4-4E65-B970-C2560FB5C289}'
$allRegistryKeywords = '0xffff'
$processStartKeywords = '0x10'
$fileMutationKeywords = '0x1e30'
$verboseTraceLevel = 5
$traceStarted = $false
$hostDirectoryTails = @(
  (Get-ComparablePathTail (Join-Path $env:APPDATA 'OpenTubeX')),
  (Get-ComparablePathTail (Join-Path $env:LOCALAPPDATA 'OpenTubeX'))
)
$hostFileTails = @(
  (Get-ComparablePathTail (Join-Path $env:TEMP 'Interposer.log')),
  (Get-ComparablePathTail (Join-Path $env:APPDATA `
    'Microsoft\Windows\Start Menu\Programs\OpenTubeX.lnk'))
)
$traceProviders = @(
  "$kernelRegistryProvider $allRegistryKeywords $verboseTraceLevel",
  "$kernelProcessProvider $processStartKeywords $verboseTraceLevel",
  "$kernelFileProvider $fileMutationKeywords $verboseTraceLevel"
)
Set-Content $traceProvidersFile -Value $traceProviders -Encoding ascii

foreach ($requiredFile in @(
  $executable, $interposer, $marker, $license, $registryFile, $interposerConfig
)) {
  if (-not (Test-Path $requiredFile)) {
    throw "The Windows portable package is missing $requiredFile"
  }
}

$hostStateBefore = @(Get-HostState)
$registryStateBefore = Get-Content $registryFile -Raw
if (Test-Path $dataDirectory) {
  Remove-Item $dataDirectory -Recurse -Force
}
New-Item $dataDirectory -ItemType Directory | Out-Null
$diagnosticConfig = Get-Content $interposerConfig -Raw
$diagnosticConfig = $diagnosticConfig.Replace('Files: false', 'Files: true')
$diagnosticConfig = $diagnosticConfig.Replace('Registry: false', 'Registry: true')
$diagnosticConfig = $diagnosticConfig.Replace('Level: Info', 'Level: Debug')
Set-Content $interposerConfig -Value $diagnosticConfig -Encoding utf8

try {
  $traceOutput = & logman.exe start $traceSession -pf $traceProvidersFile `
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
  Wait-ForInterposerStateChange -RegistryFile $registryFile `
    -InitialContents $registryStateBefore `
    -RootProcessId $appProcess.Id -ProcessIds $appProcessIds
  Update-AppProcessIds -RootProcessId $appProcess.Id -ProcessIds $appProcessIds
}
catch {
  if ($appProcess) {
    Write-Output (Get-PortableDiagnostics -RegistryFile $registryFile `
      -Shortcut $shortcut -DataDirectory $dataDirectory `
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

try {
  Assert-NoHostWrites -TraceFile $traceFile -OutputFile $traceOutputFile `
    -ProcessIds $appProcessIds -HostDirectoryTails $hostDirectoryTails `
    -HostFileTails $hostFileTails
}
catch {
  Write-Output (Get-PortableDiagnostics -RegistryFile $registryFile `
    -Shortcut $shortcut -DataDirectory $dataDirectory `
    -LogDirectory $interposerLogDirectory -RootProcessId $appProcess.Id `
    -ProcessIds $appProcessIds)
  throw
}
$hostStateAfter = @(Get-HostState)
$hostChanges = @(Compare-Object $hostStateBefore $hostStateAfter)
if ($hostChanges.Count -gt 0) {
  throw "The portable package changed app-owned host state:`n$($hostChanges | Out-String)"
}

Write-Output 'Interposer-backed Windows portable package smoke test passed.'
exit 0
