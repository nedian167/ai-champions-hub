param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [Parameter(Mandatory = $true)][string]$ApprovedMailbox,
    [ValidateSet('Both', 'Teams', 'Email')][string]$Channels = 'Both',
    [switch]$AllowTestNotifications
)

$ErrorActionPreference = 'Stop'
if (-not $AllowTestNotifications) {
    throw 'Explicit permission is required for the selected administrator-only test notifications.'
}
$channelNumbers = @(if ($Channels -ne 'Email') { 1 }; if ($Channels -ne 'Teams') { 2 })
$channelBits = ($channelNumbers | Measure-Object -Sum).Sum
function Request([string]$Method, [string]$Path, $Body, [string]$ETag = '') {
    $requestHeaders = $Headers.Clone()
    $requestHeaders.Prefer = 'odata.include-annotations="*"'
    if ($Method -eq 'POST' -and $Path -eq 'workflows') {
        $requestHeaders.Remove('MSCRM.SolutionUniqueName')
    }
    if ($ETag) { $requestHeaders['If-Match'] = $ETag }
    $arguments = @{ Method = $Method; Uri = "$Api/$Path"; Headers = $requestHeaders }
    if ($null -ne $Body) {
        $arguments.ContentType = 'application/json; charset=utf-8'
        $arguments.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 60))
    }
    Invoke-RestMethod @arguments
}
function Check([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    Write-Output "PASS $Message"
}
function Prepare {
    $result = Request POST 'abs_NotificationWork' @{ Operation = 'prepare'; RecordId = ''; Outcome = '' }
    Check (-not ($result.Result | ConvertFrom-Json).send) 'Preparation does not send notifications.'
}

$identity = Request GET 'WhoAmI' $null
$userId = [string]$identity.UserId
$user = Request GET "systemusers($userId)?`$select=domainname,internalemailaddress,azureactivedirectoryobjectid,isdisabled" $null
Check (-not $user.isdisabled -and $user.domainname -eq $ApprovedMailbox -and $user.internalemailaddress -eq $ApprovedMailbox) 'Both test channels address only the approved administrator mailbox.'
$objectId = [string]$user.azureactivedirectoryobjectid
$preference = Request GET "abs_notificationpreferences($userId)" $null
Check ($preference._ownerid_value -eq $userId -and $preference.abs_entraobjectid -eq $objectId) 'The test preference belongs to the authenticated administrator.'
$optedIn = @( (Request GET 'abs_notificationpreferences?$select=abs_notificationpreferenceid&$filter=abs_requests gt 0 or abs_claims gt 0 or abs_campaigns gt 0 or abs_reminders gt 0&$top=1' $null).value )
Check ($optedIn.Count -eq 0) 'All recipients are opted out before the isolated test.'
$flows = @( (Request GET "workflows?`$select=workflowid,name,statecode,clientdata&`$filter=name eq 'AI Champions Hub - Deliver notifications' or name eq 'AI Champions Hub - Daily reminders'" $null).value )
Check ($flows.Count -eq 2 -and @($flows | Where-Object statecode -ne 0).Count -eq 0) 'Both main flows are saved and disabled.'
$dispatcher = @($flows | Where-Object name -eq 'AI Champions Hub - Deliver notifications')[0]
$definition = $dispatcher.clientdata | ConvertFrom-Json
Check ($definition.properties.definition.actions.Prepare -and $definition.properties.definition.actions.Pending -and $definition.properties.definition.actions.Deliveries) 'The isolated flow uses the saved native dispatcher definition.'
$escapedMailbox = $ApprovedMailbox.Replace("'", "''")
$champions = @( (Request GET "abs_champions?`$select=abs_championid&`$filter=abs_userid eq '$escapedMailbox'" $null).value )
Check ($champions.Count -eq 1) 'The administrator has one existing Champion profile.'
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $pending = @( (Request GET 'abs_notificationevents?$select=abs_notificationeventid&$filter=abs_state eq 0&$top=1' $null).value )
    if (-not $pending.Count) { break }
    Prepare
}
$pending = @( (Request GET 'abs_notificationevents?$select=abs_notificationeventid&$filter=abs_state eq 0&$top=1' $null).value )
Check ($pending.Count -eq 0) 'Existing pending event pages were prepared while everyone was opted out.'

$requestId = [guid]::NewGuid().ToString()
$flowId = [guid]::NewGuid().ToString()
$preferenceTouched = $false
$preferenceETag = $null
$flowCreated = $false
$flowActivated = $false
$accepted = $false
$failure = $null
$cleanupErrors = @()
try {
    Request POST 'abs_requests' @{
        abs_requestid = $requestId
        abs_title = "Administrator notification test $requestId"
        crd49_description = "Authorized isolated $Channels channel delivery test. Temporary request."
        crd49_status = 839560000
        crd49_submitteddate = [DateTime]::UtcNow.ToString('o')
        'crd49_Champion@odata.bind' = "/abs_champions($($champions[0].abs_championid))"
    } | Out-Null
    $preferenceTouched = $true
    Request PATCH "abs_notificationpreferences($userId)" @{ abs_requests = [int]$channelBits; abs_paused = $false } $preference.'@odata.etag' | Out-Null
    $updated = Request GET "abs_notificationpreferences($userId)" $null
    $preferenceETag = $updated.'@odata.etag'
    Check ($updated.abs_requests -eq $channelBits -and -not $updated.abs_paused -and $preferenceETag) 'Temporary administrator-only consent is saved with a concurrency token.'
    Request PATCH "abs_requests($requestId)" @{ crd49_status = 839560001 } | Out-Null
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        Prepare
        $events = @( (Request GET "abs_notificationevents?`$filter=abs_sourceid eq '$requestId'" $null).value )
        if ($events.Count -eq 2 -and @($events | Where-Object abs_state -ne 1).Count -eq 0) { break }
    }
    Check ($events.Count -eq 2 -and @($events | Where-Object abs_state -ne 1).Count -eq 0) 'Real request capture and worker preparation completed.'
    $deliveries = @( (Request GET "abs_notificationdeliveries?`$filter=abs_sourceid eq '$requestId'" $null).value )
    Check ($deliveries.Count -eq $channelNumbers.Count -and @($deliveries | Where-Object { $_._ownerid_value -ne $userId -or $_.abs_recipientobjectid -ne $objectId -or $_.abs_kind -ne 'request.status' -or $_.abs_state -ne 0 }).Count -eq 0) 'Only the expected pending deliveries target the administrator and temporary request.'
    foreach ($channel in $channelNumbers) {
        Check (@($deliveries | Where-Object abs_channel -eq $channel).Count -eq 1) "There is exactly one delivery for selected channel $channel."
    }

    $deliveryIds = @($deliveries.abs_notificationdeliveryid)
    $idFilter = ($deliveryIds | ForEach-Object { "abs_notificationdeliveryid eq $_" }) -join ' or '
    $definition.properties.definition.actions.PSObject.Properties.Remove('Prepare')
    $definition.properties.definition.actions.Pending.runAfter = @{}
    $definition.properties.definition.actions.Pending.inputs.parameters.'$filter' =
        "abs_state eq 0 and abs_sourceid eq '$requestId' and abs_recipientobjectid eq '$objectId' and _ownerid_value eq $userId and ($idFilter)"
    $definition.properties.definition.actions.Pending.inputs.parameters.'$top' = $channelNumbers.Count
    $flowCreated = $true
    Request POST 'workflows' @{
        workflowid = $flowId
        name = "AI Champions Hub - $Channels test $flowId"
        category = 5
        type = 1
        primaryentity = 'none'
        description = "Explicitly authorized administrator-only $Channels test. Fixed temporary source, recipient and delivery IDs. No preparation or reminder actions."
        clientdata = ($definition | ConvertTo-Json -Depth 60 -Compress)
    } | Out-Null
    $flowActivated = $true
    Request PATCH "workflows($flowId)" @{ statecode = 1; statuscode = 2 } | Out-Null
    Write-Output "Isolated native $Channels flow activated for $($deliveryIds.Count) fixed delivery IDs: $flowId"
    $deadline = [DateTime]::UtcNow.AddMinutes(6)
    do {
        $deliveries = @( (Request GET "abs_notificationdeliveries?`$filter=abs_sourceid eq '$requestId'" $null).value )
        if ($deliveries.Count -eq $channelNumbers.Count -and @($deliveries | Where-Object abs_state -ne 2).Count -eq 0) {
            $accepted = $true
            break
        }
        $rejected = @($deliveries | Where-Object { $_.abs_state -ge 3 })
        if ($rejected.Count) {
            throw "A native send was not confirmed. Inspect isolated flow $flowId. Delivery outcomes: $(($deliveries | Select-Object abs_channel, abs_state, abs_error | ConvertTo-Json -Compress)). No automatic resend will be attempted."
        }
        Start-Sleep -Seconds 5
    } while ([DateTime]::UtcNow -lt $deadline)
    Check $accepted "Native connectors accepted the selected $Channels test notifications; this is not read confirmation."
} catch {
    $failure = $_
} finally {
    $retainEvidence = $flowActivated -and -not $accepted
    $flowStopped = -not $flowCreated
    if ($flowCreated) {
        try {
            $created = @( (Request GET "workflows?`$select=workflowid&`$filter=workflowid eq $flowId" $null).value )
            if ($created.Count) {
                Request PATCH "workflows($flowId)" @{ statecode = 0; statuscode = 1 } | Out-Null
                $stopped = Request GET "workflows($flowId)?`$select=statecode" $null
                if ($stopped.statecode -ne 0) { throw 'The isolated flow did not deactivate.' }
                if (-not $retainEvidence) { Request DELETE "workflows($flowId)" $null | Out-Null }
            }
            $flowStopped = $true
        } catch { $cleanupErrors += "Isolated flow $flowId cleanup: $($_.Exception.Message)" }
    }
    if ($preferenceTouched) {
        try {
            $current = Request GET "abs_notificationpreferences($userId)" $null
            if ($current.abs_requests -ne $preference.abs_requests -or $current.abs_paused -ne $preference.abs_paused) {
                if (-not $preferenceETag -or $current.'@odata.etag' -ne $preferenceETag) {
                    throw 'Preference version changed or the update was unconfirmed. Restore preferences manually; concurrent edits were not overwritten.'
                }
                Request PATCH "abs_notificationpreferences($userId)" @{
                    abs_requests = $preference.abs_requests
                    abs_paused = $preference.abs_paused
                } $preferenceETag | Out-Null
            }
            Write-Output 'Original administrator preference restored.'
        } catch { $cleanupErrors += "Preference restoration: $($_.Exception.Message)" }
    }
    if ($flowStopped -and -not $retainEvidence) {
        try {
            $remaining = @( (Request GET "abs_notificationdeliveries?`$filter=abs_sourceid eq '$requestId'" $null).value )
            if (@($remaining | Where-Object abs_state -eq 1).Count) {
                throw 'An in-flight send is unconfirmed. Temporary request and delivery evidence were retained; do not retry.'
            }
            foreach ($delivery in $remaining) {
                Request DELETE "abs_notificationdeliveries($($delivery.abs_notificationdeliveryid))" $null | Out-Null
            }
            $events = @( (Request GET "abs_notificationevents?`$select=abs_notificationeventid&`$filter=abs_sourceid eq '$requestId'" $null).value )
            foreach ($event in $events) {
                Request DELETE "abs_notificationevents($($event.abs_notificationeventid))" $null | Out-Null
            }
            $requests = @( (Request GET "abs_requests?`$select=abs_requestid&`$filter=abs_requestid eq $requestId" $null).value )
            if ($requests.Count) { Request DELETE "abs_requests($requestId)" $null | Out-Null }
            Write-Output 'Temporary request, events, deliveries and isolated flow removed.'
        } catch { $cleanupErrors += "Temporary request $requestId cleanup: $($_.Exception.Message)" }
    } elseif ($retainEvidence -and $flowStopped) {
        Write-Output "Unconfirmed test evidence retained: disabled flow $flowId and temporary request $requestId. Inspect run history before deleting or considering another test."
    }
}
if ($cleanupErrors.Count) {
    throw "Delivery test requires attention. Test error: $failure Cleanup errors: $($cleanupErrors -join '; ')"
}
if ($failure) { throw $failure }
$main = @( (Request GET "workflows?`$select=workflowid,statecode&`$filter=name eq 'AI Champions Hub - Deliver notifications' or name eq 'AI Champions Hub - Daily reminders'" $null).value )
Check ($main.Count -eq 2 -and @($main | Where-Object statecode -ne 0).Count -eq 0) 'Main notification flows remain disabled after the test.'
Write-Output 'Authorized native delivery test completed. No other user was opted in; connector acceptance does not confirm that messages were read.'
