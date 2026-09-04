$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'windowsPortableRegistryTrace.ps1')

$bamWrite = @{
  CapturedData = ''
  CapturedDataSize = '0'
  DataSize = '24'
  KeyName = ''
  KeyObject = '0xFFFFD2834CF1FB90'
  PreviousData = ''
  PreviousDataCapturedSize = '0'
  PreviousDataSize = '0'
  PreviousDataType = '0'
  ResolvedKeyName = 'S-1-5-21-1456194669-2875347699-3862154473-500'
  Status = '0x0'
  Type = '3'
  ValueName = '\Device\HarddiskVolume5\a\OpenTubeX\OpenTubeX\build\win-unpacked\OpenTubeX.exe'
}

if (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue `
    -EventData $bamWrite -IsAppProcess $true) {
  throw 'Windows BAM execution-history writes must not count as application registry mutations'
}

foreach ($change in @(
  @{ Name = 'DataSize'; Value = '25' },
  @{ Name = 'ResolvedKeyName'; Value = 'HKEY_CURRENT_USER\Software\OpenTubeX' },
  @{ Name = 'Type'; Value = '1' },
  @{ Name = 'ValueName'; Value = 'OpenTubeX' }
)) {
  $nearMiss = $bamWrite.Clone()
  $nearMiss[$change.Name] = $change.Value
  if (-not (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue `
      -EventData $nearMiss -IsAppProcess $true)) {
    throw "A non-BAM registry mutation was ignored after changing $($change.Name)"
  }
}

$muiCacheWrite = @{
  CapturedData = ''
  CapturedDataSize = '0'
  DataSize = '20'
  KeyName = ''
  KeyObject = '0xFFFFAE0868181BA0'
  PreviousData = ''
  PreviousDataCapturedSize = '0'
  PreviousDataSize = '0'
  PreviousDataType = '0'
  ResolvedKeyName = '\REGISTRY\USER\S-1-5-21-1456194669-2875347699-3862154473-500_Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache'
  Status = '0x0'
  Type = '1'
  ValueName = 'D:\a\OpenTubeX\OpenTubeX\build\win-unpacked\OpenTubeX.exe.FriendlyAppName'
}

if (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue `
    -EventData $muiCacheWrite -IsAppProcess $false) {
  throw 'Windows MuiCache writes must not count as application registry mutations'
}
$muiCacheCompanyWrite = $muiCacheWrite.Clone()
$muiCacheCompanyWrite.DataSize = '46'
$muiCacheCompanyWrite.ValueName = $muiCacheCompanyWrite.ValueName.Replace(
  '.FriendlyAppName', '.ApplicationCompany'
)
if (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue `
    -EventData $muiCacheCompanyWrite -IsAppProcess $false) {
  throw 'Windows MuiCache company writes must not count as application registry mutations'
}
if (-not (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue `
    -EventData $muiCacheWrite -IsAppProcess $true)) {
  throw 'Application-process MuiCache writes must remain host registry mutations'
}

$muiCacheKey = 'HKEY_CURRENT_USER\Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache'
$muiCacheValue = 'D:\a\OpenTubeX\OpenTubeX\build\win-unpacked\OpenTubeX.exe.FriendlyAppName    REG_SZ    OpenTubeX'
$normalizedMuiCacheState = @(ConvertTo-MatchingRegistryState -Lines @(
  '',
  $muiCacheKey,
  "    $muiCacheValue",
  'End of search: 1 match(es) found.'
) -Search 'OpenTubeX')
if ($normalizedMuiCacheState.Count -ne 1 -or
    $normalizedMuiCacheState[0] -ne "$muiCacheKey`: $muiCacheValue") {
  throw 'Registry snapshot values did not retain their parent key'
}

$muiCacheSnapshotValue = "HKCU\Software: $($normalizedMuiCacheState[0])"
$muiCacheCompanySnapshotValue = $muiCacheSnapshotValue.Replace(
  '.FriendlyAppName', '.ApplicationCompany'
)
foreach ($line in @(
  $muiCacheSnapshotValue,
  $muiCacheCompanySnapshotValue
)) {
  if (-not (Test-WindowsMuiCacheSnapshotLine -Line $line)) {
    throw "Windows MuiCache snapshot entry was not ignored: $line"
  }
}

foreach ($line in @(
  $muiCacheSnapshotValue.Replace('HKCU\Software:', 'HKLM\Software:'),
  $muiCacheSnapshotValue.Replace('\MuiCache:', '\OpenTubeX:'),
  $muiCacheSnapshotValue.Replace('OpenTubeX.exe.', 'OpenTubeX.dll.'),
  $muiCacheSnapshotValue.Replace('.FriendlyAppName', '.OpenTubeX'),
  $muiCacheSnapshotValue.Replace('REG_SZ', 'REG_BINARY')
)) {
  if (Test-WindowsMuiCacheSnapshotLine -Line $line) {
    throw "A non-MuiCache snapshot entry was ignored: $line"
  }
}

$matchingKeyState = @(ConvertTo-MatchingRegistryState -Lines @(
  'HKEY_CURRENT_USER\Software\OpenTubeX',
  'End of search: 1 match(es) found.'
) -Search 'OpenTubeX')
if ($matchingKeyState.Count -ne 1 -or
    $matchingKeyState[0] -ne 'HKEY_CURRENT_USER\Software\OpenTubeX') {
  throw 'A registry key whose path matches the search was lost from the snapshot'
}

foreach ($change in @(
  @{ Name = 'KeyName'; Value = 'HKEY_CURRENT_USER\Software\OpenTubeX' },
  @{ Name = 'ResolvedKeyName'; Value = 'HKEY_CURRENT_USER\Software\OpenTubeX' },
  @{ Name = 'Type'; Value = '3' },
  @{ Name = 'ValueName'; Value = 'OpenTubeX' }
)) {
  $nearMiss = $muiCacheWrite.Clone()
  $nearMiss[$change.Name] = $change.Value
  if (-not (Test-PortableHostRegistryMutation -EventId $registryEventId.SetValue `
      -EventData $nearMiss -IsAppProcess $false)) {
    throw "A non-MuiCache registry mutation was ignored after changing $($change.Name)"
  }
}

Write-Output 'Windows portable registry trace policy tests passed.'
