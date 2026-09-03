$registryEventId = @{
  CreateKey = 1
  OpenKey = 2
  DeleteKey = 3
  SetValue = 5
  DeleteValue = 6
  SetInformation = 11
  Flush = 12
  Close = 13
  SetSecurity = 15
}
$registrySuccessStatus = 0
$newRegistryKeyDisposition = 1
$keyWriteTimeInformationClass = 0

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
      (Convert-RegistryEventNumber $EventData.Status) -ne $registrySuccessStatus) {
    return $false
  }

  if ($EventId -eq $registryEventId.CreateKey) {
    # CreateKey also reports ordinary opens. NewKey means that the call
    # created a key; OpenedExistingKey means that it only opened one.
    return $EventData.ContainsKey('Disposition') -and
      (Convert-RegistryEventNumber $EventData.Disposition) -eq
        $newRegistryKeyDisposition
  }

  if ($EventId -in @(
    $registryEventId.SetValue,
    $registryEventId.DeleteValue,
    $registryEventId.DeleteKey,
    $registryEventId.Flush,
    $registryEventId.SetSecurity
  )) {
    return $true
  }

  if ($EventId -eq $registryEventId.SetInformation) {
    # Only KeyWriteTimeInformation changes persisted key metadata. Other
    # information classes configure the open handle or runtime state.
    return $EventData.ContainsKey('InfoClass') -and
      ((Convert-RegistryEventNumber $EventData.InfoClass) -eq
         $keyWriteTimeInformationClass -or
       $EventData.InfoClass -eq 'KeyWriteTimeInformation')
  }

  return $false
}

function Test-PortableHostRegistryMutation {
  param(
    [Parameter(Mandatory)] [int] $EventId,
    [Parameter(Mandatory)] [hashtable] $EventData,
    [Parameter(Mandatory)] [bool] $IsAppProcess
  )

  if (-not (Test-SuccessfulRegistryMutation -EventId $EventId `
      -EventData $EventData)) {
    return $false
  }

  if ($EventId -ne $registryEventId.SetValue) {
    return $true
  }

  foreach ($requiredField in @(
    'DataSize', 'KeyName', 'ResolvedKeyName', 'Type', 'ValueName'
  )) {
    if (-not $EventData.ContainsKey($requiredField)) {
      return $true
    }
  }

  # Windows records executable launches under the Background Activity
  # Moderator key before a user-mode proxy DLL can load. When that key was
  # opened before tracing began, ETW reports only its final SID component.
  $isBamExecutionHistoryWrite =
    -not $EventData.KeyName.Trim() -and
    (Convert-RegistryEventNumber $EventData.DataSize) -eq 24 -and
    (Convert-RegistryEventNumber $EventData.Type) -eq 3 -and
    $EventData.ResolvedKeyName.Trim() -match
      '^(?:\\REGISTRY\\MACHINE\\SYSTEM\\(?:CURRENTCONTROLSET|CONTROLSET\d{3})\\SERVICES\\BAM\\STATE\\USERSETTINGS\\)?S-1-5-(?:\d+-)+\d+$' -and
    $EventData.ValueName.Trim() -match
      '^\\Device\\HarddiskVolume\d+\\.+\\OpenTubeX\.exe$'

  # Explorer writes display metadata for newly observed executables from its
  # own process, which the packaged application's Interposer cannot affect.
  $isMuiCacheMetadataWrite =
    -not $IsAppProcess -and
    -not $EventData.KeyName.Trim() -and
    (Convert-RegistryEventNumber $EventData.Type) -eq 1 -and
    $EventData.ResolvedKeyName.Trim() -match
      '^\\REGISTRY\\USER\\S-1-5-(?:\d+-)+\d+_Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache$' -and
    $EventData.ValueName.Trim() -match
      '^(?:[A-Z]:\\|\\Device\\HarddiskVolume\d+\\).+\\OpenTubeX\.exe\.(?:FriendlyAppName|ApplicationCompany)$'

  return -not ($isBamExecutionHistoryWrite -or $isMuiCacheMetadataWrite)
}
