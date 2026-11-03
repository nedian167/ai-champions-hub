param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers
)

$ErrorActionPreference = 'Stop'
$names = @('AI Champions Hub - Deliver notifications', 'AI Champions Hub - Daily reminders')
$flows = @( (Invoke-RestMethod -Uri "$Api/workflows?`$select=workflowid,name,statecode&`$filter=name eq '$($names[0])' or name eq '$($names[1])'" -Headers $Headers).value )
if ($flows.Count -ne 2 -or @($flows.name | Select-Object -Unique).Count -ne 2) {
    throw 'Both unique production notification flows must exist before pausing delivery.'
}
foreach ($flow in $flows) {
    if ($flow.statecode -notin @(0, 1)) { throw "Unexpected flow state: $($flow.name)." }
    if ($flow.statecode -eq 1) {
        Invoke-RestMethod -Method Patch -Uri "$Api/workflows($($flow.workflowid))" -Headers $Headers `
            -ContentType 'application/json; charset=utf-8' -Body '{"statecode":0,"statuscode":1}' | Out-Null
    }
    $current = Invoke-RestMethod -Uri "$Api/workflows($($flow.workflowid))?`$select=statecode" -Headers $Headers
    if ($current.statecode -ne 0) { throw "Flow did not pause: $($flow.name)." }
    Write-Output "PAUSED: $($flow.name). Previously active: $($flow.statecode -eq 1)."
}
Write-Output 'User preferences and delivery records were not changed. In-flight runs retain their existing delivery safeguards.'
