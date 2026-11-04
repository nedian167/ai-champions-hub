using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Microsoft.Xrm.Sdk.Messages;

namespace Hub.Notifications
{
    public sealed class NotificationPlugin : IPlugin
    {
        public void Execute(IServiceProvider provider)
        {
            var context = (IPluginExecutionContext)provider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)provider.GetService(typeof(IOrganizationServiceFactory));
            var trace = (ITracingService)provider.GetService(typeof(ITracingService));
            var worker = new Worker(factory.CreateOrganizationService(null), context, trace);
            if (context.MessageName == "abs_NotificationWork")
            {
                var operation = context.InputParameters["Operation"] as string ?? "";
                var idText = context.InputParameters.Contains("RecordId") ? context.InputParameters["RecordId"] as string : null;
                var outcome = context.InputParameters.Contains("Outcome") ? context.InputParameters["Outcome"] as string : null;
                context.OutputParameters["Result"] = Json.Write(worker.Work(operation, idText, outcome));
                return;
            }
            if (context.MessageName == "Delete" && context.Stage == 10 &&
                context.InputParameters.Contains("Target") && context.InputParameters["Target"] is EntityReference deleted &&
                deleted.LogicalName == "abs_programsettings")
            {
                worker.TemplateDeletion(deleted.Id);
                return;
            }
            if (!context.InputParameters.Contains("Target") || !(context.InputParameters["Target"] is Entity target)) return;
            if (target.LogicalName == "abs_champion" && context.Stage == 20 &&
                (context.MessageName == "Create" || context.MessageName == "Update"))
                worker.ChampionIdentity(target);
            else if (target.LogicalName == "abs_programsettings" &&
                (context.MessageName == "Create" && context.Stage == 10 || context.MessageName == "Update" && context.Stage == 20))
                worker.Templates(target);
            else if (target.LogicalName == "abs_notificationpreference" &&
                (context.MessageName == "Create" && context.Stage == 10 || context.MessageName == "Update" && context.Stage == 20))
                worker.Preference(target);
            else if (target.LogicalName == "abs_request" && context.Stage == 20)
                worker.Reply(target);
            else if (context.Stage == 40)
                worker.Capture(target);
        }
    }

    internal sealed class Worker
    {
        internal const int Pending = 0, Sending = 1, Sent = 2, Failed = 3, Uncertain = 4, Skipped = 5;
        internal const int Open = 839560000, InReview = 839560001, Approved = 839560001, Rejected = 839560002;
        private readonly IOrganizationService service;
        private readonly IPluginExecutionContext context;
        private readonly ITracingService trace;
        private readonly Dictionary<Guid, Entity> users = new Dictionary<Guid, Entity>();

        internal Worker(IOrganizationService service, IPluginExecutionContext context, ITracingService trace)
        {
            this.service = service;
            this.context = context;
            this.trace = trace;
        }

        internal void ChampionIdentity(Entity target)
        {
            if (context.MessageName == "Update" && !target.Contains("abs_userid") && !target.Contains("abs_normalizeduserid")) return;
            var raw = target.Contains("abs_userid") ? target.GetAttributeValue<string>("abs_userid")
                : context.MessageName == "Update" ? Get("abs_champion", target.Id)?.GetAttributeValue<string>("abs_userid") : null;
            var userId = (raw ?? "").Trim().ToLowerInvariant();
            if (userId.Length == 0) throw new InvalidPluginExecutionException("A Champion User ID (email / UPN) is required.");
            if (userId.Length > 320) throw new InvalidPluginExecutionException("A Champion User ID must be no more than 320 characters.");
            var query = new QueryExpression("abs_champion") { ColumnSet = new ColumnSet("abs_championid"), TopCount = 1 };
            var identities = new FilterExpression(LogicalOperator.Or);
            identities.AddCondition("abs_userid", ConditionOperator.Equal, userId);
            identities.AddCondition("abs_normalizeduserid", ConditionOperator.Equal, userId);
            query.Criteria.AddFilter(identities);
            if (target.Id != Guid.Empty) query.Criteria.AddCondition("abs_championid", ConditionOperator.NotEqual, target.Id);
            if (service.RetrieveMultiple(query).Entities.Count != 0)
                throw new InvalidPluginExecutionException("A Champion with this User ID already exists. Edit or enable the existing profile instead of adding another.");
            target["abs_userid"] = userId;
            target["abs_normalizeduserid"] = userId;
        }

        private bool CanEditTemplates(Entity actor)
        {
            if (actor.GetAttributeValue<bool>("isdisabled") || actor.GetAttributeValue<Guid>("azureactivedirectoryobjectid") == Guid.Empty) return false;
            var champion = Champion(actor);
            if (champion != null && Choice(champion, "crd49_status") != Rejected && Choice(champion, "crd49_role") == InReview) return true;
            var query = Query("abs_appadmin", "abs_userid", actor.GetAttributeValue<string>("domainname") ?? "");
            query.TopCount = 1;
            return service.RetrieveMultiple(query).Entities.Count != 0;
        }
        internal void TemplateDeletion(Guid id)
        {
            var settings = Get("abs_programsettings", id);
            if (!string.IsNullOrEmpty(settings?.GetAttributeValue<string>("abs_notificationtemplates")) &&
                !CanEditTemplates(User(context.InitiatingUserId)))
                throw new InvalidPluginExecutionException("Only a persistent program manager or app admin can remove configured notification templates.");
        }
        internal void Templates(Entity target)
        {
            if (!target.Contains("abs_notificationtemplates") && !target.Contains("abs_notificationtemplatecommand")) return;
            if (!CanEditTemplates(User(context.InitiatingUserId)))
                throw new InvalidPluginExecutionException("Only a persistent program manager or app admin can change notification templates.");
            if (target.Contains("abs_notificationtemplatecommand"))
            {
                if (context.MessageName != "Update" || target.Contains("abs_notificationtemplates"))
                    throw new InvalidPluginExecutionException("Submit a template update command without a direct configuration write.");
                var text = target.GetAttributeValue<string>("abs_notificationtemplatecommand");
                if (text == null || text.Length > 210000) throw new InvalidPluginExecutionException("Invalid template update command.");
                var command = NotificationContent.ReadCommand(text);
                if (command == null || command.configuration == null)
                    throw new InvalidPluginExecutionException("Invalid template update command.");
                NotificationContent.Read(command.configuration);
                service.Update(new Entity("abs_programsettings", target.Id) { ["abs_notificationtemplatelock"] = Guid.NewGuid().ToString("D") });
                var existing = Get("abs_programsettings", target.Id) ?? throw new InvalidPluginExecutionException("Program Settings not found.");
                if (existing.GetAttributeValue<string>("abs_notificationtemplates") != command.expected)
                    throw new InvalidPluginExecutionException("Templates changed since you opened the editor. Refresh before saving.");
                target["abs_notificationtemplates"] = command.configuration;
                target["abs_notificationtemplatecommand"] = null;
            }
            else
            {
                if (context.MessageName != "Create") throw new InvalidPluginExecutionException("Use the template editor update command to change templates.");
                NotificationContent.Read(target.GetAttributeValue<string>("abs_notificationtemplates"));
            }
        }

        internal void Preference(Entity target)
        {
            var actor = User(context.InitiatingUserId);
            var objectId = actor.GetAttributeValue<Guid>("azureactivedirectoryobjectid");
            if (objectId == Guid.Empty || actor.GetAttributeValue<bool>("isdisabled"))
                throw new InvalidPluginExecutionException("An active Microsoft Entra user is required for notification preferences.");
            if (context.MessageName == "Create")
            {
                if (target.Contains("ownerid") && target.GetAttributeValue<EntityReference>("ownerid").Id != actor.Id)
                    throw new InvalidPluginExecutionException("You can only create your own notification preferences.");
                target.Id = actor.Id;
                target["abs_notificationpreferenceid"] = actor.Id;
                target["ownerid"] = actor.ToEntityReference();
                target["abs_entraobjectid"] = objectId.ToString("D");
                target["abs_name"] = "Notification preferences";
                foreach (var category in Categories)
                    if (!target.Contains(category)) target[category] = 0;
                if (!target.Contains("abs_paused")) target["abs_paused"] = false;
            }
            else
            {
                var existing = Get("abs_notificationpreference", target.Id);
                if (existing == null || existing.GetAttributeValue<EntityReference>("ownerid").Id != actor.Id)
                    throw new InvalidPluginExecutionException("You can only change your own notification preferences.");
                foreach (var field in new[] { "ownerid", "abs_entraobjectid", "abs_name" })
                    if (target.Contains(field))
                        throw new InvalidPluginExecutionException("Notification preference identity cannot be changed.");
            }
            foreach (var category in Categories)
                if (target.Contains(category) && (!(target[category] is int channel) || channel < 0 || channel > 3))
                    throw new InvalidPluginExecutionException("Choose Off, Teams, Email, or Both for each notification category.");
            if (target.Contains("abs_paused") && !(target["abs_paused"] is bool))
                throw new InvalidPluginExecutionException("Pause notifications must be Yes or No.");
        }

        // A nested write acquires the request's transaction lock before reading its latest thread.
        // This lets simultaneous replies append instead of replacing each other's messages.
        internal void Reply(Entity target)
        {
            service.Update(new Entity("abs_request", target.Id) { ["abs_notificationlock"] = Guid.NewGuid().ToString("D") });
            var current = Get("abs_request", target.Id) ?? throw new InvalidPluginExecutionException("Request not found.");
            var actor = User(context.InitiatingUserId);
            var admin = IsReviewer(actor);
            if (!admin && !IsRequester(current, actor))
                throw new InvalidPluginExecutionException("You cannot reply to another user's request.");
            var oldStatus = Choice(current, "crd49_status");
            if (target.Contains("crd49_status") && !admin && Choice(target, "crd49_status") != oldStatus)
                throw new InvalidPluginExecutionException("Only a program manager or app admin can change request status.");
            context.SharedVariables["HubStatusChanged"] = target.Contains("crd49_status") && Choice(target, "crd49_status") != oldStatus;

            var messages = Json.Thread(current.GetAttributeValue<string>("crd49_response"));
            ReplyCommand? command = null;
            if (target.Contains("abs_replycommand") && target["abs_replycommand"] is string input)
            {
                command = Json.Read<ReplyCommand>(input);
                target["abs_replycommand"] = null;
                if (!Guid.TryParse(command.id, out _) || string.IsNullOrWhiteSpace(command.text) || command.text!.Trim().Length > 4000)
                    throw new InvalidPluginExecutionException("A reply needs a valid message ID and 1-4000 characters.");
                command.id = Guid.Parse(command.id!).ToString("D");
                var prior = messages.FirstOrDefault(m => m.id == command.id);
                if (prior != null)
                {
                    if (prior.actor != actor.Id.ToString("D") || prior.text != command.text.Trim())
                        throw new InvalidPluginExecutionException("This message ID has already been used for a different reply.");
                    command = null;
                }
            }
            else if (target.Contains("crd49_response"))
            {
                var incoming = Json.Thread(target.GetAttributeValue<string>("crd49_response"));
                if (incoming.Count < messages.Count || incoming.Count > messages.Count + 1 ||
                    !messages.Select((m, i) => m.SameContent(incoming[i])).All(v => v))
                    throw new InvalidPluginExecutionException("New replies are available. Refresh this request before sending again.");
                if (incoming.Count > messages.Count)
                    command = new ReplyCommand { id = Guid.NewGuid().ToString("D"), text = incoming.Last().text };
                target["crd49_response"] = Json.Write(new ThreadEnvelope { messages = messages });
            }
            if (command == null) return;
            if (string.IsNullOrWhiteSpace(command.text) || command.text!.Trim().Length > 4000)
                throw new InvalidPluginExecutionException("Replies must contain 1-4000 characters.");
            messages.Add(new ThreadMessage
            {
                id = command.id,
                actor = actor.Id.ToString("D"),
                by = admin ? "admin" : "requester",
                name = actor.GetAttributeValue<string>("fullname") ?? "User",
                text = command.text.Trim(),
                at = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            });
            target["crd49_response"] = Json.Write(new ThreadEnvelope { messages = messages });
            context.SharedVariables["HubReplyId"] = command.id!;
            context.SharedVariables["HubReplyAdmin"] = admin;
        }

        internal void Capture(Entity target)
        {
            var row = Get(target.LogicalName, target.Id);
            if (row == null) return;
            var created = context.MessageName == "Create";
            var before = context.PreEntityImages.Contains("Before") ? context.PreEntityImages["Before"] : null;
            var revision = row.GetAttributeValue<long>("versionnumber").ToString(CultureInfo.InvariantCulture);
            if (row.LogicalName == "abs_request")
            {
                if (created) Event("request.created", row, revision);
                else if (context.SharedVariables.Contains("HubReplyId"))
                    Event((bool)context.SharedVariables["HubReplyAdmin"] ? "request.reply.admin" : "request.reply.user",
                        row, (string)context.SharedVariables["HubReplyId"]);
                else if (context.SharedVariables.Contains("HubStatusChanged") && (bool)context.SharedVariables["HubStatusChanged"])
                    Event("request.status", row, revision);
            }
            else if (row.LogicalName == "abs_activityclaim" && (created || Choice(before, "crd49_status") != Choice(row, "crd49_status")))
            {
                var status = Choice(row, "crd49_status");
                Event(status == Approved ? "claim.approved" : status == Rejected ? "claim.rejected" : "claim.created", row, revision);
            }
            else if (row.LogicalName == "abs_campaign" && CampaignLive(row) && row.GetAttributeValue<bool>("abs_notificationready") &&
                (created || Choice(before, "crd49_status") != InReview || before?.GetAttributeValue<bool>("abs_notificationready") != true))
                Event("campaign.launched", row, revision);
        }

        private void Event(string kind, Entity source, string revision)
        {
            var id = StableId(kind + "|" + source.Id + "|" + revision);
            if (Get("abs_notificationevent", id) != null) return;
            service.Create(new Entity("abs_notificationevent", id)
            {
                ["abs_name"] = kind,
                ["abs_kind"] = kind,
                ["abs_source"] = source.LogicalName,
                ["abs_sourceid"] = source.Id.ToString("D"),
                ["abs_actorid"] = context.InitiatingUserId.ToString("D"),
                ["abs_messageid"] = kind.StartsWith("request.reply.", StringComparison.Ordinal) ? revision : "",
                ["abs_expectedstatus"] = Math.Max(0, Choice(source, "crd49_status")),
                ["abs_state"] = 0,
                ["abs_page"] = 1
            });
        }

        internal WorkResult Work(string operation, string? idText, string? outcome)
        {
            if (operation == "prepare") return Prepare();
            if (!Guid.TryParse(idText, out var id))
                throw new InvalidPluginExecutionException("A valid notification record ID is required.");
            if (operation == "begin") return Begin(id);
            if (operation == "complete") return Complete(id, outcome);
            var reminderSources = new Dictionary<string, string>
            {
                ["remind-request"] = "abs_request", ["remind-claim"] = "abs_activityclaim",
                ["remind-campaign"] = "abs_campaign", ["remind-event"] = "abs_event"
            };
            if (!reminderSources.TryGetValue(operation, out var table))
                throw new InvalidPluginExecutionException("Unknown notification operation.");
            var source = Get(table, id);
            if (source != null && Due(operation, source))
                Event(operation, source, DateTime.UtcNow.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
            return new WorkResult();
        }

        private WorkResult Prepare()
        {
            var abandoned = Query("abs_notificationdelivery", "abs_state", Sending);
            abandoned.Criteria.AddCondition("modifiedon", ConditionOperator.LessThan, DateTime.UtcNow.AddMinutes(-15));
            abandoned.TopCount = 100;
            foreach (var delivery in service.RetrieveMultiple(abandoned).Entities)
                CompareUpdate(delivery, Field("abs_state", Uncertain), Field("abs_error", "A send was interrupted. Check the connector run and destination before retrying; no automatic resend was attempted."));
            var abandonedEvents = Query("abs_notificationevent", "abs_state", 2);
            abandonedEvents.Criteria.AddCondition("modifiedon", ConditionOperator.LessThan, DateTime.UtcNow.AddMinutes(-15));
            abandonedEvents.TopCount = 100;
            foreach (var item in service.RetrieveMultiple(abandonedEvents).Entities)
                CompareUpdate(item, Field("abs_state", 0));
            var events = Query("abs_notificationevent", "abs_state", 0);
            events.TopCount = 5;
            events.AddOrder("createdon", OrderType.Ascending);
            foreach (var candidate in service.RetrieveMultiple(events).Entities)
            {
                var item = candidate;
                CompareUpdate(item, Field("abs_state", 2));
                var category = Category(item.GetAttributeValue<string>("abs_kind"));
                var source = Source(item);
                if (source == null)
                {
                    Update(item, Field("abs_state", 1));
                    continue;
                }
                var query = new QueryExpression("abs_notificationpreference") { ColumnSet = new ColumnSet(true) };
                query.Criteria.AddCondition("abs_paused", ConditionOperator.Equal, false);
                query.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);
                query.Criteria.AddCondition(category, ConditionOperator.GreaterThan, 0);
                query.AddOrder("abs_notificationpreferenceid", OrderType.Ascending);
                query.PageInfo = new PagingInfo
                {
                    Count = 25,
                    PageNumber = item.GetAttributeValue<int>("abs_page"),
                    PagingCookie = item.GetAttributeValue<string>("abs_cookie")
                };
                var page = service.RetrieveMultiple(query);
                foreach (var preference in page.Entities)
                {
                    var recipient = User(preference.GetAttributeValue<EntityReference>("ownerid").Id);
                    if (!Eligible(item, source, recipient)) continue;
                    var selected = preference.GetAttributeValue<int>(category);
                    foreach (var channel in new[] { 1, 2 })
                    {
                        if ((selected & channel) == 0) continue;
                        var id = StableId(item.Id + "|" + recipient.Id + "|" + channel);
                        if (Get("abs_notificationdelivery", id) != null) continue;
                        var delivery = new Entity("abs_notificationdelivery", id);
                        foreach (var field in new[] { "abs_kind", "abs_source", "abs_sourceid", "abs_actorid", "abs_expectedstatus", "abs_messageid" })
                            if (item.Contains(field)) delivery[field] = item[field];
                        delivery["abs_name"] = Title(item, source);
                        delivery["ownerid"] = recipient.ToEntityReference();
                        delivery["abs_recipientobjectid"] = recipient.GetAttributeValue<Guid>("azureactivedirectoryobjectid").ToString("D");
                        delivery["abs_channel"] = channel;
                        delivery["abs_state"] = Pending;
                        service.Create(delivery);
                    }
                }
                Update(item, Field("abs_state", page.MoreRecords ? 0 : 1), Field("abs_page", query.PageInfo.PageNumber + 1), Field("abs_cookie", page.PagingCookie));
            }
            return new WorkResult();
        }

        private WorkResult Begin(Guid id)
        {
            var delivery = Get("abs_notificationdelivery", id) ?? throw new InvalidPluginExecutionException("Notification delivery not found.");
            if (delivery.GetAttributeValue<int>("abs_state") != Pending) return new WorkResult();
            var recipient = User(delivery.GetAttributeValue<EntityReference>("ownerid").Id);
            var preference = Get("abs_notificationpreference", recipient.Id);
            var channel = delivery.GetAttributeValue<int>("abs_channel");
            var source = Source(delivery);
            if (preference == null || Choice(preference, "statecode") != 0 || preference.GetAttributeValue<bool>("abs_paused") ||
                (preference.GetAttributeValue<int>(Category(delivery.GetAttributeValue<string>("abs_kind"))) & channel) == 0 ||
                source == null || !Eligible(delivery, source, recipient))
            {
                Update(delivery, Field("abs_state", Skipped), Field("abs_error", "Not sent: preferences, access, audience, or source status changed."));
                return new WorkResult();
            }
            var upn = recipient.GetAttributeValue<string>("domainname");
            var mail = recipient.GetAttributeValue<string>("internalemailaddress");
            if (string.IsNullOrWhiteSpace(upn) || (channel == 2 && string.IsNullOrWhiteSpace(mail)))
            {
                Update(delivery, Field("abs_state", Failed), Field("abs_error", "The recipient has no usable Teams identity or email address."));
                return new WorkResult();
            }
            var url = Link(delivery);
            var kind = delivery.GetAttributeValue<string>("abs_kind")!;
            var configuration = TemplateSettings();
            var template = configuration.templates!.SingleOrDefault(item => item.kind == kind) ?? NotificationContent.Default(kind);
            var payload = NotificationContent.Render(template, ContentValues(delivery, source), url,
                kind == "remind-event" ? source.GetAttributeValue<string>("crd49_meetinglink") : null);
            CompareUpdate(delivery, Field("abs_state", Sending), Field("abs_error", null));
            payload.send = true;
            payload.channel = channel;
            payload.recipient = channel == 1 ? upn : mail;
            return payload;
        }

        private TemplateConfiguration TemplateSettings()
        {
            var query = new QueryExpression("abs_programsettings") { ColumnSet = new ColumnSet("abs_notificationtemplates"), TopCount = 2 };
            var settings = service.RetrieveMultiple(query).Entities;
            if (settings.Count > 1) throw new InvalidPluginExecutionException("Multiple Program Settings records make notification templates ambiguous.");
            return NotificationContent.Read(settings.FirstOrDefault()?.GetAttributeValue<string>("abs_notificationtemplates"));
        }
        private string ReferenceName(Entity source, string field)
        {
            var reference = source.GetAttributeValue<EntityReference>(field);
            if (reference == null) return "";
            var row = Get(reference.LogicalName, reference.Id);
            if (row == null) return "";
            var name = row.LogicalName == "abs_champion" ? row.GetAttributeValue<string>("crd49_displayname") : row.GetAttributeValue<string>("abs_name");
            return NotificationContent.Clip(name);
        }
        private Dictionary<string, string> ContentValues(Entity item, Entity source)
        {
            var values = new Dictionary<string, string> { ["Title"] = Title(item, source), ["Summary"] = Summary(item) };
            if (source.LogicalName == "abs_request")
            {
                values["Requester"] = ReferenceName(source, "crd49_champion");
                values["Category"] = ReferenceName(source, "abs_category");
                if (values["Category"] == "")
                {
                    var category = Choice(source, "crd49_category");
                    values["Category"] = category == 839560000 ? "License request" : category == 839560001 ? "Connector request" :
                        category == 839560002 ? "Agent support" : category == 839560003 ? "Department AI support" : "";
                }
                values["Status"] = StatusLabel(source);
                values["Description"] = NotificationContent.Clip(source.GetAttributeValue<string>("crd49_description"));
                var messageId = item.GetAttributeValue<string>("abs_messageid");
                // Older queued replies lack a stable message ID; never substitute a later reply.
                values["Reply"] = string.IsNullOrEmpty(messageId) ? "" :
                    NotificationContent.Clip(Json.Thread(source.GetAttributeValue<string>("crd49_response"))
                        .SingleOrDefault(message => message.id == messageId)?.text);
            }
            else if (source.LogicalName == "abs_activityclaim")
            {
                values["Activity"] = ReferenceName(source, "crd49_activity");
                values["Claimant"] = ReferenceName(source, "crd49_champion");
                values["Campaign"] = ReferenceName(source, "crd49_campaign");
                values["Status"] = StatusLabel(source);
                var reference = source.GetAttributeValue<EntityReference>("crd49_activity");
                var activity = reference == null ? null : Get("abs_activity", reference.Id);
                values["Points"] = activity != null && activity.Contains("crd49_points")
                    ? activity.GetAttributeValue<int>("crd49_points").ToString(CultureInfo.InvariantCulture) : "";
            }
            else if (source.LogicalName == "abs_campaign")
            {
                values["CampaignStart"] = NotificationContent.Date(source, "crd49_startdate");
                values["CampaignEnd"] = NotificationContent.Date(source, "crd49_enddate");
                values["Description"] = NotificationContent.Clip(source.GetAttributeValue<string>("crd49_description"));
            }
            else
            {
                values["EventStart"] = NotificationContent.Date(source, "crd49_eventdate");
                values["EventEnd"] = NotificationContent.Date(source, "abs_eventend");
                values["Location"] = NotificationContent.Clip(source.GetAttributeValue<string>("crd49_location"));
                values["Format"] = Choice(source, "crd49_format") == 839560000 ? "Online" : Choice(source, "crd49_format") == 839560001 ? "In person" : "";
                values["Campaign"] = ReferenceName(source, "crd49_campaign");
                values["Description"] = NotificationContent.Clip(source.GetAttributeValue<string>("crd49_description"));
            }
            return values;
        }
        private static string StatusLabel(Entity source)
        {
            var status = Choice(source, "crd49_status");
            if (source.LogicalName == "abs_activityclaim")
                return status == Open ? "Pending" : status == Approved ? "Approved" : status == Rejected ? "Rejected" : "";
            return status == Open ? "Open" : status == InReview ? "In review" : status == 839560002 ? "Approved" :
                status == 839560003 ? "Rejected" : status == 839560004 ? "Fulfilled" : "";
        }

        private WorkResult Complete(Guid id, string? outcome)
        {
            var delivery = Get("abs_notificationdelivery", id) ?? throw new InvalidPluginExecutionException("Notification delivery not found.");
            if (delivery.GetAttributeValue<int>("abs_state") != Sending) return new WorkResult();
            if (outcome == "sent")
                CompareUpdate(delivery, Field("abs_state", Sent), Field("abs_senton", DateTime.UtcNow));
            else if (outcome == "failed")
                CompareUpdate(delivery, Field("abs_state", Failed), Field("abs_error", "The connector rejected the send. Check the Power Automate run before manually retrying."));
            else if (outcome == "uncertain")
                CompareUpdate(delivery, Field("abs_state", Uncertain), Field("abs_error", "Delivery could not be confirmed. Check Teams or email before retrying; no automatic resend was attempted."));
            else throw new InvalidPluginExecutionException("Unknown delivery outcome.");
            return new WorkResult();
        }

        private bool Eligible(Entity item, Entity source, Entity user)
        {
            if (Choice(source, "statecode") != 0) return false;
            if (user.GetAttributeValue<bool>("isdisabled") || user.GetAttributeValue<Guid>("azureactivedirectoryobjectid") == Guid.Empty) return false;
            var kind = item.GetAttributeValue<string>("abs_kind") ?? "";
            var reviewer = IsReviewer(user);
            var champion = Champion(user);
            if (!reviewer && (champion == null || Choice(champion, "crd49_status") == Rejected)) return false;
            if ((kind == "request.created" || kind == "request.reply.user" || kind == "claim.created") &&
                item.GetAttributeValue<string>("abs_actorid") == user.Id.ToString("D")) return false;
            if (kind == "request.created") return reviewer && PendingRequest(source);
            if (kind == "request.reply.user") return reviewer;
            if (kind == "request.reply.admin") return IsRequester(source, user);
            if (kind == "request.status") return IsRequester(source, user) &&
                Choice(source, "crd49_status") == item.GetAttributeValue<int>("abs_expectedstatus");
            if (kind == "claim.created") return reviewer && Choice(source, "crd49_status") == Open;
            if (kind == "claim.approved" || kind == "claim.rejected")
                return IsClaimant(source, user) && Choice(source, "crd49_status") == (kind == "claim.approved" ? Approved : Rejected);
            if (kind == "campaign.launched") return CampaignLive(source) && Audience(source, champion, reviewer);
            if (kind == "remind-request" || kind == "remind-claim") return reviewer && Due(kind, source);
            if (kind == "remind-campaign") return Due(kind, source) && champion != null && Joined(source.Id, champion.Id);
            if (kind == "remind-event")
            {
                if (!Due(kind, source)) return false;
                var campaign = source.GetAttributeValue<EntityReference>("crd49_campaign");
                if (campaign == null) return reviewer || champion != null;
                var row = Get("abs_campaign", campaign.Id);
                return row != null && CampaignLive(row) && (reviewer || champion != null && Joined(campaign.Id, champion.Id));
            }
            throw new InvalidPluginExecutionException("Unknown notification event kind.");
        }

        private static bool Due(string kind, Entity source)
        {
            if (Choice(source, "statecode") != 0) return false;
            var now = DateTime.UtcNow;
            if (kind == "remind-request") return PendingRequest(source) && source.GetAttributeValue<DateTime>("modifiedon") <= now.AddHours(-48);
            if (kind == "remind-claim") return Choice(source, "crd49_status") == Open && source.GetAttributeValue<DateTime>("modifiedon") <= now.AddHours(-48);
            if (kind == "remind-campaign")
            {
                var end = source.GetAttributeValue<DateTime>("crd49_enddate");
                return CampaignLive(source) && end.Date <= now.Date.AddDays(7);
            }
            if (kind == "remind-event")
            {
                var start = source.GetAttributeValue<DateTime>("crd49_eventdate");
                return start > now && start <= now.AddHours(24);
            }
            return false;
        }

        private bool Audience(Entity campaign, Entity? champion, bool reviewer)
        {
            if (reviewer) return true;
            if (champion == null) return false;
            var query = Query("abs_campaigndepartment", "abs_campaign", campaign.Id);
            query.ColumnSet = new ColumnSet("abs_department");
            var departments = All(query).Select(r => r.GetAttributeValue<EntityReference>("abs_department")?.Id).ToArray();
            return departments.Length == 0 || departments.Contains(champion.GetAttributeValue<EntityReference>("crd49_department")?.Id);
        }

        private bool Joined(Guid campaign, Guid champion)
        {
            var query = Query("abs_campaignparticipation", "crd49_campaign", campaign);
            query.Criteria.AddCondition("crd49_champion", ConditionOperator.Equal, champion);
            query.TopCount = 1;
            return service.RetrieveMultiple(query).Entities.Count != 0;
        }

        private bool IsRequester(Entity request, Entity user) => ChampionMatches(request.GetAttributeValue<EntityReference>("crd49_champion"), user);
        private bool IsClaimant(Entity claim, Entity user) => ChampionMatches(claim.GetAttributeValue<EntityReference>("crd49_champion"), user);
        private bool ChampionMatches(EntityReference? reference, Entity user)
        {
            if (reference == null) return false;
            var userId = user.GetAttributeValue<string>("domainname")?.Trim();
            return !string.IsNullOrEmpty(userId) && string.Equals(
                Get("abs_champion", reference.Id)?.GetAttributeValue<string>("abs_userid")?.Trim(),
                userId, StringComparison.OrdinalIgnoreCase);
        }
        private Entity? Champion(Entity user)
        {
            var userId = (user.GetAttributeValue<string>("domainname") ?? "").Trim().ToLowerInvariant();
            if (userId.Length == 0) return null;
            var query = Query("abs_champion", "abs_userid", userId);
            query.Criteria.FilterOperator = LogicalOperator.Or;
            query.Criteria.AddCondition("abs_normalizeduserid", ConditionOperator.Equal, userId);
            query.TopCount = 2;
            var rows = service.RetrieveMultiple(query).Entities;
            if (rows.Count > 1) throw new InvalidPluginExecutionException("Multiple Champion profiles match a notification recipient.");
            return rows.FirstOrDefault();
        }
        private bool IsReviewer(Entity user)
        {
            var champion = Champion(user);
            if (champion != null && Choice(champion, "crd49_role") == InReview) return true;
            var query = Query("abs_appadmin", "abs_userid", user.GetAttributeValue<string>("domainname") ?? "");
            query.TopCount = 1;
            return service.RetrieveMultiple(query).Entities.Count != 0;
        }
        private Entity User(Guid id)
        {
            if (!users.TryGetValue(id, out var user))
            {
                user = service.Retrieve("systemuser", id, new ColumnSet("domainname", "internalemailaddress", "fullname", "isdisabled", "azureactivedirectoryobjectid"));
                users.Add(id, user);
            }
            return user;
        }
        private Entity? Source(Entity item)
        {
            var table = item.GetAttributeValue<string>("abs_source");
            if (!new[] { "abs_request", "abs_activityclaim", "abs_campaign", "abs_event" }.Contains(table) ||
                !Guid.TryParse(item.GetAttributeValue<string>("abs_sourceid"), out var id))
                throw new InvalidPluginExecutionException("Invalid notification source.");
            return Get(table!, id);
        }
        private Entity? Get(string table, Guid id)
        {
            var query = Query(table, table + "id", id);
            query.TopCount = 1;
            return service.RetrieveMultiple(query).Entities.FirstOrDefault();
        }
        private static QueryExpression Query(string table, string column, object value)
        {
            var query = new QueryExpression(table) { ColumnSet = new ColumnSet(true) };
            query.Criteria.AddCondition(column, ConditionOperator.Equal, value);
            return query;
        }
        private IEnumerable<Entity> All(QueryExpression query)
        {
            query.PageInfo = new PagingInfo { Count = 5000, PageNumber = 1 };
            while (true)
            {
                var page = service.RetrieveMultiple(query);
                foreach (var row in page.Entities) yield return row;
                if (!page.MoreRecords) yield break;
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
        }
        private static KeyValuePair<string, object?> Field(string key, object? value) => new KeyValuePair<string, object?>(key, value);
        private void Update(Entity entity, params KeyValuePair<string, object?>[] changes)
        {
            var patch = new Entity(entity.LogicalName, entity.Id);
            foreach (var change in changes) patch[change.Key] = change.Value;
            service.Update(patch);
            trace.Trace("Notification {0}: {1}", entity.LogicalName, entity.Id);
        }
        private void CompareUpdate(Entity entity, params KeyValuePair<string, object?>[] changes)
        {
            var version = entity.RowVersion ?? entity.GetAttributeValue<long>("versionnumber").ToString(CultureInfo.InvariantCulture);
            if (version == "0") throw new InvalidPluginExecutionException("Notification tables require optimistic concurrency.");
            var patch = new Entity(entity.LogicalName, entity.Id) { RowVersion = version };
            foreach (var change in changes) patch[change.Key] = change.Value;
            service.Execute(new UpdateRequest { Target = patch, ConcurrencyBehavior = ConcurrencyBehavior.IfRowVersionMatches });
        }
        private string Link(Entity delivery)
        {
            var definitions = service.RetrieveMultiple(Query("environmentvariabledefinition", "schemaname", "abs_NotificationAppUrl")).Entities;
            if (definitions.Count != 1) throw new InvalidPluginExecutionException("Configure the notification app URL environment variable.");
            var values = service.RetrieveMultiple(Query("environmentvariablevalue", "environmentvariabledefinitionid", definitions[0].Id)).Entities;
            if (values.Count > 1) throw new InvalidPluginExecutionException("The notification app URL has multiple current values.");
            var text = values.FirstOrDefault()?.GetAttributeValue<string>("value") ?? definitions[0].GetAttributeValue<string>("defaultvalue");
            if (!Uri.TryCreate(text, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
                uri.Host != "apps.powerapps.com" || !uri.AbsolutePath.StartsWith("/play/", StringComparison.Ordinal) || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0)
                throw new InvalidPluginExecutionException("Configure a canonical HTTPS Power Apps play URL for notifications.");
            var target = new Dictionary<string, string>
            {
                ["abs_request"] = "request", ["abs_activityclaim"] = "claim",
                ["abs_campaign"] = "campaign", ["abs_event"] = "event"
            }[delivery.GetAttributeValue<string>("abs_source")!];
            return text + (uri.Query.Length == 0 ? "?" : "&") + "hubTarget=" + target + "&hubId=" + delivery.GetAttributeValue<string>("abs_sourceid");
        }

        private static int Choice(Entity? row, string name) => row?.GetAttributeValue<OptionSetValue>(name)?.Value ?? -1;
        private static bool PendingRequest(Entity row) => Choice(row, "crd49_status") == Open || Choice(row, "crd49_status") == InReview;
        private static bool CampaignLive(Entity row) =>
            Choice(row, "statecode") == 0 && Choice(row, "crd49_status") == InReview && row.GetAttributeValue<DateTime>("crd49_enddate").Date >= DateTime.UtcNow.Date;
        private static readonly string[] Categories = { "abs_requests", "abs_claims", "abs_campaigns", "abs_reminders" };
        private static string Category(string? kind) => kind != null && kind.StartsWith("request.", StringComparison.Ordinal) ? "abs_requests" :
            kind != null && kind.StartsWith("claim.", StringComparison.Ordinal) ? "abs_claims" :
            kind == "campaign.launched" ? "abs_campaigns" :
            kind != null && kind.StartsWith("remind-", StringComparison.Ordinal) ? "abs_reminders" :
            throw new InvalidPluginExecutionException("Unknown notification category.");
        private static string Title(Entity item, Entity source)
        {
            var kind = item.GetAttributeValue<string>("abs_kind") ?? "";
            var name = source.GetAttributeValue<string>(source.LogicalName == "abs_request" ? "abs_title" : "abs_name") ?? "Hub update";
            if (name.Length > 160) name = name.Substring(0, 160);
            return kind.StartsWith("remind-", StringComparison.Ordinal) ? "Reminder: " + name : name;
        }
        private static string Summary(Entity item)
        {
            var summaries = new Dictionary<string, string>
            {
                ["request.created"] = "A new request needs review.",
                ["request.reply.admin"] = "A program manager or app admin replied to your request. Open the Hub for the reply and current status.",
                ["request.reply.user"] = "A requester replied. Open the Hub to review the conversation.",
                ["request.status"] = "Your request status changed. Open the Hub to view the current status.",
                ["claim.created"] = "An activity claim is awaiting approval.",
                ["claim.approved"] = "Your activity claim has been approved.",
                ["claim.rejected"] = "Your activity claim has been rejected. Open the Hub for details.",
                ["campaign.launched"] = "A campaign is now available to you.",
                ["remind-request"] = "A request has been awaiting attention for at least 48 hours.",
                ["remind-claim"] = "An activity claim has been awaiting approval for at least 48 hours.",
                ["remind-campaign"] = "A campaign you joined ends within seven days.",
                ["remind-event"] = "An event starts within the next 24 hours."
            };
            return summaries[item.GetAttributeValue<string>("abs_kind")!];
        }
        internal static Guid StableId(string text)
        {
            using (var hash = SHA256.Create()) return new Guid(hash.ComputeHash(Encoding.UTF8.GetBytes(text)).Take(16).ToArray());
        }
    }

    [DataContract]
    internal sealed class WorkResult
    {
        [DataMember] public bool send;
        [DataMember] public int channel;
        [DataMember] public string? recipient;
        [DataMember] public string? subject;
        [DataMember] public string? card;
        [DataMember] public string? email;
    }
    [DataContract]
    internal sealed class ReplyCommand
    {
        [DataMember] public string? id;
        [DataMember] public string? text;
    }
    [DataContract]
    internal sealed class ThreadEnvelope
    {
        [DataMember] public int v = 1;
        [DataMember] public List<ThreadMessage> messages = new List<ThreadMessage>();
    }
    [DataContract]
    internal sealed class ThreadMessage
    {
        [DataMember(EmitDefaultValue = false)] public string? id;
        [DataMember(EmitDefaultValue = false)] public string? actor;
        [DataMember] public string? by;
        [DataMember] public string? name;
        [DataMember] public string? text;
        [DataMember] public string? at;
        internal bool SameContent(ThreadMessage other) => by == other.by && name == other.name && text == other.text && at == other.at;
    }
    internal static class Json
    {
        internal static string Write<T>(T value)
        {
            using (var stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }
        internal static T Read<T>(string text)
        {
            try
            {
                using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(text)))
                    return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
            }
            catch (SerializationException)
            {
                throw new InvalidPluginExecutionException("The notification or reply payload is not valid JSON.");
            }
        }
        internal static List<ThreadMessage> Thread(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return new List<ThreadMessage>();
            var trimmed = raw!.Trim();
            if (trimmed.StartsWith("{", StringComparison.Ordinal) || trimmed.StartsWith("[", StringComparison.Ordinal))
            {
                try
                {
                    using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(trimmed)))
                    {
                        var type = trimmed[0] == '[' ? typeof(List<ThreadMessage>) : typeof(ThreadEnvelope);
                        var parsed = new DataContractJsonSerializer(type).ReadObject(stream);
                        var messages = parsed is ThreadEnvelope envelope ? envelope.messages : parsed as List<ThreadMessage>;
                        if (messages != null)
                            return messages.Where(m => m != null && !string.IsNullOrEmpty(m.text)).Select(m =>
                            {
                                m.by = m.by == "requester" ? "requester" : "admin";
                                if (string.IsNullOrEmpty(m.name)) m.name = m.by == "requester" ? "Requester" : "Admin";
                                if (m.at == null) m.at = "";
                                return m;
                            }).ToList();
                    }
                }
                catch (SerializationException) { /* Legacy plain-text responses can start with a brace. */ }
            }
            return new List<ThreadMessage> { new ThreadMessage { by = "admin", name = "Admin", text = raw, at = "" } };
        }
    }
}
