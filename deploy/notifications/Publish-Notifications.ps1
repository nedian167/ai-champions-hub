param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [Parameter(Mandatory = $true)][string]$ConfigurationPath,
    [Parameter(Mandatory = $true)][string]$ExpectedSolutionVersion
)

$ErrorActionPreference = 'Stop'
function Request([string]$Method, [string]$Path, $Body) {
    $arguments = @{ Method = $Method; Uri = "$Api/$Path"; Headers = $Headers }
    if ($null -ne $Body) {
        $arguments.ContentType = 'application/json; charset=utf-8'
        $arguments.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 30))
    }
    Invoke-RestMethod @arguments
}
$config = Get-Content -Raw -LiteralPath $ConfigurationPath | ConvertFrom-Json
$references = @( (Request GET "connectionreferences?`$select=connectionreferencelogicalname,connectionid&`$filter=startswith(connectionreferencelogicalname,'abs_Notification')" $null).value )
foreach ($binding in @(
    @{ Name = 'abs_NotificationDataverse'; Id = $config.dataverseConnection },
    @{ Name = 'abs_NotificationTeams'; Id = $config.teamsConnection },
    @{ Name = 'abs_NotificationOutlook'; Id = $config.outlookConnection }
)) {
    $reference = @($references | Where-Object connectionreferencelogicalname -eq $binding.Name)
    if (-not $binding.Id -or $reference.Count -ne 1 -or $reference[0].connectionid -ne $binding.Id) {
        throw "Unexpected connection binding for $($binding.Name)."
    }
}
$solutions = @( (Request GET "solutions?`$select=solutionid,version&`$filter=uniquename eq 'AIChampionsHubApp'" $null).value )
if ($solutions.Count -ne 1 -or $solutions[0].version -ne $ExpectedSolutionVersion) { throw 'The online solution does not match the intended release version.' }
$solution = $solutions[0]
$components = @( (Request GET "solutioncomponents?`$select=solutioncomponentid,objectid&`$filter=_solutionid_value eq $($solution.solutionid) and componenttype eq 29" $null).value )
$production = @{}
foreach ($component in $components) {
    $record = Request GET "workflows($($component.objectid))?`$select=workflowid,name,statecode,clientdata" $null
    if ($record.name -in @('AI Champions Hub - Deliver notifications', 'AI Champions Hub - Daily reminders')) {
        if ($production.ContainsKey($record.name)) { throw 'Duplicate production notification flow.' }
        if (-not $record.clientdata) { throw "Missing native definition: $($record.name)." }
        $production[$record.name] = $record.workflowid
    } elseif ($record.name -match '^AI Champions Hub - (Isolated|Both|Teams|Email) test ([0-9a-f-]{36})$') {
        if ($record.statecode -ne 0 -or $Matches[2] -ne $record.workflowid) {
            throw 'Unexpected diagnostic flow identity or activation state.'
        }
        Request POST 'RemoveSolutionComponent' @{
            SolutionComponent = @{
                '@odata.type' = 'Microsoft.Dynamics.CRM.solutioncomponent'
                # This reference carries the workflow ID, not its solution-membership row ID.
                solutioncomponentid = $record.workflowid
            }
            ComponentType = 29
            SolutionUniqueName = 'AIChampionsHubApp'
        } | Out-Null
        $remaining = @( (Request GET "solutioncomponents?`$select=solutioncomponentid&`$filter=_solutionid_value eq $($solution.solutionid) and componenttype eq 29 and objectid eq $($record.workflowid)" $null).value )
        if ($remaining.Count) { throw 'A diagnostic flow is still included in the release solution.' }
        Write-Output "Diagnostic evidence retained outside the release solution: $($record.workflowid)"
    }
}
if ($production.Count -ne 2) { throw 'Both verified notification flows must belong to the release solution.' }
foreach ($name in @('AI Champions Hub - Deliver notifications', 'AI Champions Hub - Daily reminders')) {
    $id = $production[$name]
    Request PATCH "workflows($id)" @{ statecode = 1; statuscode = 2 } | Out-Null
    $record = Request GET "workflows($id)?`$select=name,statecode" $null
    if ($record.statecode -ne 1) { throw "Flow did not activate: $name." }
    Write-Output "ACTIVE: $name"
}
$optedIn = @( (Request GET 'abs_notificationpreferences?$select=abs_notificationpreferenceid&$filter=abs_requests gt 0 or abs_claims gt 0 or abs_campaigns gt 0 or abs_reminders gt 0&$top=1' $null).value )
Write-Output "Any opted-in recipients: $([bool]$optedIn.Count). No preferences were changed."
Request POST 'PublishAllXml' @{} | Out-Null
