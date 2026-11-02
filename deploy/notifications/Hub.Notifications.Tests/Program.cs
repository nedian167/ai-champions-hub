using System.Reflection;
using System.Runtime.Serialization;
using Hub.Notifications;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;

var cases = new (string Name, Action Run)[]
{
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
