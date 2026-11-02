param(
    [Parameter(Mandatory = $true)][uri]$OrganizationUrl,
    [Parameter(Mandatory = $true)][guid]$TenantId,
    [Parameter(Mandatory = $true)][guid]$ExpectedOrganizationId,
    [Parameter(Mandatory = $true)][guid]$ExpectedUserObjectId,
    [Parameter(Mandatory = $true)][string]$ActionScript,
    [hashtable]$ActionArguments = @{}
)

$ErrorActionPreference = 'Stop'
if ($OrganizationUrl.Scheme -ne 'https' -or $OrganizationUrl.AbsolutePath -ne '/' -or
    $OrganizationUrl.UserInfo -or $OrganizationUrl.Query -or $OrganizationUrl.Fragment) {
    throw 'OrganizationUrl must be the HTTPS root URL of the intended Dataverse environment.'
}
$organization = $OrganizationUrl.AbsoluteUri.TrimEnd('/')
$authority = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0"
$device = Invoke-RestMethod -Method Post -Uri "$authority/devicecode" -Body @{
    client_id = '51f81489-12ee-4a9e-aaae-a2591f45987d'
    scope = "$organization/.default"
}
Write-Output $device.message
$expires = [DateTimeOffset]::UtcNow.AddSeconds($device.expires_in)
$interval = [int]$device.interval
$token = $null
while (-not $token -and [DateTimeOffset]::UtcNow -lt $expires) {
    Start-Sleep -Seconds $interval
    try {
        $token = Invoke-RestMethod -Method Post -Uri "$authority/token" -Body @{
            grant_type = 'urn:ietf:params:oauth:grant-type:device_code'
            client_id = '51f81489-12ee-4a9e-aaae-a2591f45987d'
            device_code = $device.device_code
        }
    } catch {
        if (-not $_.ErrorDetails.Message) { throw }
        $failure = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($failure.error -eq 'authorization_pending') { continue }
        if ($failure.error -eq 'slow_down') { $interval += 5; continue }
        throw "Dataverse authorization failed: $($failure.error). $($failure.error_description)"
    }
}
if (-not $token) { throw 'Dataverse sign-in expired.' }
$headers = @{
    Authorization = "Bearer $($token.access_token)"
    Accept = 'application/json'
    'OData-MaxVersion' = '4.0'
    'OData-Version' = '4.0'
    'MSCRM.SolutionUniqueName' = 'AIChampionsHubApp'
    Consistency = 'Strong'
}
$token = $null
$device = $null
try {
    $api = "$organization/api/data/v9.2"
    $identity = Invoke-RestMethod -Uri "$api/WhoAmI" -Headers $headers
    if ([guid]$identity.OrganizationId -ne $ExpectedOrganizationId) {
        throw 'Unexpected Dataverse organization. No changes were made.'
    }
    $user = Invoke-RestMethod -Uri "$api/systemusers($($identity.UserId))?`$select=azureactivedirectoryobjectid" -Headers $headers
    if ([guid]$user.azureactivedirectoryobjectid -ne $ExpectedUserObjectId) {
        throw 'Unexpected administrator identity. No changes were made.'
    }
    & $ActionScript -Api $api -Headers $headers @ActionArguments
} finally {
    $headers.Authorization = $null
}
