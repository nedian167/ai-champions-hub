param(
    [Parameter(Mandatory = $true)][uri]$OrganizationUrl,
    [Parameter(Mandatory = $true)][guid]$TenantId,
    [Parameter(Mandatory = $true)][guid]$ExpectedOrganizationId,
    [Parameter(Mandatory = $true)][guid]$ExpectedUserId,
    [guid]$ClientId = '51f81489-12ee-4a9e-aaae-a2591f45987d'
)

$ErrorActionPreference = 'Stop'
if ($OrganizationUrl.Scheme -ne 'https' -or $OrganizationUrl.AbsolutePath -ne '/' -or
    $OrganizationUrl.UserInfo -or $OrganizationUrl.Query -or $OrganizationUrl.Fragment) {
    throw 'OrganizationUrl must be the HTTPS root URL of the intended Dataverse environment.'
}
$organization = $OrganizationUrl.AbsoluteUri.TrimEnd('/')
$authority = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0"
$flow = Invoke-RestMethod -Method Post -Uri "$authority/devicecode" -Body @{
    client_id = "$ClientId"
    scope = "$organization/.default"
}
Write-Output $flow.message
$expires = [DateTimeOffset]::UtcNow.AddSeconds($flow.expires_in)
$interval = [int]$flow.interval
$token = $null
while (-not $token -and [DateTimeOffset]::UtcNow -lt $expires) {
    Start-Sleep -Seconds $interval
    try {
        $token = Invoke-RestMethod -Method Post -Uri "$authority/token" -Body @{
            grant_type = 'urn:ietf:params:oauth:grant-type:device_code'
            client_id = "$ClientId"
            device_code = $flow.device_code
        }
    } catch {
        if (-not $_.ErrorDetails.Message) { throw }
        $failure = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($failure.error -eq 'authorization_pending') { continue }
        if ($failure.error -eq 'slow_down') { $interval += 5; continue }
        throw "Dataverse authorization failed: $($failure.error). $($failure.error_description)"
    }
}
if (-not $token) { throw 'Dataverse sign-in expired. Run the script again to request a new sign-in.' }
$headers = @{
    Authorization = "Bearer $($token.access_token)"
    Accept = 'application/json'
    'OData-MaxVersion' = '4.0'
    'OData-Version' = '4.0'
    'MSCRM.SolutionUniqueName' = 'AIChampionsHubApp'
}
$token = $null
$flow = $null
$api = "$organization/api/data/v9.2"
try {
    $identity = Invoke-RestMethod -Uri "$api/WhoAmI" -Headers $headers
    if ([guid]$identity.OrganizationId -ne $ExpectedOrganizationId) {
        throw 'The signed-in Dataverse organization is not the expected target. No schema changes were made.'
    }
    $user = Invoke-RestMethod -Uri "$api/systemusers($($identity.UserId))?`$select=azureactivedirectoryobjectid" -Headers $headers
    if ([guid]$user.azureactivedirectoryobjectid -ne $ExpectedUserId) {
        throw 'The signed-in Microsoft account is not the expected administrator. No schema changes were made.'
    }
    $path = "$api/EntityDefinitions(LogicalName='abs_event')/Attributes/Microsoft.Dynamics.CRM.DateTimeAttributeMetadata"
    $query = "?`$select=LogicalName,Format,DateTimeBehavior,RequiredLevel&`$filter=LogicalName eq 'abs_eventend'"
    $existing = Invoke-RestMethod -Uri "$path$query" -Headers $headers
    if (@($existing.value).Count -gt 1) { throw 'Unexpected duplicate end-column metadata.' }
    if (@($existing.value).Count -eq 1) {
        $column = $existing.value[0]
        if ($column.Format -ne 'DateAndTime' -or $column.DateTimeBehavior.Value -ne 'UserLocal' -or $column.RequiredLevel.Value -ne 'None') {
            throw 'The existing abs_eventend column has incompatible metadata. It was not modified.'
        }
        Write-Output 'The compatible abs_eventend column already exists; no column changes are needed.'
    } else {
        $body = Get-Content -Raw (Join-Path $PSScriptRoot 'schema\abs_eventend.json')
        Invoke-RestMethod -Method Post -Uri "$api/EntityDefinitions(LogicalName='abs_event')/Attributes" `
            -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
        Write-Output 'Created optional, User Local abs_eventend in AIChampionsHubApp. Existing event records were not changed.'
    }
    $publish = @{ ParameterXml = '<importexportxml><entities><entity>abs_event</entity></entities></importexportxml>' } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$api/PublishXml" -Headers $headers -ContentType 'application/json' -Body $publish | Out-Null
    $verified = Invoke-RestMethod -Uri "$path$query" -Headers $headers
    if (@($verified.value).Count -ne 1) { throw 'The end-column metadata could not be verified after publishing.' }
    Write-Output 'Verified published abs_eventend metadata. Regenerate the event data source before building the app.'
} finally {
    $headers.Authorization = $null
}
