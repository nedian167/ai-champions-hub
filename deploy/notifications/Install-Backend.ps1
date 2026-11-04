param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [Parameter(Mandatory = $true)][string]$ConfigurationPath
)

$ErrorActionPreference = 'Stop'
$configuration = Get-Content -Raw -LiteralPath $ConfigurationPath | ConvertFrom-Json
& (Join-Path (Split-Path -Parent $PSScriptRoot) 'Add-ChampionIdentityKey.ps1') -Api $Api -Headers $Headers -VerifyOnly
function Request([string]$Method, [string]$Path, $Body) {
    $arguments = @{ Method = $Method; Uri = "$Api/$Path"; Headers = $Headers }
    if ($null -ne $Body) {
        $arguments.ContentType = 'application/json; charset=utf-8'
        $arguments.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 50))
    }
    Invoke-RestMethod @arguments
}
function Ensure([string]$Set, [string]$Key, [string]$Filter, [hashtable]$Body) {
    $rows = @( (Request GET "$($Set)?`$select=$Key&`$filter=$([uri]::EscapeDataString($Filter))" $null).value )
    if ($rows.Count -gt 1) { throw "Ambiguous existing component in $Set ($Filter)." }
    if ($rows.Count) {
        $id = $rows[0].$Key
        Request PATCH "$Set($id)" $Body | Out-Null
    } else {
        $id = [guid]::NewGuid().ToString()
        $Body[$Key] = $id
        Request POST $Set $Body | Out-Null
    }
    $id
}
function Step([string]$Name, [string]$Table, [string]$Message, [int]$Stage, [string]$Columns, [string]$ImageColumns) {
    $messageRows = @( (Request GET "sdkmessages?`$select=sdkmessageid&`$filter=name eq '$Message'" $null).value )
    if ($messageRows.Count -ne 1) { throw "Could not resolve SDK message $Message." }
    $messageId = $messageRows[0].sdkmessageid
    $filters = @( (Request GET "sdkmessagefilters?`$select=sdkmessagefilterid&`$filter=_sdkmessageid_value eq $messageId and primaryobjecttypecode eq '$Table'" $null).value )
    if ($filters.Count -ne 1) { throw "Could not resolve $Message filter for $Table." }
    $body = @{
        name = "AI Champions Hub Notifications - $Name"
        'sdkmessageid@odata.bind' = "/sdkmessages($messageId)"
        'sdkmessagefilterid@odata.bind' = "/sdkmessagefilters($($filters[0].sdkmessagefilterid))"
        'eventhandler_plugintype@odata.bind' = "/plugintypes($pluginType)"
        stage = $Stage
        mode = 0
        rank = 1
        supporteddeployment = 0
        filteringattributes = $Columns
    }
    $id = Ensure 'sdkmessageprocessingsteps' 'sdkmessageprocessingstepid' "name eq '$($body.name)'" $body
    if ($ImageColumns) {
        Ensure 'sdkmessageprocessingstepimages' 'sdkmessageprocessingstepimageid' "_sdkmessageprocessingstepid_value eq $id and name eq 'Before'" @{
            name = 'Before'
            entityalias = 'Before'
            imagetype = 0
            messagepropertyname = 'Target'
            attributes = $ImageColumns
            'sdkmessageprocessingstepid@odata.bind' = "/sdkmessageprocessingsteps($id)"
        } | Out-Null
    }
}

$assemblyPath = [IO.Path]::GetFullPath($configuration.assemblyPath)
if (-not (Test-Path -LiteralPath $assemblyPath)) { throw 'Build the signed notification plug-in before installing.' }
$assemblyName = [Reflection.AssemblyName]::GetAssemblyName($assemblyPath)
if ($assemblyName.Name -ne 'Hub.Notifications' -or -not $assemblyName.GetPublicKeyToken().Length) {
    throw 'The notification assembly must have its expected strong name.'
}
$publicKeyToken = (($assemblyName.GetPublicKeyToken() | ForEach-Object { $_.ToString('x2') }) -join '')
$registered = @( (Request GET "pluginassemblies?`$select=publickeytoken&`$filter=name eq 'Hub.Notifications'" $null).value )
if ($registered.Count -and $registered[0].publickeytoken -ne $publicKeyToken) {
    throw 'The signing key does not match the registered assembly. Restore the original key before upgrading.'
}
$assembly = Ensure 'pluginassemblies' 'pluginassemblyid' "name eq 'Hub.Notifications'" @{
    name = $assemblyName.Name
    version = $assemblyName.Version.ToString()
    culture = 'neutral'
    publickeytoken = $publicKeyToken
    isolationmode = 2
    sourcetype = 0
    content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($assemblyPath))
}
$pluginType = Ensure 'plugintypes' 'plugintypeid' "typename eq 'Hub.Notifications.NotificationPlugin'" @{
    typename = 'Hub.Notifications.NotificationPlugin'
    name = 'Hub.Notifications.NotificationPlugin'
    friendlyname = 'AI Champions Hub Notifications'
    'pluginassemblyid@odata.bind' = "/pluginassemblies($assembly)"
}

$apiId = Ensure 'customapis' 'customapiid' "uniquename eq 'abs_NotificationWork'" @{
    uniquename = 'abs_NotificationWork'
    name = 'AI Champions Hub notification worker'
    displayname = 'AI Champions Hub notification worker'
    description = 'Trusted automation-only notification preparation, preference checks, delivery state, and reminders.'
    bindingtype = 0
    isfunction = $false
    isprivate = $false
    allowedcustomprocessingsteptype = 0
    executeprivilegename = 'prvPublishCustomization'
    'PluginTypeId@odata.bind' = "/plugintypes($pluginType)"
}
foreach ($parameter in @('Operation', 'RecordId', 'Outcome')) {
    Ensure 'customapirequestparameters' 'customapirequestparameterid' "_customapiid_value eq $apiId and uniquename eq '$parameter'" @{
        uniquename = $parameter
        name = $parameter
        displayname = $parameter
        type = 10
        isoptional = ($parameter -ne 'Operation')
        'CustomAPIId@odata.bind' = "/customapis($apiId)"
    } | Out-Null
}
Ensure 'customapiresponseproperties' 'customapiresponsepropertyid' "_customapiid_value eq $apiId and uniquename eq 'Result'" @{
    uniquename = 'Result'
    name = 'Result'
    displayname = 'Result'
    type = 10
    'CustomAPIId@odata.bind' = "/customapis($apiId)"
} | Out-Null

$existingCapture = @( (Request GET "sdkmessageprocessingsteps?`$select=sdkmessageprocessingstepid&`$filter=name eq 'AI Champions Hub Notifications - Campaign update'" $null).value )
if (-not $existingCapture.Count) {
    $next = 'abs_campaigns?$select=abs_campaignid&$filter=abs_notificationready eq false'
    while ($next) {
        $page = Request GET $next $null
        foreach ($campaign in $page.value) {
            Request PATCH "abs_campaigns($($campaign.abs_campaignid))" @{ abs_notificationready = $true } | Out-Null
        }
        $next = $null
        if ($page.'@odata.nextLink') { $next = $page.'@odata.nextLink'.Substring($Api.Length + 1) }
    }
}
Step 'Preferences create' 'abs_notificationpreference' 'Create' 10 '' ''
Step 'Preferences update' 'abs_notificationpreference' 'Update' 20 '' ''
Step 'Request reply validation' 'abs_request' 'Update' 20 'abs_replycommand,crd49_response,crd49_status' ''
Step 'Request create' 'abs_request' 'Create' 40 '' ''
Step 'Request update' 'abs_request' 'Update' 40 'abs_replycommand,crd49_response,crd49_status' ''
Step 'Claim create' 'abs_activityclaim' 'Create' 40 '' ''
Step 'Claim update' 'abs_activityclaim' 'Update' 40 'crd49_status' 'crd49_status'
Step 'Campaign create' 'abs_campaign' 'Create' 40 '' ''
Step 'Campaign update' 'abs_campaign' 'Update' 40 'crd49_status,abs_notificationready' 'crd49_status,abs_notificationready'
Step 'Template settings create' 'abs_programsettings' 'Create' 10 '' ''
Step 'Template settings update' 'abs_programsettings' 'Update' 20 'abs_notificationtemplates,abs_notificationtemplatecommand' ''
Step 'Template settings delete' 'abs_programsettings' 'Delete' 10 '' ''
Step 'Champion identity create' 'abs_champion' 'Create' 20 '' ''
Step 'Champion identity update' 'abs_champion' 'Update' 20 'abs_userid,abs_normalizeduserid' ''

$roles = @( (Request GET "roles?`$select=roleid,name&`$filter=name eq 'AI Champions Hub Users' or name eq 'AI Champions Hub Admins'" $null).value )
if (-not $roles.Count) { throw 'The Hub security roles must exist before installing notifications.' }
$privileges = @()
foreach ($entry in @(
    @{ Table = 'abs_notificationpreference'; Operations = @('Create', 'Read', 'Write') },
    @{ Table = 'abs_notificationdelivery'; Operations = @('Read') }
)) {
    foreach ($operation in $entry.Operations) {
        $name = "prv$operation$($entry.Table)"
        $privilege = @( (Request GET "privileges?`$select=privilegeid&`$filter=name eq '$name'" $null).value )
        if ($privilege.Count -ne 1) { throw "Could not resolve privilege $name." }
        $privileges += @{ PrivilegeId = $privilege[0].privilegeid; Depth = 'Basic'; BusinessUnitId = [guid]::Empty.ToString() }
    }
}
foreach ($role in $roles) {
    Request POST "roles($($role.roleid))/Microsoft.Dynamics.CRM.AddPrivilegesRole" @{ Privileges = $privileges } | Out-Null
}

$play = [uri]$configuration.appUrl
if ($play.Scheme -ne 'https' -or $play.Host -ne 'apps.powerapps.com' -or -not $play.AbsolutePath.StartsWith('/play/')) {
    throw 'Configure the canonical Power Apps play URL.'
}
Ensure 'environmentvariabledefinitions' 'environmentvariabledefinitionid' "schemaname eq 'abs_NotificationAppUrl'" @{
    schemaname = 'abs_NotificationAppUrl'
    displayname = 'AI Champions Hub notification app URL'
    type = 100000000
    defaultvalue = $configuration.appUrl
} | Out-Null

foreach ($connection in @(
    @{ Name = 'abs_NotificationDataverse'; Connector = 'shared_commondataserviceforapps'; Id = $configuration.dataverseConnection },
    @{ Name = 'abs_NotificationTeams'; Connector = 'shared_teams'; Id = $configuration.teamsConnection },
    @{ Name = 'abs_NotificationOutlook'; Connector = 'shared_office365'; Id = $configuration.outlookConnection }
)) {
    if (-not $connection.Id) { throw "Configure $($connection.Name) with an approved connection." }
    Ensure 'connectionreferences' 'connectionreferenceid' "connectionreferencelogicalname eq '$($connection.Name)'" @{
        connectionreferencelogicalname = $connection.Name
        connectionreferencedisplayname = $connection.Name
        connectorid = "/providers/Microsoft.PowerApps/apis/$($connection.Connector)"
        connectionid = $connection.Id
    } | Out-Null
}

Request POST 'PublishAllXml' @{} | Out-Null
$flowFile = Join-Path (Split-Path -Parent $ConfigurationPath) 'notification-flows.json'
& node (Join-Path $PSScriptRoot 'flows.mjs') $ConfigurationPath $flowFile
if ($LASTEXITCODE -ne 0) { throw 'Could not generate notification flows.' }
$flows = Get-Content -Raw -LiteralPath $flowFile | ConvertFrom-Json
$installedFlows = @()
foreach ($flow in ($flows | Sort-Object name)) {
    $body = @{}
    foreach ($property in $flow.PSObject.Properties) { $body[$property.Name] = $property.Value }
    $id = Ensure 'workflows' 'workflowid' "name eq '$($flow.name)'" $body
    $installedFlows += $id
    Write-Output "Installed flow: $($flow.name) ($id)"
}
if ($configuration.enableFlows) {
    foreach ($id in $installedFlows) { Request PATCH "workflows($id)" @{ statecode = 1; statuscode = 2 } | Out-Null }
}
Request POST 'PublishAllXml' @{} | Out-Null
Write-Output 'Notification backend installed. Existing user preferences were not changed.'
