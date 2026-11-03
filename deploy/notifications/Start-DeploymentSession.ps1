param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [string]$QueueDirectory = $env:HUB_NOTIFICATION_QUEUE
)

$ErrorActionPreference = 'Stop'
if (-not $QueueDirectory) { throw 'Set HUB_NOTIFICATION_QUEUE to an isolated session artifact directory.' }
New-Item -ItemType Directory -Force -Path $QueueDirectory | Out-Null
$requestPath = Join-Path $QueueDirectory 'request.json'
$resultPath = Join-Path $QueueDirectory 'result.json'
$stopPath = Join-Path $QueueDirectory 'stop'
Write-Output 'Administrator verified. Deployment session ready; credentials remain only in process memory.'
while (-not (Test-Path -LiteralPath $stopPath)) {
    if (-not (Test-Path -LiteralPath $requestPath)) { Start-Sleep -Seconds 1; continue }
    $job = Get-Content -Raw -LiteralPath $requestPath | ConvertFrom-Json
    Remove-Item -LiteralPath $requestPath
    try {
        switch ($job.action) {
            'pause' { & (Join-Path $PSScriptRoot 'Pause-Notifications.ps1') -Api $Api -Headers $Headers }
            'schema' { & (Join-Path $PSScriptRoot 'Install-Schema.ps1') -Api $Api -Headers $Headers }
            'backend' { & (Join-Path $PSScriptRoot 'Install-Backend.ps1') -Api $Api -Headers $Headers -ConfigurationPath $job.configuration }
            'verify' { & (Join-Path $PSScriptRoot 'Test-Backend.ps1') -Api $Api -Headers $Headers }
            'release' {
                & (Join-Path $PSScriptRoot 'Publish-Notifications.ps1') -Api $Api -Headers $Headers `
                    -ConfigurationPath $job.configuration -ExpectedSolutionVersion $job.version
            }
            default { throw 'Unknown deployment action.' }
        }
        @{ action = $job.action; success = $true } | ConvertTo-Json | Set-Content -LiteralPath $resultPath
    } catch {
        Write-Output "Deployment action '$($job.action)' FAILED: $($_.Exception.Message)"
        if ($_.ErrorDetails.Message) { Write-Output $_.ErrorDetails.Message }
        @{ action = $job.action; success = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $resultPath
    }
}
Write-Output 'Deployment session closed.'
