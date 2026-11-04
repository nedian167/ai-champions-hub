param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [switch]$ExercisePipeline
)

$ErrorActionPreference = 'Stop'
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'Add-ChampionIdentityKey.ps1') -Api $Api -Headers $Headers -VerifyOnly
function Request([string]$Method, [string]$Path, $Body) {
    $requestHeaders = $Headers.Clone()
    $requestHeaders.Prefer = 'odata.include-annotations="*"'
    $arguments = @{ Method = $Method; Uri = "$Api/$Path"; Headers = $requestHeaders }
    if ($null -ne $Body) {
        $arguments.ContentType = 'application/json; charset=utf-8'
        $arguments.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 30))
    }
    Invoke-RestMethod @arguments
}
function Check([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    Write-Output "PASS $Message"
}

$identity = Request GET 'WhoAmI' $null
$user = Request GET "systemusers($($identity.UserId))?`$select=domainname,azureactivedirectoryobjectid" $null
$id = $identity.UserId
$schema = Get-Content -Raw (Join-Path $PSScriptRoot 'schema.json') | ConvertFrom-Json
$componentIds = @()
$columns = @()
foreach ($table in $schema.tables) {
    $metadata = Request GET "EntityDefinitions(LogicalName='$($table.name)')?`$select=MetadataId,OwnershipType,EntitySetName,IsOptimisticConcurrencyEnabled" $null
    $ownership = if ($table.owned) { 'UserOwned' } else { 'OrganizationOwned' }
    Check ($metadata.OwnershipType -eq $ownership -and $metadata.EntitySetName -eq $table.set) "$($table.name) ownership and entity set match the schema."
    Check ([bool]$metadata.IsOptimisticConcurrencyEnabled) "$($table.name) supports optimistic concurrency."
    $componentIds += $metadata.MetadataId
    $attributes = @( (Request GET "EntityDefinitions(LogicalName='$($table.name)')/Attributes?`$select=LogicalName" $null).value.LogicalName )
    foreach ($column in $table.columns.PSObject.Properties.Name) {
        Check ($attributes -contains $column) "$($table.name).$column exists."
    }
}
foreach ($table in $schema.addColumns.PSObject.Properties) {
    $parent = Request GET "EntityDefinitions(LogicalName='$($table.Name)')?`$select=MetadataId" $null
    foreach ($column in $table.Value.PSObject.Properties.Name) {
        $attribute = Request GET "EntityDefinitions(LogicalName='$($table.Name)')/Attributes(LogicalName='$column')?`$select=MetadataId" $null
        $columns += @{ Id = $attribute.MetadataId; Parent = $parent.MetadataId; Name = "$($table.Name).$column" }
    }
}
$assemblies = @( (Request GET "pluginassemblies?`$select=pluginassemblyid,publickeytoken,isolationmode&`$filter=name eq 'Hub.Notifications'" $null).value )
Check ($assemblies.Count -eq 1 -and $assemblies[0].publickeytoken -and $assemblies[0].isolationmode -eq 2) 'The signed notification assembly is registered in the sandbox.'
$componentIds += $assemblies[0].pluginassemblyid
$apis = @( (Request GET "customapis?`$select=customapiid,executeprivilegename&`$filter=uniquename eq 'abs_NotificationWork'" $null).value )
Check ($apis.Count -eq 1 -and $apis[0].executeprivilegename -eq 'prvPublishCustomization') 'The worker API requires the trusted automation privilege.'
$componentIds += $apis[0].customapiid
$parameters = @( (Request GET "customapirequestparameters?`$select=uniquename,type,isoptional&`$filter=_customapiid_value eq $($apis[0].customapiid)" $null).value )
Check ($parameters.Count -eq 3 -and @($parameters | Where-Object type -ne 10).Count -eq 0) 'All three custom API request parameters are strings.'
$responses = @( (Request GET "customapiresponseproperties?`$select=uniquename,type&`$filter=_customapiid_value eq $($apis[0].customapiid)" $null).value )
Check ($responses.Count -eq 1 -and $responses[0].uniquename -eq 'Result' -and $responses[0].type -eq 10) 'The worker API exposes its JSON result as a string.'
$roles = @( (Request GET "roles?`$select=roleid&`$filter=name eq 'AI Champions Hub Users' or name eq 'AI Champions Hub Admins'" $null).value )
Check ($roles.Count -ge 2) 'Both Hub security roles exist.'
$privatePrivileges = @()
foreach ($name in @('prvCreateabs_notificationpreference', 'prvReadabs_notificationpreference', 'prvWriteabs_notificationpreference', 'prvReadabs_notificationdelivery')) {
    $privilege = @( (Request GET "privileges?`$select=privilegeid&`$filter=name eq '$name'" $null).value )
    Check ($privilege.Count -eq 1) "$name is available."
    $privatePrivileges += $privilege[0].privilegeid
}
foreach ($role in $roles) {
    $grants = @( (Request GET "RetrieveRolePrivilegesRole(RoleId=$($role.roleid))" $null).RolePrivileges )
    foreach ($privilege in $privatePrivileges) {
        $grant = @($grants | Where-Object PrivilegeId -eq $privilege)
        Check ($grant.Count -eq 1 -and $grant[0].Depth -eq 'Basic') 'The Hub role grants private notification access at user depth only.'
    }
}
$preferences = @( (Request GET "abs_notificationpreferences?`$filter=abs_entraobjectid eq '$($user.azureactivedirectoryobjectid)'" $null).value )
Check ($preferences.Count -le 1) 'At most one preference record matches the administrator.'
if ($ExercisePipeline -and -not $preferences.Count) {
    Request POST 'abs_notificationpreferences' @{ abs_name = 'Notification preferences' } | Out-Null
}
if ($preferences.Count -or $ExercisePipeline) {
    $preference = Request GET "abs_notificationpreferences($id)" $null
    Check ($preference.abs_entraobjectid -eq $user.azureactivedirectoryobjectid -and $preference._ownerid_value -eq $id) 'Preference identity and ownership are stamped by the server.'
    if ($ExercisePipeline) {
        Check ($preference.abs_requests -eq 0 -and $preference.abs_claims -eq 0 -and $preference.abs_campaigns -eq 0 -and $preference.abs_reminders -eq 0) 'All administrator notification categories remain off.'
    }
}
$steps = @( (Request GET "sdkmessageprocessingsteps?`$select=sdkmessageprocessingstepid,name,stage,mode&`$filter=startswith(name,'AI Champions Hub Notifications - ')" $null).value )
Check ($steps.Count -eq 14 -and @($steps | Where-Object mode -ne 0).Count -eq 0) 'All fourteen synchronous Hub plug-in registrations exist.'
foreach ($registration in @(
    @{ Name = 'Template settings create'; Stage = 10 },
    @{ Name = 'Template settings update'; Stage = 20 },
    @{ Name = 'Template settings delete'; Stage = 10 },
    @{ Name = 'Champion identity create'; Stage = 20 },
    @{ Name = 'Champion identity update'; Stage = 20 }
)) {
    $step = @($steps | Where-Object name -eq "AI Champions Hub Notifications - $($registration.Name)")
    Check ($step.Count -eq 1 -and $step[0].stage -eq $registration.Stage) "$($registration.Name) runs at its required validation stage."
}
$champions = @( (Request GET 'abs_champions?$select=abs_championid,abs_userid,abs_normalizeduserid&$top=2' $null).value )
if ($champions.Count -eq 2) {
    $existingIdentity = [string]$champions[1].abs_normalizeduserid
    Check ([bool]$existingIdentity -and $existingIdentity -ne $champions[0].abs_normalizeduserid) 'Native duplicate checks have two distinct, indexed Champion identities.'
    $duplicate = @{
        abs_userid = " $($existingIdentity.ToUpperInvariant()) "
        # The existing indexed value also prevents a write if the plug-in is missing.
        abs_normalizeduserid = $existingIdentity
    }
    foreach ($attempt in @(
        @{ Method = 'POST'; Path = 'abs_champions'; Name = 'Create' },
        @{ Method = 'PATCH'; Path = "abs_champions($($champions[0].abs_championid))"; Name = 'Update' }
    )) {
        try {
            Request $attempt.Method $attempt.Path $duplicate | Out-Null
            throw 'The server unexpectedly accepted a duplicate Champion identity.'
        } catch {
            if (-not $_.ErrorDetails.Message -or $_.ErrorDetails.Message -notmatch 'A Champion with this User ID already exists') { throw }
            Write-Output "PASS Native Champion $($attempt.Name) rejects a normalized duplicate without changing a profile."
        }
    }
    foreach ($champion in $champions) {
        $afterChampion = Request GET "abs_champions($($champion.abs_championid))?`$select=abs_userid,abs_normalizeduserid" $null
        Check ($afterChampion.abs_userid -ceq $champion.abs_userid -and $afterChampion.abs_normalizeduserid -ceq $champion.abs_normalizeduserid) 'Rejected duplicate writes preserve the existing Champion identity.'
    }
} else {
    Write-Output 'Native duplicate-write checks were not exercised: two existing Champion profiles are required. No test profiles were created.'
}
foreach ($column in @('abs_notificationtemplates', 'abs_notificationtemplatecommand')) {
    $spec = $schema.addColumns.abs_programsettings.$column
    $metadata = Request GET "EntityDefinitions(LogicalName='abs_programsettings')/Attributes(LogicalName='$column')/Microsoft.Dynamics.CRM.MemoAttributeMetadata?`$select=MaxLength" $null
    Check ($metadata.MaxLength -eq $spec.length) "$column supports the complete validated payload size."
}
$settings = @( (Request GET 'abs_programsettingses?$select=abs_programsettingsid,abs_notificationtemplates,abs_notificationtemplatecommand,abs_notificationtemplatelock' $null).value )
Check ($settings.Count -eq 1) 'Exactly one Program Settings record is available to the template editor.'
$before = $settings[0]
$configuration = if ($null -eq $before.abs_notificationtemplates) { '{"version":1,"templates":[]}' } else { $before.abs_notificationtemplates }
$command = @{ expected = [guid]::NewGuid().ToString(); configuration = $configuration } | ConvertTo-Json -Compress
try {
    Request PATCH "abs_programsettingses($($before.abs_programsettingsid))" @{ abs_notificationtemplatecommand = $command } | Out-Null
    throw 'The server unexpectedly accepted a stale template command.'
} catch {
    if (-not $_.ErrorDetails.Message -or $_.ErrorDetails.Message -notmatch 'Templates changed since you opened the editor') { throw }
    Write-Output 'PASS Native template commands reach the reviewer-authorized concurrency guard.'
}
$after = Request GET "abs_programsettingses($($before.abs_programsettingsid))?`$select=abs_notificationtemplates,abs_notificationtemplatecommand,abs_notificationtemplatelock" $null
Check ($after.abs_notificationtemplates -eq $before.abs_notificationtemplates -and
    $after.abs_notificationtemplatecommand -eq $before.abs_notificationtemplatecommand -and
    $after.abs_notificationtemplatelock -eq $before.abs_notificationtemplatelock) 'Rejected template commands roll back without changing settings or retaining their lock.'
$componentIds += $steps.sdkmessageprocessingstepid
$flows = @( (Request GET "workflows?`$select=workflowid,name,statecode&`$filter=name eq 'AI Champions Hub - Deliver notifications' or name eq 'AI Champions Hub - Daily reminders'" $null).value )
Check ($flows.Count -eq 2) 'Both native notification flow definitions are saved.'
$componentIds += $flows.workflowid
$references = @( (Request GET "connectionreferences?`$select=connectionreferenceid,connectionid&`$filter=startswith(connectionreferencelogicalname,'abs_Notification')" $null).value )
Check ($references.Count -eq 3 -and @($references | Where-Object { -not $_.connectionid }).Count -eq 0) 'All three automation connection references have assigned connections.'
$componentIds += $references.connectionreferenceid
$variables = @( (Request GET "environmentvariabledefinitions?`$select=environmentvariabledefinitionid,defaultvalue&`$filter=schemaname eq 'abs_NotificationAppUrl'" $null).value )
Check ($variables.Count -eq 1 -and ([uri]$variables[0].defaultvalue).Host -eq 'apps.powerapps.com') 'The canonical notification player URL is configured.'
$componentIds += $variables.environmentvariabledefinitionid
$solution = @( (Request GET "solutions?`$select=solutionid&`$filter=uniquename eq 'AIChampionsHubApp'" $null).value )
Check ($solution.Count -eq 1) 'The Hub solution exists.'
$solutionComponents = @( (Request GET "solutioncomponents?`$select=objectid,rootcomponentbehavior,componenttype&`$filter=_solutionid_value eq $($solution[0].solutionid)" $null).value )
$components = @($solutionComponents.objectid)
foreach ($column in $columns) {
    $parent = @($solutionComponents | Where-Object { $_.objectid -eq $column.Parent -and $_.componenttype -eq 1 -and $_.rootcomponentbehavior -eq 0 })
    Check ($components -contains $column.Id -or $parent.Count -eq 1) "$($column.Name) is included directly or by its full-table solution component."
}
foreach ($component in $componentIds) {
    Check ($components -contains $component) "Notification component $component belongs to the Hub solution."
}
Check (@($flows | Where-Object statecode -eq 1).Count -eq 0) 'Outbound flows are off during development verification.'
if (-not $ExercisePipeline) {
    Write-Output 'Live backend verification completed without creating business records, preparing deliveries, changing preferences, or sending messages.'
    return
}
$optedIn = @( (Request GET 'abs_notificationpreferences?$select=abs_notificationpreferenceid&$filter=abs_requests gt 0 or abs_claims gt 0 or abs_campaigns gt 0 or abs_reminders gt 0&$top=1' $null).value )
Check ($optedIn.Count -eq 0) 'No recipients are opted in during temporary business-record verification.'
$result = Request POST 'abs_NotificationWork' @{ Operation = 'prepare'; RecordId = ''; Outcome = '' }
Check (($result.Result | ConvertFrom-Json).send -eq $false) 'The native notification worker executes without sending.'

$upn = $user.domainname.Replace("'", "''")
$own = @( (Request GET "abs_champions?`$select=abs_championid&`$filter=abs_userid eq '$upn'" $null).value )
if ($own.Count -ne 1) { throw 'A single administrator Champion profile is required for the temporary request pipeline verification.' }
$requestId = [guid]::NewGuid().ToString()
$replyId = [guid]::NewGuid().ToString()
try {
    Request POST 'abs_requests' @{
        abs_requestid = $requestId
        abs_title = "Notification verification $requestId"
        crd49_description = 'Temporary notification pipeline verification. No outbound notification is enabled.'
        crd49_status = 839560000
        crd49_submitteddate = [DateTime]::UtcNow.ToString('o')
        'crd49_Champion@odata.bind' = "/abs_champions($($own[0].abs_championid))"
    } | Out-Null
    $command = @{ id = $replyId; text = 'Temporary pipeline verification reply.' } | ConvertTo-Json -Compress
    Request PATCH "abs_requests($requestId)" @{ abs_replycommand = $command } | Out-Null
    Request PATCH "abs_requests($requestId)" @{ abs_replycommand = $command } | Out-Null
    $request = Request GET "abs_requests($requestId)?`$select=crd49_response,abs_replycommand" $null
    $thread = $request.crd49_response | ConvertFrom-Json
    Check (@($thread.messages).Count -eq 1 -and $thread.messages[0].id -eq $replyId) 'Repeated reply submission creates one server-stamped message.'
    Check ($thread.messages[0].actor -eq $id -and -not $request.abs_replycommand) 'Reply author is authenticated and the command is not retained.'
    $events = @( (Request GET "abs_notificationevents?`$filter=abs_sourceid eq '$requestId'" $null).value )
    Check ($events.Count -eq 2) 'Request creation and reply each enqueue one durable event.'
    Request POST 'abs_NotificationWork' @{ Operation = 'prepare'; RecordId = ''; Outcome = '' } | Out-Null
    $deliveries = @( (Request GET "abs_notificationdeliveries?`$filter=abs_sourceid eq '$requestId'" $null).value )
    Check ($deliveries.Count -eq 0) 'Opted-out recipients receive no delivery records.'
} finally {
    $events = @( (Request GET "abs_notificationevents?`$select=abs_notificationeventid&`$filter=abs_sourceid eq '$requestId'" $null).value )
    foreach ($event in $events) { Request DELETE "abs_notificationevents($($event.abs_notificationeventid))" $null | Out-Null }
    $requests = @( (Request GET "abs_requests?`$select=abs_requestid&`$filter=abs_requestid eq $requestId" $null).value )
    if ($requests.Count) { Request DELETE "abs_requests($requestId)" $null | Out-Null }
}
Write-Output 'Live Dataverse verification completed. Temporary request and events removed; no Teams cards or emails were sent.'
