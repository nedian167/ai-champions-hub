$ErrorActionPreference = 'Stop'
$api = 'https://example.invalid/api/data/v9.2'
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy\Add-ChampionIdentityKey.ps1'
function Assert([bool]$Condition) { if (-not $Condition) { throw 'Assertion failed.' } }
function ExpectFailure([scriptblock]$Run, [string]$Message) {
    try { & $Run } catch {
        if ($_.Exception.Message -notmatch $Message) { throw }
        return
    }
    throw "Expected a visible failure matching: $Message"
}
function Reset {
    $global:championKeyTestState = @{
        rows = @(); nextRows = $null; keys = @(); mutations = @(); readFailure = $false
        column = $true; length = 320; conflict = $false; addDuringKey = $false
    }
}
function Row([string]$Id, [string]$UserId, [string]$Normalized) {
    @{ abs_championid = $Id; abs_userid = $UserId; abs_normalizeduserid = $Normalized; '@odata.etag' = 'W/"1"' }
}
function Invoke-RestMethod {
    param($Method, $Uri, $Headers, $ContentType, $Body)
    $state = $global:championKeyTestState
    if ($state.readFailure) { throw 'Dataverse read denied.' }
    if ($Uri.StartsWith("$api/abs_champions?")) {
        $result = @{ value = $state.rows }
        if ($null -ne $state.nextRows) { $result['@odata.nextLink'] = "$api/champion-page-two" }
        return $result
    }
    if ($Uri -eq "$api/champion-page-two") { return @{ value = $state.nextRows } }
    if ($Uri.StartsWith("$api/EntityDefinitions(LogicalName='abs_champion')/Attributes?")) {
        if ($state.column) { return @{ value = @(@{ LogicalName = 'abs_normalizeduserid'; AttributeType = 'String' }) } }
        return @{ value = @() }
    }
    if ($Uri -like "$api/EntityDefinitions(LogicalName='abs_champion')/Attributes(LogicalName=*)/*") {
        return @{ MaxLength = $state.length }
    }
    if ($Uri -eq "$api/EntityDefinitions(LogicalName='abs_champion')/Attributes" -and $Method -eq 'POST') {
        $record = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
        Assert ($record.MaxLength -eq 320)
        $state.column = $true
        $state.mutations += 'column'
        return
    }
    if ($Uri -eq "$api/PublishXml" -and $Method -eq 'POST') { $state.mutations += 'publish'; return }
    if ($Uri -like "$api/abs_champions(*)" -and $Method -eq 'PATCH') {
        if ($state.conflict) { throw '412 Precondition Failed.' }
        Assert ($Headers['If-Match'] -eq 'W/"1"')
        $id = $Uri.Substring("$api/abs_champions(".Length).TrimEnd(')')
        $row = @($state.rows + @($state.nextRows) | Where-Object { $_.abs_championid -eq $id })[0]
        $record = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
        Assert (@($record.PSObject.Properties).Count -eq 1)
        $row.abs_normalizeduserid = $record.abs_normalizeduserid
        $state.mutations += 'backfill'
        return
    }
    if ($Uri -like "$api/EntityDefinitions(LogicalName='abs_champion')/Keys*") {
        if ($Method -eq 'GET') { return @{ value = $state.keys } }
        if ($Method -eq 'POST') {
            $record = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
            Assert ($record.KeyAttributes.Count -eq 1 -and $record.KeyAttributes[0] -eq 'abs_normalizeduserid')
            $state.mutations += 'key'
            $state.keys = @(@{ SchemaName = $record.SchemaName; KeyAttributes = @($record.KeyAttributes); EntityKeyIndexStatus = 'Active' })
            if ($state.addDuringKey) { $state.rows += (Row 'new-concurrent' 'new@example.test' '') }
            return
        }
    }
    throw "Unexpected request in isolated key tests: $Method $Uri"
}
Reset
$global:championKeyTestState.rows = @((Row 'original' 'lisa@example.test' ''), (Row 'duplicate' ' LISA@example.test ' ''))
ExpectFailure { & $installer -Api $api -Headers @{} } 'Duplicate Champion User IDs'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS normalized duplicates block installation before metadata or record changes.'

Reset
$global:championKeyTestState.rows = @((Row 'original' 'lisa@example.test' ''))
$global:championKeyTestState.nextRows = @((Row 'duplicate' 'LISA@example.test' ''))
ExpectFailure { & $installer -Api $api -Headers @{} } 'Duplicate Champion User IDs'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS duplicate preflight follows every Dataverse page.'

Reset
$global:championKeyTestState.rows = @((Row 'lisa' ' Lisa@example.test ' ''))
& $installer -Api $api -Headers @{}
Assert ($global:championKeyTestState.rows[0].abs_userid -ceq ' Lisa@example.test ')
Assert ($global:championKeyTestState.rows[0].abs_normalizeduserid -ceq 'lisa@example.test')
Assert (($global:championKeyTestState.mutations -join ',') -eq 'backfill,key')
Write-Output 'PASS technical backfill uses a row version and preserves original User IDs.'

Reset
$global:championKeyTestState.rows = @((Row 'lisa' ' ' ''))
ExpectFailure { & $installer -Api $api -Headers @{} } 'nonempty email/UPN'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS blank legacy identities block migration.'

Reset
$global:championKeyTestState.rows = @((Row 'lisa' ('x' * 321) ''))
ExpectFailure { & $installer -Api $api -Headers @{} } 'at most 320'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS oversized legacy identities are not silently truncated.'

Reset
$global:championKeyTestState.column = $false
$global:championKeyTestState.rows = @((Row 'lisa' 'lisa@example.test' ''))
& $installer -Api $api -Headers @{}
Assert (($global:championKeyTestState.mutations -join ',') -eq 'column,publish,backfill,key')
Write-Output 'PASS a bounded technical column is created before backfill and key activation.'

Reset
$global:championKeyTestState.keys = @(@{ SchemaName = 'existing_UserKey'; KeyAttributes = @('abs_normalizeduserid'); EntityKeyIndexStatus = 'Active' })
$global:championKeyTestState.rows = @((Row 'lisa' 'lisa@example.test' 'lisa@example.test'))
& $installer -Api $api -Headers @{} -VerifyOnly
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS an active compatible key and correct backfill are reused without writes.'

Reset
ExpectFailure { & $installer -Api $api -Headers @{} -VerifyOnly } 'active alternate key'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS verification never creates a missing key.'

Reset
$global:championKeyTestState.rows = @((Row 'lisa' 'lisa@example.test' ''))
ExpectFailure { & $installer -Api $api -Headers @{} -VerifyOnly } 'not backfilled'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS verification never mutates an unbackfilled profile.'

Reset
$global:championKeyTestState.keys = @(@{ SchemaName = 'abs_ChampionNormalizedUserId'; KeyAttributes = @('abs_userid'); EntityKeyIndexStatus = 'Active' })
ExpectFailure { & $installer -Api $api -Headers @{} } 'incompatible definition'
Write-Output 'PASS the original 850-character User ID column is not accepted as the bounded key.'

Reset
$global:championKeyTestState.keys = @(@{ SchemaName = 'abs_ChampionNormalizedUserId'; KeyAttributes = @('abs_normalizeduserid'); EntityKeyIndexStatus = 'Failed' })
ExpectFailure { & $installer -Api $api -Headers @{} } 'reactivate the key'
Write-Output 'PASS index build failure cannot report successful protection.'

Reset
$global:championKeyTestState.readFailure = $true
ExpectFailure { & $installer -Api $api -Headers @{} } 'Dataverse read denied'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS read failures never fall back to creating an index.'

Reset
$global:championKeyTestState.rows = @((Row 'lisa' 'lisa@example.test' ''))
$global:championKeyTestState.conflict = $true
ExpectFailure { & $installer -Api $api -Headers @{} } '412 Precondition Failed'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS concurrent profile changes abort backfill instead of overwriting newer data.'

Reset
$global:championKeyTestState.addDuringKey = $true
ExpectFailure { & $installer -Api $api -Headers @{} } 'changed during migration'
Write-Output 'PASS a concurrent unguarded creation prevents the upgrade from reporting success.'

Reset
$global:championKeyTestState.length = 850
ExpectFailure { & $installer -Api $api -Headers @{} } 'length 320'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS an index-incompatible column width fails explicitly.'

Reset
$global:championKeyTestState.column = $false
ExpectFailure { & $installer -Api $api -Headers @{} -VerifyOnly } 'column is missing'
Assert ($global:championKeyTestState.mutations.Count -eq 0)
Write-Output 'PASS verification never creates a missing technical column.'
Write-Output '16/16 isolated Champion key checks passed. No network requests were made.'
