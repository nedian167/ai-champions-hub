using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Xml;
using Hub.Notifications;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;

var cases = new (string Name, Action Run)[]
{
    ("Champion identities are normalized on create and update", () => {
        var f = new Fixture();
        foreach (var message in new[] { "Create", "Update" }) {
            var target = new Entity("abs_champion", Guid.NewGuid()) { ["abs_userid"] = "  Lisa.Taylor@example.test  " };
            f.Worker(f.Admin, message).ChampionIdentity(target);
            Check((string)target["abs_userid"] == "lisa.taylor@example.test");
            Check((string)target["abs_normalizeduserid"] == "lisa.taylor@example.test");
        }
    }),
    ("Champion creation rejects existing users regardless of profile status or letter case", () => {
        foreach (var status in new[] { 839560000, 839560001, 839560002 }) {
            var f = new Fixture();
            f.Db.Update(new Entity("abs_champion", f.UserChampion.Id) {
                ["abs_userid"] = "LiSa.Taylor@example.test", ["crd49_status"] = new OptionSetValue(status), ["statecode"] = new OptionSetValue(1)
            });
            Throws(() => f.Worker(f.Admin).ChampionIdentity(new Entity("abs_champion", Guid.NewGuid()) { ["abs_userid"] = " LISA.TAYLOR@example.test " }));
        }
    }),
    ("Champion edits exclude their own row but cannot take another identity", () => {
        var f = new Fixture();
        var own = new Entity("abs_champion", f.UserChampion.Id) { ["abs_userid"] = " USER@example.test " };
        f.Worker(f.Admin, "Update").ChampionIdentity(own);
        Check((string)own["abs_userid"] == "user@example.test");
        Throws(() => f.Worker(f.Admin, "Update").ChampionIdentity(new Entity("abs_champion", f.UserChampion.Id) { ["abs_userid"] = "manager@example.test" }));
    }),
    ("Champion updates without an identity leave existing fields alone", () => {
        var f = new Fixture();
        var target = new Entity("abs_champion", f.UserChampion.Id) { ["crd49_status"] = new OptionSetValue(839560002) };
        f.Worker(f.Admin, "Update").ChampionIdentity(target);
        Check(!target.Contains("abs_userid"));
    }),
    ("Champion writes reject missing or blank User IDs", () => {
        var f = new Fixture();
        Throws(() => f.Worker(f.Admin).ChampionIdentity(new Entity("abs_champion")));
        Throws(() => f.Worker(f.Admin, "Update").ChampionIdentity(new Entity("abs_champion", f.UserChampion.Id) { ["abs_userid"] = "  " }));
    }),
    ("different people can share a Champion display name", () => {
        var f = new Fixture();
        f.Db.Update(new Entity("abs_champion", f.UserChampion.Id) { ["crd49_displayname"] = "Lisa Taylor" });
        var target = new Entity("abs_champion", Guid.NewGuid()) { ["abs_userid"] = "another.lisa@example.test", ["crd49_displayname"] = "Lisa Taylor" };
        f.Worker(f.Admin).ChampionIdentity(target);
        Check((string)target["abs_userid"] == "another.lisa@example.test");
    }),
    ("legacy whitespace identities are protected by their backfilled key", () => {
        var f = new Fixture();
        f.Db.Update(new Entity("abs_champion", f.UserChampion.Id) {
            ["abs_userid"] = " Lisa.Taylor@example.test ", ["abs_normalizeduserid"] = "lisa.taylor@example.test"
        });
        Throws(() => f.Worker(f.Admin).ChampionIdentity(new Entity("abs_champion") { ["abs_userid"] = "LISA.TAYLOR@example.test" }));
    }),
    ("clients cannot forge or clear the normalized Champion identity", () => {
        var f = new Fixture();
        var target = new Entity("abs_champion", f.UserChampion.Id) { ["abs_normalizeduserid"] = null };
        f.Worker(f.Admin, "Update").ChampionIdentity(target);
        Check((string)target["abs_normalizeduserid"] == "user@example.test");
        var created = new Entity("abs_champion") { ["abs_userid"] = "new@example.test", ["abs_normalizeduserid"] = "manager@example.test" };
        f.Worker(f.Admin).ChampionIdentity(created);
        Check((string)created["abs_normalizeduserid"] == "new@example.test");
    }),
    ("oversized Champion identities are rejected without truncating them", () => {
        var f = new Fixture();
        Throws(() => f.Worker(f.Admin).ChampionIdentity(new Entity("abs_champion") { ["abs_userid"] = new string('x', 321) }));
    }),
    ("normalized identities preserve reviewer and requester authorization for legacy profiles", () => {
        var f = new Fixture();
        f.Db.Update(new Entity("abs_champion", f.ManagerChampion.Id) {
            ["abs_userid"] = " MANAGER@example.test ", ["abs_normalizeduserid"] = "manager@example.test"
        });
        f.Worker(f.Manager).Templates(new Entity("abs_programsettings") { ["abs_notificationtemplates"] = "{\"version\":1,\"templates\":[]}" });
        f.Db.Update(new Entity("abs_champion", f.UserChampion.Id) {
            ["abs_userid"] = " USER@example.test ", ["abs_normalizeduserid"] = "user@example.test"
        });
        f.Reply(f.User, "My reply");
        Check(f.Events.Count == 1);
    }),
    ("template configurations round-trip for every notification kind", () => {
        var config = new TemplateConfiguration { version = 1, templates = NotificationContent.Kinds.Keys.Select(NotificationContent.Default).ToList() };
        Check(NotificationContent.Read(Json.Write(config)).templates!.Count == 12);
    }),
    ("every template renders valid structured Adaptive Card JSON with only OpenUrl actions", () => {
        foreach (var kind in NotificationContent.Kinds.Keys) {
            var values = NotificationContent.Labels.ToDictionary(pair => pair.Key, pair => "Example " + pair.Key);
            values["Title"] = "Title with \"quotes\" and <markup>";
            values["Summary"] = "Example update";
            var result = NotificationContent.Render(NotificationContent.Default(kind), values, "https://apps.powerapps.com/play/e/test/app/test", null);
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(result.card!));
            using var reader = JsonReaderWriterFactory.CreateJsonReader(stream, XmlDictionaryReaderQuotas.Max);
            var document = new XmlDocument { XmlResolver = null };
            document.Load(reader);
            Check(document.SelectSingleNode("/root/type")!.InnerText == "AdaptiveCard");
            Check(document.SelectSingleNode("/root/version")!.InnerText == "1.4");
            Check(document.SelectNodes("/root/body/item[type='FactSet']")!.Count == 1);
            Check(document.SelectNodes("/root/actions/item[type='Action.OpenUrl']")!.Count == 1);
            Check(result.email!.Contains("&lt;markup&gt;"));
        }
    }),
    ("non-reviewers cannot write template configuration or commands", () => {
        var f = new Fixture();
        Throws(() => f.Worker(f.User).Templates(new Entity("abs_programsettings") { ["abs_notificationtemplates"] = "{\"version\":1,\"templates\":[]}" }));
        Throws(() => f.Worker(f.Other, "Update").Templates(new Entity("abs_programsettings") { ["abs_notificationtemplatecommand"] = "{}" }));
        Throws(() => f.Worker(f.User).Templates(new Entity("abs_programsettings") { ["abs_notificationtemplates"] = null }));
    }),
    ("persistent reviewers can save templates but stale updates cannot overwrite", () => {
        var f = new Fixture();
        var settings = f.Db.Put(new Entity("abs_programsettings", Guid.NewGuid()));
        var config = Json.Write(new TemplateConfiguration { version = 1, templates = new List<NotificationTemplate> { NotificationContent.Default("request.created") } });
        var target = new Entity("abs_programsettings", settings.Id) { ["abs_notificationtemplatecommand"] =
            Json.Write(new TemplateCommand { expected = null, configuration = config }) };
        f.Worker(f.Admin, "Update").Templates(target);
        Check((string)target["abs_notificationtemplates"] == config && target["abs_notificationtemplatecommand"] == null);
        f.Db.Update(target);
        Throws(() => f.Worker(f.Manager, "Update").Templates(new Entity("abs_programsettings", settings.Id) { ["abs_notificationtemplatecommand"] =
            Json.Write(new TemplateCommand { expected = null, configuration = config }) }));
        Throws(() => f.Worker(f.Admin, "Update").Templates(new Entity("abs_programsettings", settings.Id) { ["abs_notificationtemplates"] = null }));
    }),
    ("escaped maximum-length templates fit atomic update commands", () => {
        var f = new Fixture();
        var templates = NotificationContent.Kinds.Keys.Select(kind => {
            var template = NotificationContent.Default(kind);
            template.heading = new string('"', 120);
            template.subject = new string('"', 200);
            template.message = new string('"', 1200);
            template.actionLabel = new string('"', 40);
            return template;
        }).ToList();
        var config = Json.Write(new TemplateConfiguration { version = 1, templates = templates });
        var settings = f.Db.Put(new Entity("abs_programsettings", Guid.NewGuid()) { ["abs_notificationtemplates"] = config });
        var command = Json.Write(new TemplateCommand { expected = config, configuration = config });
        Check(config.Length <= 50000 && command.Length > 110000 && command.Length <= 210000);
        var target = new Entity("abs_programsettings", settings.Id) { ["abs_notificationtemplatecommand"] = command };
        f.Worker(f.Admin, "Update").Templates(target);
        Check((string)target["abs_notificationtemplates"] == config);
    }),
    ("disabled program managers cannot edit notification templates", () => {
        var f = new Fixture();
        f.Db.Update(new Entity("abs_champion", f.ManagerChampion.Id) { ["crd49_status"] = new OptionSetValue(839560002) });
        Throws(() => f.Worker(f.Manager).Templates(new Entity("abs_programsettings") { ["abs_notificationtemplates"] = "{\"version\":1,\"templates\":[]}" }));
    }),
    ("configured template settings cannot be deleted by a regular user", () => {
        var f = new Fixture();
        var settings = f.Db.Put(new Entity("abs_programsettings", Guid.NewGuid()) { ["abs_notificationtemplates"] = "{\"version\":1,\"templates\":[]}" });
        Throws(() => f.Worker(f.User).TemplateDeletion(settings.Id));
        f.Worker(f.Admin).TemplateDeletion(settings.Id);
    }),
    ("malformed, duplicate and unknown template configuration is rejected", () => {
        Throws(() => NotificationContent.Read("not JSON"));
        Throws(() => NotificationContent.Read("{\"version\":2,\"templates\":[]}"));
        Throws(() => NotificationContent.Read("{\"version\":1,\"templates\":[],\"evil\":true}"));
        Throws(() => NotificationContent.Read("{\"version\":1,\"version\":1,\"templates\":[]}"));
        Throws(() => NotificationContent.Read("{\"version\":\"1\",\"templates\":[]}"));
        Throws(() => NotificationContent.ReadCommand("{\"expected\":null,\"configuration\":\"{}\",\"extra\":false}"));
        Throws(() => NotificationContent.ReadCommand("{\"expected\":null,\"configuration\":{}}"));
        var item = NotificationContent.Default("request.created");
        Throws(() => NotificationContent.Read(Json.Write(new TemplateConfiguration { version = 1, templates = new List<NotificationTemplate> { item, item } })));
        item.message = "{EventStart}"; Throws(() => NotificationContent.Validate(item));
        item.message = "{Description}"; Throws(() => NotificationContent.Validate(item));
        item.fields!.Add("Description"); NotificationContent.Validate(item);
        item.fields.Add("Description"); Throws(() => NotificationContent.Validate(item));
    }),
    ("structured cards and emails include escaped facts and bounded excerpts", () => {
        var f = new Fixture();
        f.Db.Update(new Entity("abs_request", f.Request.Id) { ["crd49_description"] = "<script>alert(1)</script>" + new string('x', 700), ["crd49_category"] = new OptionSetValue(839560000) });
        var template = NotificationContent.Default("request.created");
        template.fields!.Add("Description");
        template.message = "New request: {Title}";
        var config = new TemplateConfiguration { version = 1, templates = new List<NotificationTemplate> { template } };
        f.Db.Put(new Entity("abs_programsettings", Guid.NewGuid()) { ["abs_notificationtemplates"] = Json.Write(config) });
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        var payload = f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null);
        Check(payload.card!.Contains("FactSet") && payload.card.Contains("License request") && payload.card.Contains("Description excerpt"));
        Check(payload.email!.Contains("&lt;script&gt;") && !payload.email.Contains("<script>"));
        Check(!payload.card.Contains(new string('x', 501)) && !payload.email.Contains(new string('x', 501)));
    }),
    ("default templates omit description and reply excerpts", () => {
        var f = new Fixture();
        f.Db.Update(new Entity("abs_request", f.Request.Id) { ["crd49_description"] = "private-secret-description" });
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        var payload = f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null);
        Check(!payload.card!.Contains("private-secret-description") && !payload.email!.Contains("private-secret-description"));
    }),
    ("reply excerpts use the triggering message, not a later reply", () => {
        var f = new Fixture();
        var template = NotificationContent.Default("request.reply.admin");
        template.fields!.Add("Reply");
        f.Db.Put(new Entity("abs_programsettings", Guid.NewGuid()) { ["abs_notificationtemplates"] =
            Json.Write(new TemplateConfiguration { version = 1, templates = new List<NotificationTemplate> { template } }) });
        f.Pref(f.User, 1);
        f.Reply(f.Admin, "First exact reply", Guid.NewGuid());
        f.Reply(f.Admin, "Later different reply", Guid.NewGuid());
        f.Prepare();
        var delivery = f.Deliveries.First(d => (string)d["abs_kind"] == "request.reply.admin" &&
            (string)d["abs_messageid"] == f.Events.First(e => (string)e["abs_kind"] == "request.reply.admin")["abs_messageid"].ToString());
        var payload = f.Worker(f.Admin).Work("begin", delivery.Id.ToString(), null);
        Check(payload.card!.Contains("First exact reply") && !payload.card.Contains("Later different reply"));
        f.Db.Update(new Entity("abs_notificationdelivery", delivery.Id) { ["abs_state"] = 0, ["abs_messageid"] = null });
        payload = f.Worker(f.Admin).Work("begin", delivery.Id.ToString(), null);
        Check(!payload.card!.Contains("First exact reply") && !payload.card.Contains("Later different reply"));
    }),
    ("event cards show saved UTC endpoints and only explicit safe meeting links", () => {
        var f = new Fixture();
        var row = f.Db.Put(new Entity("abs_event", Guid.NewGuid()) {
            ["abs_name"] = "Workshop", ["crd49_eventdate"] = DateTime.UtcNow.AddHours(2),
            ["abs_eventend"] = DateTime.UtcNow.AddHours(3), ["crd49_format"] = new OptionSetValue(839560000),
            ["crd49_location"] = "Online", ["crd49_meetinglink"] = "https://teams.microsoft.com/l/meetup-join/example"
        });
        var template = NotificationContent.Default("remind-event");
        template.includeMeetingLink = true;
        f.Db.Put(new Entity("abs_programsettings", Guid.NewGuid()) { ["abs_notificationtemplates"] =
            Json.Write(new TemplateConfiguration { version = 1, templates = new List<NotificationTemplate> { template } }) });
        f.Pref(f.User, 1); f.Worker(f.Admin).Work("remind-event", row.Id.ToString(), null); f.Prepare();
        var payload = f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null);
        Check(payload.card!.Contains("FactSet") && payload.card.Contains(NotificationContent.Date(row, "crd49_eventdate")) &&
            payload.card.Contains(NotificationContent.Date(row, "abs_eventend")) &&
            payload.email!.Contains("Start (UTC)") && payload.email.Contains("End (UTC)"));
        Check(payload.card.Contains("Join meeting") && payload.email!.Contains("Join meeting"));
        f.Db.Update(new Entity("abs_notificationdelivery", f.Deliveries[0].Id) { ["abs_state"] = 0 });
        f.Db.Update(new Entity("abs_event", row.Id) { ["crd49_meetinglink"] = "javascript:alert(1)" });
        payload = f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null);
        Check(!payload.card!.Contains("Join meeting") && !payload.email!.Contains("javascript:"));
    }),
    ("invalid stored templates fail before claiming or sending a delivery", () => {
        var f = new Fixture();
        f.Db.Put(new Entity("abs_programsettings", Guid.NewGuid()) { ["abs_notificationtemplates"] = "broken" });
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        Throws(() => f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null));
        Check((int)f.Deliveries[0]["abs_state"] == Worker.Pending);
    }),
    ("preferences default off and use authenticated identity", () => {
        var f = new Fixture();
        var target = new Entity("abs_notificationpreference") { ["abs_entraobjectid"] = Guid.NewGuid().ToString() };
        f.Worker(f.User).Preference(target);
        Check(target.Id == f.User.Id && target.GetAttributeValue<EntityReference>("ownerid").Id == f.User.Id);
        Check(target.GetAttributeValue<string>("abs_entraobjectid") == f.User.GetAttributeValue<Guid>("azureactivedirectoryobjectid").ToString());
        foreach (var category in new[] { "abs_requests", "abs_claims", "abs_campaigns", "abs_reminders" }) Check((int)target[category] == 0);
    }),
    ("admin without Champion profile can manage preferences", () => {
        var f = new Fixture();
        var target = new Entity("abs_notificationpreference");
        f.Worker(f.Admin).Preference(target);
        Check(target.Id == f.Admin.Id);
    }),
    ("another user cannot change preferences", () => {
        var f = new Fixture();
        f.Pref(f.User, 3);
        Throws(() => f.Worker(f.Other, "Update").Preference(new Entity("abs_notificationpreference", f.User.Id) { ["abs_requests"] = 1 }));
    }),
    ("preference ownership and channels cannot be forged", () => {
        var f = new Fixture();
        Throws(() => f.Worker(f.User).Preference(new Entity("abs_notificationpreference") { ["ownerid"] = f.Other.ToEntityReference() }));
        Throws(() => f.Worker(f.User).Preference(new Entity("abs_notificationpreference") { ["abs_requests"] = 4 }));
        f.Pref(f.User, 0);
        Throws(() => f.Worker(f.User, "Update").Preference(new Entity("abs_notificationpreference", f.User.Id) { ["abs_entraobjectid"] = Guid.NewGuid().ToString() }));
    }),
    ("off-by-default produces no deliveries", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 0);
        f.CaptureRequest();
        f.Prepare();
        Check(f.Deliveries.Count == 0);
    }),
    ("new requests route only to opted-in reviewers, separately per channel", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 3); f.Pref(f.User, 3); f.Pref(f.Other, 3);
        f.CaptureRequest(); f.Prepare();
        Check(f.Deliveries.Count == 2 && f.Deliveries.All(d => d.GetAttributeValue<EntityReference>("ownerid").Id == f.Manager.Id));
        Check(f.Deliveries.Select(d => (int)d["abs_channel"]).OrderBy(value => value).SequenceEqual(new[] { 1, 2 }));
    }),
    ("app admins without Champion profiles receive reviewer notifications", () => {
        var f = new Fixture();
        f.Pref(f.Admin, 1); f.CaptureRequest(); f.Prepare();
        Check(f.Deliveries.Count == 1 && f.Deliveries[0].GetAttributeValue<EntityReference>("ownerid").Id == f.Admin.Id);
    }),
    ("preparation and delivery begin are idempotent", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare(); f.Prepare();
        Check(f.Deliveries.Count == 1);
        var id = f.Deliveries[0].Id;
        Check(f.Worker(f.Admin).Work("begin", id.ToString(), null).send);
        Check(!f.Worker(f.Admin).Work("begin", id.ToString(), null).send);
    }),
    ("recipient pagination does not stop at the first page", () => {
        var f = new Fixture();
        for (var i = 0; i < 56; i++) {
            var user = f.MakeUser("reviewer" + i);
            f.Db.Put(new Entity("abs_appadmin", Guid.NewGuid()) { ["abs_userid"] = user["domainname"] });
            f.Pref(user, 1);
        }
        f.CaptureRequest(); f.Prepare(); f.Prepare(); f.Prepare();
        Check(f.Deliveries.Count == 56 && f.Events.All(e => (int)e["abs_state"] == 1));
    }),
    ("opting out after queueing cancels delivery without channel fallback", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        f.Db.Update(new Entity("abs_notificationpreference", f.Manager.Id) { ["abs_requests"] = 0 });
        Check(!f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null).send);
        Check((int)f.Deliveries[0]["abs_state"] == Worker.Skipped && f.Deliveries.Count == 1);
    }),
    ("pausing after queueing cancels delivery", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        f.Db.Update(new Entity("abs_notificationpreference", f.Manager.Id) { ["abs_paused"] = true });
        Check(!f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null).send);
    }),
    ("reviewer role loss is checked again before sending", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        f.Db.Update(new Entity("abs_champion", f.ManagerChampion.Id) { ["crd49_role"] = new OptionSetValue(839560000) });
        Check(!f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null).send);
    }),
    ("disabled recipients and deleted sources are not sent", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        f.Db.Delete("abs_request", f.Request.Id);
        Check(!f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null).send);
        f = new Fixture(); f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        f.Db.Update(new Entity("systemuser", f.Manager.Id) { ["isdisabled"] = true });
        Check(!f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null).send);
    }),
    ("new replies are stamped and append to the latest thread", () => {
        var f = new Fixture();
        f.Reply(f.User, "first");
        f.Reply(f.Manager, "second");
        var thread = Json.Thread(f.Db.Row("abs_request", f.Request.Id).GetAttributeValue<string>("crd49_response"));
        Check(thread.Count == 2 && thread[0].text == "first" && thread[1].text == "second");
        Check(thread[0].by == "requester" && thread[1].by == "admin");
        Check(thread[0].actor == f.User.Id.ToString() && Guid.TryParse(thread[1].id, out _));
    }),
    ("same reply ID retries do not duplicate replies or events", () => {
        var f = new Fixture();
        var id = Guid.NewGuid();
        f.Reply(f.User, "retry", id); f.Reply(f.User, "retry", id);
        Check(Json.Thread(f.Db.Row("abs_request", f.Request.Id).GetAttributeValue<string>("crd49_response")).Count == 1);
        Check(f.Events.Count == 1);
        Throws(() => f.Reply(f.User, "changed", id));
    }),
    ("requester cannot change status or reply to another request", () => {
        var f = new Fixture();
        Throws(() => f.Reply(f.Other, "not mine"));
        Throws(() => f.Worker(f.User, "Update").Reply(new Entity("abs_request", f.Request.Id) { ["crd49_status"] = new OptionSetValue(839560002) }));
    }),
    ("reply and status change produce one requester notification", () => {
        var f = new Fixture();
        f.Pref(f.User, 1);
        f.Reply(f.Manager, "done", null, 839560002); f.Prepare();
        Check(f.Events.Count == 1 && f.Deliveries.Count == 1 && (string)f.Deliveries[0]["abs_kind"] == "request.reply.admin");
    }),
    ("unchanged status does not emit another event", () => {
        var f = new Fixture();
        var worker = f.Worker(f.Manager, "Update");
        var target = new Entity("abs_request", f.Request.Id) { ["crd49_status"] = new OptionSetValue(839560000) };
        worker.Reply(target); f.Db.Update(target); worker.Capture(target);
        Check(f.Events.Count == 0);
    }),
    ("a queued status alert is skipped when the request status changes again", () => {
        var f = new Fixture();
        f.Pref(f.User, 1);
        var worker = f.Worker(f.Manager, "Update");
        var target = new Entity("abs_request", f.Request.Id) { ["crd49_status"] = new OptionSetValue(839560001) };
        worker.Reply(target); f.Db.Update(target); worker.Capture(target); f.Prepare();
        Check(f.Deliveries.Count == 1 && (string)f.Deliveries[0]["abs_kind"] == "request.status");
        f.Db.Update(new Entity("abs_request", f.Request.Id) { ["crd49_status"] = new OptionSetValue(839560002) });
        Check(!f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null).send);
    }),
    ("legacy responses are preserved and stale overwrites rejected", () => {
        var f = new Fixture();
        f.Db.Update(new Entity("abs_request", f.Request.Id) { ["crd49_response"] = "Legacy response" });
        f.Reply(f.User, "new");
        var thread = Json.Thread(f.Db.Row("abs_request", f.Request.Id).GetAttributeValue<string>("crd49_response"));
        Check(thread.Count == 2 && thread[0].text == "Legacy response");
        Throws(() => f.Worker(f.User, "Update").Reply(new Entity("abs_request", f.Request.Id) { ["crd49_response"] = "Legacy response" }));
    }),
    ("self-approved claims notify the claimant without asking reviewers to approve", () => {
        var f = new Fixture();
        f.Pref(f.User, 1); f.Pref(f.Manager, 1);
        var claim = f.Claim(839560001);
        f.Worker(f.User).Capture(claim); f.Prepare();
        Check(f.Deliveries.Count == 1 && (string)f.Deliveries[0]["abs_kind"] == "claim.approved");
        Check(f.Deliveries[0].GetAttributeValue<EntityReference>("ownerid").Id == f.User.Id);
    }),
    ("claim decisions are rechecked before delivery", () => {
        var f = new Fixture();
        f.Pref(f.User, 1);
        var claim = f.Claim(839560001); f.Worker(f.User).Capture(claim); f.Prepare();
        f.Db.Update(new Entity(claim.LogicalName, claim.Id) { ["crd49_status"] = new OptionSetValue(839560002) });
        Check(!f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null).send);
    }),
    ("campaign launch waits for completed audience setup", () => {
        var f = new Fixture();
        var campaign = f.Campaign(false);
        f.Worker(f.Manager).Capture(campaign);
        Check(f.Events.Count == 0);
        f.Db.Update(new Entity(campaign.LogicalName, campaign.Id) { ["abs_notificationready"] = true });
        f.Worker(f.Manager, "Update", campaign).Capture(campaign);
        Check(f.Events.Count == 1);
    }),
    ("campaign launch respects department audience and opted-in channels", () => {
        var f = new Fixture();
        f.Pref(f.User, 1); f.Pref(f.Other, 1);
        var campaign = f.Campaign(true);
        f.Db.Put(new Entity("abs_campaigndepartment", Guid.NewGuid()) {
            ["abs_campaign"] = campaign.ToEntityReference(), ["abs_department"] = new EntityReference("abs_department", f.Department)
        });
        f.Worker(f.Manager).Capture(campaign); f.Prepare();
        Check(f.Deliveries.Count == 1 && f.Deliveries[0].GetAttributeValue<EntityReference>("ownerid").Id == f.User.Id);
    }),
    ("daily reminders are due-checked and deduplicated per UTC day", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1);
        f.Worker(f.Admin).Work("remind-request", f.Request.Id.ToString(), null);
        Check(f.Events.Count == 0);
        f.Db.Row("abs_request", f.Request.Id)["modifiedon"] = DateTime.UtcNow.AddHours(-49);
        f.Worker(f.Admin).Work("remind-request", f.Request.Id.ToString(), null);
        f.Worker(f.Admin).Work("remind-request", f.Request.Id.ToString(), null);
        f.Prepare();
        Check(f.Events.Count == 1 && f.Deliveries.Count == 1);
    }),
    ("campaign reminders target participants, not the whole launch audience", () => {
        var f = new Fixture();
        f.Pref(f.User, 1); f.Pref(f.Other, 1);
        var campaign = f.Campaign(true);
        f.Db.Put(new Entity("abs_campaignparticipation", Guid.NewGuid()) { ["crd49_campaign"] = campaign.ToEntityReference(), ["crd49_champion"] = f.UserChampion.ToEntityReference() });
        f.Worker(f.Admin).Work("remind-campaign", campaign.Id.ToString(), null); f.Prepare();
        Check(f.Deliveries.Count == 1 && f.Deliveries[0].GetAttributeValue<EntityReference>("ownerid").Id == f.User.Id);
    }),
    ("HTML and card content are escaped and links use the canonical player", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 2);
        f.Db.Update(new Entity("abs_request", f.Request.Id) { ["abs_title"] = "<img src=x onerror=alert(1)> [click](https://evil.invalid)" });
        f.CaptureRequest(); f.Prepare();
        var payload = f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null);
        Check(payload.email!.Contains("&lt;img") && !payload.email.Contains("<img"));
        var card = Json.Read<TestCard>(payload.card!);
        Check(card.actions[0].url.Contains("&hubTarget=request&hubId="));
        Check(payload.recipient == f.Manager.GetAttributeValue<string>("internalemailaddress"));
    }),
    ("unconfirmed sends are never automatically resent", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        var id = f.Deliveries[0].Id;
        f.Worker(f.Admin).Work("begin", id.ToString(), null);
        f.Worker(f.Admin).Work("complete", id.ToString(), "uncertain");
        f.Prepare();
        Check((int)f.Deliveries[0]["abs_state"] == Worker.Uncertain);
        Check(!f.Worker(f.Admin).Work("begin", id.ToString(), null).send);
    }),
    ("interrupted sends become visibly unconfirmed instead of retrying", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        var id = f.Deliveries[0].Id;
        f.Worker(f.Admin).Work("begin", id.ToString(), null);
        f.Db.Row("abs_notificationdelivery", id)["modifiedon"] = DateTime.UtcNow.AddMinutes(-16);
        f.Prepare();
        Check((int)f.Deliveries[0]["abs_state"] == Worker.Uncertain);
    }),
    ("completion is idempotent and cannot overwrite a confirmed send", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        var id = f.Deliveries[0].Id;
        f.Worker(f.Admin).Work("begin", id.ToString(), null);
        f.Worker(f.Admin).Work("complete", id.ToString(), "sent");
        f.Worker(f.Admin).Work("complete", id.ToString(), "uncertain");
        Check((int)f.Deliveries[0]["abs_state"] == Worker.Sent);
    }),
    ("an optimistic-concurrency conflict cannot authorize a duplicate send", () => {
        var f = new Fixture();
        f.Pref(f.Manager, 1); f.CaptureRequest(); f.Prepare();
        f.Db.ConflictNext = true;
        Throws(() => f.Worker(f.Admin).Work("begin", f.Deliveries[0].Id.ToString(), null));
        Check((int)f.Deliveries[0]["abs_state"] == Worker.Pending);
    })
};
var failures = 0;
foreach (var item in cases)
{
    try { item.Run(); Console.WriteLine("PASS " + item.Name); }
    catch (Exception e) { failures++; Console.Error.WriteLine("FAIL " + item.Name + ": " + e); }
}
Console.WriteLine($"{cases.Length - failures}/{cases.Length} notification backend checks passed.");
return failures == 0 ? 0 : 1;

static void Check(bool condition) { if (!condition) throw new Exception("Assertion failed."); }
static void Throws(Action action)
{
    try { action(); } catch (InvalidPluginExecutionException) { return; }
    throw new Exception("Expected a visible failure.");
}

[DataContract]
internal sealed class TestCard
{
    [DataMember] public List<TestCardAction> actions = new();
}
[DataContract]
internal sealed class TestCardAction
{
    [DataMember] public string url = "";
}

public class ContextProxy : DispatchProxy
{
    public Dictionary<string, object?> Values = new();
    protected override object? Invoke(MethodInfo? method, object?[]? args)
    {
        var name = method!.Name;
        if (name.StartsWith("get_") && Values.TryGetValue(name.Substring(4), out var value)) return value;
        if (method.ReturnType == typeof(void)) return null;
        return method.ReturnType.IsValueType ? Activator.CreateInstance(method.ReturnType) : null;
    }
}

sealed class Fixture
{
    public readonly FakeService Db = new();
    public readonly Entity User, Manager, Admin, Other, UserChampion, ManagerChampion, Request;
    public readonly Guid Department = Guid.NewGuid();
    public List<Entity> Deliveries => Db.Rows.Where(e => e.LogicalName == "abs_notificationdelivery").ToList();
    public List<Entity> Events => Db.Rows.Where(e => e.LogicalName == "abs_notificationevent").ToList();
    public Fixture()
    {
        User = MakeUser("user"); Manager = MakeUser("manager"); Admin = MakeUser("admin"); Other = MakeUser("other");
        UserChampion = MakeChampion(User, false, Department);
        ManagerChampion = MakeChampion(Manager, true, Department);
        MakeChampion(Other, false, Guid.NewGuid());
        Db.Put(new Entity("abs_appadmin", Guid.NewGuid()) { ["abs_userid"] = Admin["domainname"] });
        Request = Db.Put(new Entity("abs_request", Guid.NewGuid()) {
            ["abs_title"] = "Test request", ["crd49_champion"] = UserChampion.ToEntityReference(), ["crd49_status"] = new OptionSetValue(839560000)
        });
        Db.Put(new Entity("environmentvariabledefinition", Guid.NewGuid()) {
            ["schemaname"] = "abs_NotificationAppUrl", ["defaultvalue"] = "https://apps.powerapps.com/play/e/test/app/test?tenantId=test"
        });
    }
    public Entity MakeUser(string name) => Db.Put(new Entity("systemuser", Guid.NewGuid()) {
        ["domainname"] = name + "@example.test", ["internalemailaddress"] = name + "@mail.example.test",
        ["fullname"] = name, ["azureactivedirectoryobjectid"] = Guid.NewGuid(), ["isdisabled"] = false
    });
    private Entity MakeChampion(Entity user, bool manager, Guid department) => Db.Put(new Entity("abs_champion", Guid.NewGuid()) {
        ["abs_userid"] = user["domainname"], ["crd49_role"] = new OptionSetValue(manager ? 839560001 : 839560000),
        ["crd49_status"] = new OptionSetValue(839560001), ["crd49_department"] = new EntityReference("abs_department", department)
    });
    public void Pref(Entity user, int channel) => Db.Put(new Entity("abs_notificationpreference", user.Id) {
        ["ownerid"] = user.ToEntityReference(), ["abs_entraobjectid"] = user.GetAttributeValue<Guid>("azureactivedirectoryobjectid").ToString(),
        ["abs_paused"] = false, ["abs_requests"] = channel, ["abs_claims"] = channel, ["abs_campaigns"] = channel, ["abs_reminders"] = channel
    });
    public Worker Worker(Entity actor, string message = "Create", Entity? before = null)
    {
        var context = DispatchProxy.Create<IPluginExecutionContext, ContextProxy>();
        var values = ((ContextProxy)(object)context).Values;
        values["InitiatingUserId"] = actor.Id; values["MessageName"] = message;
        values["SharedVariables"] = new ParameterCollection();
        var images = new EntityImageCollection();
        if (before != null) images.Add("Before", before);
        values["PreEntityImages"] = images;
        return new Worker(Db, context, new FakeTrace());
    }
    public void CaptureRequest() => Worker(User).Capture(Request);
    public void Prepare() => Worker(Admin).Work("prepare", null, null);
    public void Reply(Entity actor, string text, Guid? id = null, int? status = null)
    {
        var worker = Worker(actor, "Update");
        var target = new Entity("abs_request", Request.Id) { ["abs_replycommand"] = Json.Write(new ReplyCommand { id = (id ?? Guid.NewGuid()).ToString(), text = text }) };
        if (status.HasValue) target["crd49_status"] = new OptionSetValue(status.Value);
        worker.Reply(target); Db.Update(target); worker.Capture(target);
    }
    public Entity Claim(int status) => Db.Put(new Entity("abs_activityclaim", Guid.NewGuid()) {
        ["abs_name"] = "Claim", ["crd49_champion"] = UserChampion.ToEntityReference(), ["crd49_status"] = new OptionSetValue(status)
    });
    public Entity Campaign(bool ready) => Db.Put(new Entity("abs_campaign", Guid.NewGuid()) {
        ["abs_name"] = "Campaign", ["crd49_status"] = new OptionSetValue(839560001),
        ["abs_notificationready"] = ready, ["crd49_enddate"] = DateTime.UtcNow.AddDays(3)
    });
}

sealed class FakeTrace : ITracingService { public void Trace(string format, params object[] args) { } }
sealed class FakeService : IOrganizationService
{
    private readonly Dictionary<(string, Guid), Entity> data = new();
    private long version = 1;
    public bool ConflictNext;
    public IEnumerable<Entity> Rows => data.Values;
    public Entity Row(string table, Guid id) => data[(table, id)];
    public Entity Put(Entity input)
    {
        var row = Clone(input);
        if (!row.Contains("statecode")) row["statecode"] = new OptionSetValue(0);
        if (!row.Contains("createdon")) row["createdon"] = DateTime.UtcNow;
        row["modifiedon"] = DateTime.UtcNow;
        row[row.LogicalName + "id"] = row.Id;
        row["versionnumber"] = version++;
        row.RowVersion = row["versionnumber"].ToString();
        data[(row.LogicalName, row.Id)] = row;
        return Clone(row);
    }
    public Guid Create(Entity entity)
    {
        if (entity.Id == Guid.Empty) entity.Id = Guid.NewGuid();
        if (data.ContainsKey((entity.LogicalName, entity.Id))) throw new InvalidPluginExecutionException("Duplicate record.");
        return Put(entity).Id;
    }
    public void Update(Entity entity)
    {
        var current = Clone(Row(entity.LogicalName, entity.Id));
        foreach (var attribute in entity.Attributes) current[attribute.Key] = attribute.Value;
        Put(current);
    }
    public OrganizationResponse Execute(OrganizationRequest request)
    {
        if (request is not UpdateRequest update) throw new NotSupportedException(request.RequestName);
        var current = Row(update.Target.LogicalName, update.Target.Id);
        if (update.ConcurrencyBehavior != ConcurrencyBehavior.IfRowVersionMatches) throw new Exception("Missing concurrency protection.");
        if (ConflictNext || current.RowVersion != update.Target.RowVersion) {
            ConflictNext = false;
            throw new InvalidPluginExecutionException("Version mismatch.");
        }
        Update(update.Target);
        return new UpdateResponse();
    }
    public Entity Retrieve(string entityName, Guid id, ColumnSet columnSet) => Clone(Row(entityName, id));
    public EntityCollection RetrieveMultiple(QueryBase queryBase)
    {
        var query = (QueryExpression)queryBase;
        var rows = Rows.Where(r => r.LogicalName == query.EntityName && Match(r, query.Criteria)).ToList();
        foreach (var order in query.Orders.Reverse())
            rows = order.OrderType == OrderType.Ascending ? rows.OrderBy(r => Value(r, order.AttributeName)).ToList() : rows.OrderByDescending(r => Value(r, order.AttributeName)).ToList();
        if (query.TopCount.HasValue) rows = rows.Take(query.TopCount.Value).ToList();
        var offset = int.TryParse(query.PageInfo.PagingCookie, out var saved) ? saved : 0;
        var count = query.PageInfo.Count == 0 ? rows.Count : query.PageInfo.Count;
        var page = new EntityCollection(rows.Skip(offset).Take(count).Select(Clone).ToList()) {
            MoreRecords = offset + count < rows.Count, PagingCookie = (offset + count).ToString()
        };
        return page;
    }
    private static bool Match(Entity row, FilterExpression filter)
    {
        var matches = filter.Conditions.Select(condition => {
            var left = Value(row, condition.AttributeName);
            var right = Normalize(condition.Values[0]);
            var equal = Equals(left, right) || left is string a && right is string b && a.Equals(b, StringComparison.OrdinalIgnoreCase);
            return condition.Operator switch {
                ConditionOperator.Equal => equal,
                ConditionOperator.NotEqual => !equal,
                ConditionOperator.GreaterThan => left is IComparable gt && gt.CompareTo(right) > 0,
                ConditionOperator.LessThan => left is IComparable lt && lt.CompareTo(right) < 0,
                _ => throw new NotSupportedException(condition.Operator.ToString())
            };
        }).Concat(filter.Filters.Select(child => Match(row, child)));
        return filter.FilterOperator == LogicalOperator.And ? matches.All(v => v) : matches.Any(v => v);
    }
    private static object? Value(Entity row, string name) => row.Contains(name) ? Normalize(row[name]) : null;
    private static object? Normalize(object? value) => value is EntityReference reference ? reference.Id : value is OptionSetValue choice ? choice.Value : value;
    private static Entity Clone(Entity source)
    {
        var copy = new Entity(source.LogicalName, source.Id) { RowVersion = source.RowVersion };
        foreach (var item in source.Attributes) copy[item.Key] = item.Value;
        return copy;
    }
    public void Delete(string entityName, Guid id) => data.Remove((entityName, id));
    public void Associate(string entityName, Guid entityId, Relationship relationship, EntityReferenceCollection relatedEntities) => throw new NotSupportedException();
    public void Disassociate(string entityName, Guid entityId, Relationship relationship, EntityReferenceCollection relatedEntities) => throw new NotSupportedException();
}
