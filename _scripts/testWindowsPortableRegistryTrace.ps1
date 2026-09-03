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
    -EventData $bamWrite) {
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
      -EventData $nearMiss)) {
    throw "A non-BAM registry mutation was ignored after changing $($change.Name)"
  }
}

Write-Output 'Windows portable registry trace policy tests passed.'
