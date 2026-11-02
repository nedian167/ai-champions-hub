import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const dataverse = 'shared_commondataserviceforapps';
const teams = 'shared_teams';
const outlook = 'shared_office365';

function action(connector, operationId, parameters, runAfter = {}) {
  return {
    type: 'OpenApiConnection',
    inputs: {
      host: { apiId: `/providers/Microsoft.PowerApps/apis/${connector}`, connectionName: connector, operationId },
      parameters,
      authentication: "@parameters('$authentication')",
      retryPolicy: { type: 'none' },
    },
    runAfter,
  };
}

function work(operation, recordId = '', outcome = '', runAfter = {}) {
  return action(dataverse, 'PerformUnboundAction', {
    actionName: 'abs_NotificationWork',
    'item/Operation': operation,
    'item/RecordId': recordId,
    'item/Outcome': outcome,
  }, runAfter);
}

function flow(name, trigger, actions, connections) {
  return {
    name,
    category: 5,
    type: 1,
    primaryentity: 'none',
    description: 'AI Champions Hub notifications. User opt-in required; ambiguous sends are never automatically retried.',
    clientdata: JSON.stringify({
      properties: {
        connectionReferences: Object.fromEntries(connections.map(([connector, name, reference]) => [connector, {
          impersonation: {},
          runtimeSource: 'embedded',
          connection: { name, connectionReferenceLogicalName: reference },
          api: { name: connector },
        }])),
        definition: {
          $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
          contentVersion: '1.0.0.0',
          parameters: {
            $connections: { type: 'Object', defaultValue: {} },
            $authentication: { type: 'SecureObject', defaultValue: {} },
          },
          triggers: { Recurrence: { type: 'Recurrence', recurrence: trigger, runtimeConfiguration: { concurrency: { runs: 1 } } } },
          actions,
        },
      },
      schemaVersion: '1.0.0.0',
    }),
  };
}

export function buildFlows(config) {
  for (const name of ['dataverseConnection', 'teamsConnection', 'outlookConnection']) {
    if (typeof config[name] !== 'string' || !/^[a-zA-Z0-9-]+$/.test(config[name])) {
      throw new Error(`Configure ${name} using a connection owned by the approved automation identity.`);
    }
  }
  const connections = [
    [dataverse, config.dataverseConnection, 'abs_NotificationDataverse'],
    [teams, config.teamsConnection, 'abs_NotificationTeams'],
    [outlook, config.outlookConnection, 'abs_NotificationOutlook'],
  ];
  const id = "@items('Deliveries')?['abs_notificationdeliveryid']";
  const send = {
    type: 'Scope',
    actions: {
      Channel: {
        type: 'If',
        expression: { equals: ["@outputs('Payload')?['channel']", 1] },
        actions: {
          Teams: action(teams, 'PostCardToConversation', {
            poster: 'Flow bot',
            location: 'Chat with Flow bot',
            'body/recipient': "@outputs('Payload')?['recipient']",
            'body/messageBody': "@outputs('Payload')?['card']",
          }),
        },
        else: {
          actions: {
            Email: action(outlook, 'SendEmailV2', {
              'emailMessage/To': "@outputs('Payload')?['recipient']",
              'emailMessage/Subject': "@outputs('Payload')?['subject']",
              'emailMessage/Body': "@outputs('Payload')?['email']",
              'emailMessage/Importance': 'Normal',
            }),
          },
        },
        runAfter: {},
      },
    },
    runAfter: {},
  };
  const dispatcher = flow('AI Champions Hub - Deliver notifications', { frequency: 'Minute', interval: 1 }, {
    Prepare: work('prepare'),
    Pending: action(dataverse, 'ListRecords', {
      entityName: 'abs_notificationdeliveries',
      $select: 'abs_notificationdeliveryid',
      $filter: 'abs_state eq 0',
      $orderby: 'createdon asc',
      $top: 100,
    }, { Prepare: ['Succeeded', 'Failed', 'TimedOut'] }),
    Deliveries: {
      type: 'Foreach',
      foreach: "@body('Pending')?['value']",
      runtimeConfiguration: { concurrency: { repetitions: 1 } },
      actions: {
        Begin: work('begin', id),
        Payload: { type: 'Compose', inputs: "@json(body('Begin')?['Result'])", runAfter: { Begin: ['Succeeded'] } },
        Opted_in: {
          type: 'If',
          expression: { equals: ["@outputs('Payload')?['send']", true] },
          actions: {
            Send: send,
            Mark_sent: work('complete', id, 'sent', { Send: ['Succeeded'] }),
            Mark_uncertain: work('complete', id, 'uncertain', { Send: ['Failed', 'TimedOut'] }),
          },
          else: { actions: {} },
          runAfter: { Payload: ['Succeeded'] },
        },
      },
      runAfter: { Pending: ['Succeeded'] },
    },
  }, connections);
  const reminderDefinitions = [
    ['Requests', 'abs_requests', 'abs_requestid', 'remind-request',
      "@concat('(crd49_status eq 839560000 or crd49_status eq 839560001) and statecode eq 0 and modifiedon le ', formatDateTime(addHours(utcNow(), -48), 'yyyy-MM-ddTHH:mm:ssZ'))"],
    ['Claims', 'abs_activityclaims', 'abs_activityclaimid', 'remind-claim',
      "@concat('crd49_status eq 839560000 and statecode eq 0 and modifiedon le ', formatDateTime(addHours(utcNow(), -48), 'yyyy-MM-ddTHH:mm:ssZ'))"],
    ['Campaigns', 'abs_campaigns', 'abs_campaignid', 'remind-campaign',
      "@concat('crd49_status eq 839560001 and statecode eq 0 and crd49_enddate ge ', formatDateTime(utcNow(), 'yyyy-MM-ddT00:00:00Z'), ' and crd49_enddate le ', formatDateTime(addDays(utcNow(), 7), 'yyyy-MM-ddT23:59:59Z'))"],
    ['Events', 'abs_events', 'abs_eventid', 'remind-event',
      "@concat('statecode eq 0 and crd49_eventdate gt ', formatDateTime(utcNow(), 'yyyy-MM-ddTHH:mm:ssZ'), ' and crd49_eventdate le ', formatDateTime(addHours(utcNow(), 24), 'yyyy-MM-ddTHH:mm:ssZ'))"],
  ];
  const reminderActions = {};
  for (const [name, entityName, primaryKey, operation, filter] of reminderDefinitions) {
    const list = action(dataverse, 'ListRecords', { entityName, $select: primaryKey, $filter: filter });
    list.runtimeConfiguration = { paginationPolicy: { minimumItemCount: 100000 } };
    reminderActions[name] = list;
    reminderActions[`Remind_${name}`] = {
      type: 'Foreach',
      foreach: `@body('${name}')?['value']`,
      runtimeConfiguration: { concurrency: { repetitions: 1 } },
      actions: { [`Capture_${name}`]: work(operation, `@items('Remind_${name}')?['${primaryKey}']`) },
      runAfter: { [name]: ['Succeeded'] },
    };
  }
  const reminders = flow('AI Champions Hub - Daily reminders',
    { frequency: 'Day', interval: 1, timeZone: 'UTC', schedule: { hours: [7], minutes: [0] } },
    reminderActions, [connections[0]]);
  return [dispatcher, reminders];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node flows.mjs configuration.json output.json');
  writeFileSync(process.argv[3], JSON.stringify(buildFlows(JSON.parse(readFileSync(process.argv[2], 'utf8'))), null, 2));
}
