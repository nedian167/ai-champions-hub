param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
function Request([string]$Method, [string]$Path, $Body, [string]$Etag) {
    $arguments = @{ Method = $Method; Uri = "$Api/$Path"; Headers = $Headers }
    if ($Etag) { $arguments.Headers = $Headers.Clone(); $arguments.Headers['If-Match'] = $Etag }
    if ($null -ne $Body) {
        $arguments.ContentType = 'application/json; charset=utf-8'
        $arguments.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 10))
    }
    Invoke-RestMethod @arguments
}
function ReadChampions([bool]$IncludeNormalized) {
    $path = 'abs_champions?$select=abs_championid,abs_userid'
    if ($IncludeNormalized) { $path += ',abs_normalizeduserid' }
    while ($path) {
        $page = Request GET $path $null
        foreach ($row in $page.value) { Write-Output $row }
        $path = $null
        if ($page.'@odata.nextLink') {
            $next = [string]$page.'@odata.nextLink'
            if (-not $next.StartsWith("$Api/", [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected Champion pagination URL.' }
            $path = $next.Substring($Api.Length + 1)
        }
    }
}
function VerifyIdentities {
    foreach ($row in (ReadChampions $true)) {
        $expected = ([string]$row.abs_userid).Trim().ToLowerInvariant()
        if (-not $expected -or $row.abs_normalizeduserid -cne $expected) {
            throw 'Champion identities changed during migration or have not been backfilled. Pause Champion writes and rerun schema installation before continuing.'
        }
    }
}

$groups = @{}
$identities = @{}
foreach ($champion in (ReadChampions $false)) {
    $identity = ([string]$champion.abs_userid).Trim().ToLowerInvariant()
    if (-not $identity -or $identity.Length -gt 320) {
        throw "Champion $($champion.abs_championid) needs a nonempty email/UPN of at most 320 characters. Correct it before enabling uniqueness. No records were changed."
    }
    if (-not $groups.ContainsKey($identity)) { $groups[$identity] = @() }
    $groups[$identity] += $champion.abs_championid
    $identities[$champion.abs_championid] = $identity
}
$duplicates = @($groups.Values | Where-Object { $_.Count -gt 1 })
if ($duplicates.Count) {
    $ids = ($duplicates | ForEach-Object { $_ -join ', ' }) -join '; '
    throw "Duplicate Champion User IDs must be reviewed before enabling the unique key. Record IDs: $ids. Keep the correct profile and review linked requests, claims, participation and points before any explicit cleanup. No records were changed."
}
$attributes = "EntityDefinitions(LogicalName='abs_champion')/Attributes"
$column = @( (Request GET "$($attributes)?`$select=LogicalName,AttributeType&`$filter=LogicalName eq 'abs_normalizeduserid'" $null).value )
if (-not $column.Count) {
    if ($VerifyOnly) { throw 'The normalized Champion identity column is missing. Run schema installation first.' }
    Request POST $attributes @{
        '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'
        SchemaName = 'abs_normalizeduserid'
        DisplayName = @{ LocalizedLabels = @(@{ Label = 'Normalized Champion User ID'; LanguageCode = 1033 }) }
        RequiredLevel = @{ Value = 'None' }
        MaxLength = 320
        FormatName = @{ Value = 'Text' }
    } | Out-Null
    Request POST 'PublishXml' @{ ParameterXml = '<importexportxml><entities><entity>abs_champion</entity></entities></importexportxml>' } | Out-Null
} elseif ($column.Count -ne 1 -or $column[0].AttributeType -ne 'String') {
    throw 'The existing normalized Champion identity column has an incompatible type.'
}
$metadata = Request GET "$attributes(LogicalName='abs_normalizeduserid')/Microsoft.Dynamics.CRM.StringAttributeMetadata?`$select=MaxLength" $null
if ($metadata.MaxLength -ne 320) { throw 'The normalized Champion identity column must have length 320 to fit the unique index.' }
$backfill = @()
foreach ($champion in (ReadChampions $true)) {
    $identity = ([string]$champion.abs_userid).Trim().ToLowerInvariant()
    if (-not $identities.ContainsKey($champion.abs_championid) -or $identities[$champion.abs_championid] -cne $identity) {
        throw 'Champion data changed during identity preflight. Pause Champion writes and rerun schema installation.'
    }
    if ($champion.abs_normalizeduserid -cne $identity) {
        if ($VerifyOnly) { throw 'Normalized Champion identities are not backfilled. Run schema installation first.' }
        if (-not $champion.'@odata.etag') { throw 'Champion row versions are required for safe identity backfill.' }
        $backfill += @{ Id = $champion.abs_championid; Identity = $identity; Etag = $champion.'@odata.etag' }
    }
}
foreach ($row in $backfill) {
    Request PATCH "abs_champions($($row.Id))" @{ abs_normalizeduserid = $row.Identity } $row.Etag | Out-Null
}

$keysPath = "EntityDefinitions(LogicalName='abs_champion')/Keys"
$keys = @( (Request GET "$($keysPath)?`$select=MetadataId,SchemaName,KeyAttributes,EntityKeyIndexStatus" $null).value )
$named = @($keys | Where-Object SchemaName -eq 'abs_ChampionNormalizedUserId')
if ($named.Count -and @($named | Where-Object { @($_.KeyAttributes).Count -ne 1 -or $_.KeyAttributes[0] -ne 'abs_normalizeduserid' }).Count) {
    throw 'The existing abs_ChampionNormalizedUserId key has an incompatible definition.'
}
$compatible = @($keys | Where-Object { $null -ne $_.KeyAttributes -and @($_.KeyAttributes).Count -eq 1 -and $_.KeyAttributes[0] -eq 'abs_normalizeduserid' })
if (@($compatible | Where-Object EntityKeyIndexStatus -eq 'Active').Count) {
    VerifyIdentities
    Write-Output 'PASS Champion User ID uniqueness is enforced by an active Dataverse alternate key.'
    return
}
if ($VerifyOnly) { throw 'An active alternate key on abs_champion.abs_normalizeduserid is required. Run the schema installer and resolve its duplicate report first.' }
if (-not $compatible.Count) {
    Request POST $keysPath @{
        '@odata.type' = 'Microsoft.Dynamics.CRM.EntityKeyMetadata'
        SchemaName = 'abs_ChampionNormalizedUserId'
        DisplayName = @{ LocalizedLabels = @(@{ Label = 'Champion User ID'; LanguageCode = 1033 }) }
        KeyAttributes = @('abs_normalizeduserid')
    } | Out-Null
}
$deadline = [DateTime]::UtcNow.AddMinutes(5)
do {
    $keys = @( (Request GET "$($keysPath)?`$select=SchemaName,KeyAttributes,EntityKeyIndexStatus" $null).value )
    $compatible = @($keys | Where-Object { $null -ne $_.KeyAttributes -and @($_.KeyAttributes).Count -eq 1 -and $_.KeyAttributes[0] -eq 'abs_normalizeduserid' })
    if (@($compatible | Where-Object EntityKeyIndexStatus -eq 'Active').Count) {
        VerifyIdentities
        Write-Output 'PASS Champion User ID uniqueness is enforced by an active Dataverse alternate key. Original User IDs and business links were preserved.'
        return
    }
    if (@($compatible | Where-Object EntityKeyIndexStatus -eq 'Failed').Count) {
        throw 'Dataverse could not build the Champion unique key. Inspect its system job, resolve data conflicts, and reactivate the key in Power Apps before retrying.'
    }
    Start-Sleep -Seconds 3
} while ([DateTime]::UtcNow -lt $deadline)
throw 'The Champion unique index is not active yet. Keep the upgrade on hold and inspect the Dataverse key status before continuing.'
