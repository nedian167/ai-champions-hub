param(
    [Parameter(Mandatory = $true)][string]$Api,
    [Parameter(Mandatory = $true)][hashtable]$Headers
)

$ErrorActionPreference = 'Stop'
function Request([string]$Method, [string]$Path, $Body) {
    $arguments = @{ Method = $Method; Uri = "$Api/$Path"; Headers = $Headers }
    if ($null -ne $Body) {
        $arguments.ContentType = 'application/json; charset=utf-8'
        $arguments.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 40))
    }
    Invoke-RestMethod @arguments
}
function Label([string]$Text) {
    @{ LocalizedLabels = @(@{ Label = $Text; LanguageCode = 1033 }) }
}
function Attribute([string]$Name, $Spec) {
    $attribute = @{
        SchemaName = $Name
        DisplayName = (Label $Name)
        RequiredLevel = @{ Value = 'None' }
    }
    switch ($Spec.type) {
        'string' {
            $attribute.'@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'
            $attribute.MaxLength = $Spec.length
            $attribute.FormatName = @{ Value = 'Text' }
        }
        'memo' {
            $attribute.'@odata.type' = 'Microsoft.Dynamics.CRM.MemoAttributeMetadata'
            $attribute.MaxLength = $Spec.length
            $attribute.Format = 'Text'
        }
        'integer' {
            $attribute.'@odata.type' = 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata'
            $attribute.MinValue = 0
            $attribute.MaxValue = $Spec.max
            $attribute.Format = 'None'
        }
        'boolean' {
            $attribute.'@odata.type' = 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata'
            $attribute.DefaultValue = $false
            $attribute.OptionSet = @{
                TrueOption = @{ Value = 1; Label = (Label 'Yes') }
                FalseOption = @{ Value = 0; Label = (Label 'No') }
            }
        }
        'datetime' {
            $attribute.'@odata.type' = 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata'
            $attribute.Format = 'DateAndTime'
            $attribute.DateTimeBehavior = @{ Value = 'UserLocal' }
        }
        default { throw "Unsupported column type: $($Spec.type)" }
    }
    $attribute
}
function AddColumns([string]$Table, $Columns) {
    $existing = Request GET "EntityDefinitions(LogicalName='$Table')/Attributes?`$select=LogicalName,AttributeType" $null
    foreach ($column in $Columns.PSObject.Properties) {
        $found = @($existing.value | Where-Object LogicalName -eq $column.Name)
        $expectedType = @{ string = 'String'; memo = 'Memo'; integer = 'Integer'; boolean = 'Boolean'; datetime = 'DateTime' }[$column.Value.type]
        if ($found.Count -and $found[0].AttributeType -ne $expectedType) {
            throw "Existing $Table.$($column.Name) has an incompatible type."
        }
        if (-not $found.Count) {
            Request POST "EntityDefinitions(LogicalName='$Table')/Attributes" (Attribute $column.Name $column.Value) | Out-Null
            Write-Output "Created $Table.$($column.Name)"
        }
    }
}

$flows = @( (Request GET "workflows?`$select=workflowid&`$filter=name eq 'AI Champions Hub - Deliver notifications' or name eq 'AI Champions Hub - Daily reminders'" $null).value )
if ($flows.Count) {
    & (Join-Path $PSScriptRoot 'Pause-Notifications.ps1') -Api $Api -Headers $Headers
}
$schema = Get-Content -Raw (Join-Path $PSScriptRoot 'schema.json') | ConvertFrom-Json
foreach ($table in $schema.tables) {
    $existing = Request GET "EntityDefinitions?`$select=LogicalName,OwnershipType,EntitySetName&`$filter=LogicalName eq '$($table.name)'" $null
    $ownership = if ($table.owned) { 'UserOwned' } else { 'OrganizationOwned' }
    if (@($existing.value).Count) {
        if ($existing.value[0].OwnershipType -ne $ownership) {
            throw "Existing $($table.name) has incompatible ownership or entity set."
        }
        if ($existing.value[0].EntitySetName -ne $table.set) {
            if ($table.name -ne 'abs_notificationdelivery' -or $existing.value[0].EntitySetName -ne 'abs_notificationdeliverys') {
                throw "Existing $($table.name) has an incompatible entity set."
            }
            Request PUT "EntityDefinitions(LogicalName='$($table.name)')" @{ EntitySetName = $table.set } | Out-Null
        }
    } else {
        $name = Attribute 'abs_name' ([pscustomobject]@{ type = 'string'; length = 200 })
        $name.IsPrimaryName = $true
        Request POST 'EntityDefinitions' @{
            '@odata.type' = 'Microsoft.Dynamics.CRM.EntityMetadata'
            SchemaName = $table.name
            EntitySetName = $table.set
            DisplayName = (Label $table.label)
            DisplayCollectionName = (Label $table.plural)
            OwnershipType = $ownership
            IsActivity = $false
            IsOptimisticConcurrencyEnabled = $true
            HasNotes = $false
            HasActivities = $false
            Attributes = @($name)
        } | Out-Null
        Write-Output "Created $($table.name) ($ownership)"
        Request POST 'PublishXml' @{ ParameterXml = "<importexportxml><entities><entity>$($table.name)</entity></entities></importexportxml>" } | Out-Null
    }
    AddColumns $table.name $table.columns
}
foreach ($table in $schema.addColumns.PSObject.Properties) {
    AddColumns $table.Name $table.Value
}
$entities = @($schema.tables.name) + @($schema.addColumns.PSObject.Properties.Name)
$xml = '<importexportxml><entities>' + (($entities | ForEach-Object { "<entity>$_</entity>" }) -join '') + '</entities></importexportxml>'
Request POST 'PublishXml' @{ ParameterXml = $xml } | Out-Null
$solution = @( (Request GET "solutions?`$select=solutionid&`$filter=uniquename eq 'AIChampionsHubApp'" $null).value )
if ($solution.Count -ne 1) { throw 'The base Hub solution must exist before installing notification columns.' }
$components = @( (Request GET "solutioncomponents?`$select=objectid&`$filter=_solutionid_value eq $($solution[0].solutionid) and componenttype eq 2" $null).value.objectid )
foreach ($table in $schema.addColumns.PSObject.Properties) {
    foreach ($column in $table.Value.PSObject.Properties.Name) {
        $attribute = Request GET "EntityDefinitions(LogicalName='$($table.Name)')/Attributes(LogicalName='$column')?`$select=MetadataId" $null
        if ($components -notcontains $attribute.MetadataId) {
            Request POST 'AddSolutionComponent' @{
                ComponentId = $attribute.MetadataId
                ComponentType = 2
                SolutionUniqueName = 'AIChampionsHubApp'
                AddRequiredComponents = $false
            } | Out-Null
        }
    }
}
Write-Output 'Notification schema published. No users were opted in and no messages were sent.'
