using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using Microsoft.Xrm.Sdk;

namespace Hub.Notifications
{
    [DataContract]
    internal sealed class TemplateConfiguration
    {
        [DataMember(IsRequired = true)] public int version;
        [DataMember(IsRequired = true)] public List<NotificationTemplate>? templates;
    }
    [DataContract]
    internal sealed class NotificationTemplate
    {
        [DataMember(IsRequired = true)] public string? kind;
        [DataMember(IsRequired = true)] public string? heading;
        [DataMember(IsRequired = true)] public string? subject;
        [DataMember(IsRequired = true)] public string? message;
        [DataMember(IsRequired = true)] public string? actionLabel;
        [DataMember(IsRequired = true)] public List<string>? fields;
        [DataMember(IsRequired = true)] public bool includeMeetingLink;
    }
    [DataContract]
    internal sealed class TemplateCommand
    {
        [DataMember(IsRequired = true)] public string? expected { get; set; }
        [DataMember(IsRequired = true)] public string? configuration { get; set; }
    }
    internal static class NotificationContent
    {
        internal static readonly Dictionary<string, string> Kinds = new Dictionary<string, string>
        {
            ["request.created"] = "New request", ["request.reply.admin"] = "Reply to your request",
            ["request.reply.user"] = "Requester reply", ["request.status"] = "Request status changed",
            ["claim.created"] = "New activity claim", ["claim.approved"] = "Claim approved",
            ["claim.rejected"] = "Claim rejected", ["campaign.launched"] = "Campaign launched",
            ["remind-request"] = "Request reminder", ["remind-claim"] = "Claim reminder",
            ["remind-campaign"] = "Campaign reminder", ["remind-event"] = "Upcoming event"
        };
        internal static readonly Dictionary<string, string> Labels = new Dictionary<string, string>
        {
            ["Requester"] = "Requester", ["Category"] = "Category", ["Status"] = "Status",
            ["Description"] = "Description excerpt", ["Reply"] = "Reply excerpt", ["Activity"] = "Activity",
            ["Claimant"] = "Claimant", ["Points"] = "Activity points", ["Campaign"] = "Campaign",
            ["CampaignStart"] = "Campaign start (UTC)", ["CampaignEnd"] = "Campaign end (UTC)",
            ["EventStart"] = "Start (UTC)", ["EventEnd"] = "End (UTC)", ["Location"] = "Location", ["Format"] = "Format"
        };
        internal static string[] Fields(string kind)
        {
            if (kind.StartsWith("request.", StringComparison.Ordinal) || kind == "remind-request")
                return new[] { "Requester", "Category", "Status", "Description" }
                    .Concat(kind.StartsWith("request.reply.", StringComparison.Ordinal) ? new[] { "Reply" } : new string[0]).ToArray();
            if (kind.StartsWith("claim.", StringComparison.Ordinal) || kind == "remind-claim")
                return new[] { "Activity", "Claimant", "Campaign", "Points", "Status" };
            if (kind == "remind-event") return new[] { "EventStart", "EventEnd", "Location", "Format", "Campaign", "Description" };
            return new[] { "CampaignStart", "CampaignEnd", "Description" };
        }
        internal static NotificationTemplate Default(string kind)
        {
            if (!Kinds.ContainsKey(kind)) throw new InvalidPluginExecutionException("Unknown notification type.");
            return new NotificationTemplate
            {
                kind = kind, heading = Kinds[kind], subject = "AI Champions Hub: {Title}", message = "{Summary}",
                actionLabel = kind == "remind-event" ? "View event" :
                    kind.StartsWith("request.", StringComparison.Ordinal) || kind == "remind-request" ? "View request" :
                    kind.StartsWith("claim.", StringComparison.Ordinal) || kind == "remind-claim" ? "View claim" : "View campaign",
                fields = Fields(kind).Where(field => field != "Description" && field != "Reply").ToList(),
                includeMeetingLink = false
            };
        }
        internal static TemplateConfiguration Read(string? raw)
        {
            if (raw == null || raw == "") return new TemplateConfiguration { version = 1, templates = new List<NotificationTemplate>() };
            if (raw.Length > 50000) throw new InvalidPluginExecutionException("Template configuration exceeds 50000 characters.");
            var root = ReadObject(raw);
            Shape(root, new Dictionary<string, string> { ["version"] = "number", ["templates"] = "array" });
            foreach (var node in root["templates"]!.ChildNodes.OfType<XmlElement>()) ValidateShape(node);
            var config = Json.Read<TemplateConfiguration>(raw);
            if (config == null || config.version != 1 || config.templates == null || config.templates.Count > Kinds.Count)
                throw new InvalidPluginExecutionException("Unsupported template configuration.");
            var kinds = new HashSet<string>();
            foreach (var template in config.templates)
            {
                Validate(template);
                if (!kinds.Add(template.kind!)) throw new InvalidPluginExecutionException("Duplicate notification templates.");
            }
            return config;
        }
        internal static void Validate(NotificationTemplate template)
        {
            if (template == null || template.kind == null || !Kinds.ContainsKey(template.kind))
                throw new InvalidPluginExecutionException("Unknown notification type or property.");
            var fields = Fields(template.kind);
            if (template.fields == null || template.fields.Any(field => field == null || !fields.Contains(field)) ||
                template.fields.Distinct().Count() != template.fields.Count)
                throw new InvalidPluginExecutionException("Invalid or duplicate template detail fields.");
            if (template.includeMeetingLink && template.kind != "remind-event")
                throw new InvalidPluginExecutionException("Join meeting is supported only for event reminders.");
            ValidateText(template.heading, 120, false, fields, template.fields);
            ValidateText(template.subject, 200, false, fields, template.fields);
            ValidateText(template.message, 1200, true, fields, template.fields);
            ValidateText(template.actionLabel, 40, false, fields, template.fields);
        }
        private static XmlElement ReadObject(string raw)
        {
            try
            {
                using (var stream = new MemoryStream(Encoding.UTF8.GetBytes(raw)))
                using (var reader = JsonReaderWriterFactory.CreateJsonReader(stream, XmlDictionaryReaderQuotas.Max))
                {
                    var document = new XmlDocument { XmlResolver = null };
                    document.Load(reader);
                    var root = document.DocumentElement;
                    if (root == null || root.GetAttribute("type") != "object")
                        throw new InvalidPluginExecutionException("Template JSON must be an object.");
                    return root;
                }
            }
            catch (XmlException) { throw new InvalidPluginExecutionException("Template JSON is malformed."); }
        }
        private static void Shape(XmlElement node, Dictionary<string, string> expected)
        {
            var children = node.ChildNodes.OfType<XmlElement>().ToArray();
            if (node.GetAttribute("type") != "object" || children.Length != expected.Count ||
                children.Select(child => child.Name).Distinct().Count() != children.Length ||
                children.Any(child => !expected.TryGetValue(child.Name, out var type) || !type.Split('|').Contains(child.GetAttribute("type"))))
                throw new InvalidPluginExecutionException("Template JSON has missing, duplicate, unknown, or incorrectly typed properties.");
        }
        private static void ValidateShape(XmlElement node)
        {
            Shape(node, new Dictionary<string, string>
            {
                ["kind"] = "string", ["heading"] = "string", ["subject"] = "string", ["message"] = "string",
                ["actionLabel"] = "string", ["fields"] = "array", ["includeMeetingLink"] = "boolean"
            });
            if (node["fields"]!.ChildNodes.OfType<XmlElement>().Any(field => field.GetAttribute("type") != "string"))
                throw new InvalidPluginExecutionException("Template fields must be strings.");
        }
        internal static TemplateCommand ReadCommand(string raw)
        {
            Shape(ReadObject(raw), new Dictionary<string, string> { ["expected"] = "string|null", ["configuration"] = "string" });
            return Json.Read<TemplateCommand>(raw);
        }
        private static void ValidateText(string? text, int max, bool multiline, string[] fields, List<string> selected)
        {
            if (string.IsNullOrWhiteSpace(text) || text!.Length > max ||
                Regex.IsMatch(text, @"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]") || !multiline && (text.Contains("\r") || text.Contains("\n")))
                throw new InvalidPluginExecutionException("Template text is empty, too long, or contains unsupported control characters.");
            var remainder = Regex.Replace(text, @"\{([A-Za-z]+)\}", match =>
            {
                var token = match.Groups[1].Value;
                if (token != "Title" && token != "Summary" && !fields.Contains(token))
                    throw new InvalidPluginExecutionException("Unsupported template placeholder {" + token + "}.");
                if ((token == "Description" || token == "Reply") && !selected.Contains(token))
                    throw new InvalidPluginExecutionException("Select the excerpt field before using its placeholder.");
                return "";
            });
            if (remainder.Contains("{") || remainder.Contains("}")) throw new InvalidPluginExecutionException("Malformed template placeholder.");
        }
        internal static string Clip(string? value, int max = 500)
        {
            var text = Regex.Replace(value ?? "", @"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]", "");
            return text.Length > max ? text.Substring(0, max - 3) + "..." : text;
        }
        internal static string Expand(string text, Dictionary<string, string> values) =>
            Regex.Replace(text, @"\{([A-Za-z]+)\}", match => values.TryGetValue(match.Groups[1].Value, out var value) ? value : "");
        internal static string Date(Entity source, string attribute)
        {
            var value = source.GetAttributeValue<DateTime>(attribute);
            if (value == default(DateTime)) return "";
            // Dataverse SDK datetime values are UTC even when their Kind is Unspecified.
            var utc = value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : value;
            return utc.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " UTC";
        }
        private static string Markdown(string text) => Regex.Replace(text, @"([\\*_{}\[\]()<>#`!|])", @"\$1");
        private static string Block(string text, bool bold = false, string size = "Default") =>
            "{\"type\":\"TextBlock\",\"text\":" + Json.Write(Markdown(text)) + ",\"wrap\":true" +
            (bold ? ",\"weight\":\"Bolder\"" : "") + ",\"size\":" + Json.Write(size) + "}";
        private static string Button(string label, string url) =>
            "{\"type\":\"Action.OpenUrl\",\"title\":" + Json.Write(label) + ",\"url\":" + Json.Write(url) + "}";
        internal static WorkResult Render(NotificationTemplate template, Dictionary<string, string> values, string url, string? meeting)
        {
            Validate(template);
            var heading = Clip(Expand(template.heading!, values), 160);
            var message = Clip(Expand(template.message!, values), 2400);
            var label = Clip(Expand(template.actionLabel!, values), 60);
            var subject = Clip(Expand(template.subject!, values), 240).Replace("\r", " ").Replace("\n", " ");
            if (string.IsNullOrWhiteSpace(heading) || string.IsNullOrWhiteSpace(message) || string.IsNullOrWhiteSpace(label) || string.IsNullOrWhiteSpace(subject))
                throw new InvalidPluginExecutionException("A template rendered empty required text. Use literal wording or populated placeholders.");
            var body = new List<string> { Block("AI Champions Hub", true, "Small"), Block(heading, true, "Large"), Block(values["Title"], true, "Medium"), Block(message) };
            var selected = template.fields!.Where(field => values.TryGetValue(field, out var value) && !string.IsNullOrWhiteSpace(value)).ToArray();
            var facts = selected.Where(field => field != "Description" && field != "Reply").Select(field =>
                "{\"title\":" + Json.Write(Markdown(Labels[field])) + ",\"value\":" + Json.Write(Markdown(values[field])) + "}").ToArray();
            if (facts.Length > 0) body.Add("{\"type\":\"FactSet\",\"separator\":true,\"spacing\":\"Medium\",\"facts\":[" + string.Join(",", facts) + "]}");
            foreach (var field in selected.Where(field => field == "Description" || field == "Reply"))
            {
                body.Add(Block(Labels[field], true)); body.Add(Block(values[field]));
            }
            var actions = new List<string> { Button(label, url) };
            var validMeeting = template.includeMeetingLink && Uri.TryCreate(meeting, UriKind.Absolute, out var uri) &&
                uri.Scheme == "https" && uri.UserInfo.Length == 0;
            if (validMeeting) actions.Add(Button("Join meeting", meeting!));
            var html = "<div style=\"font-family:Segoe UI,Arial,sans-serif;max-width:640px;padding:20px;border:1px solid #ddd;border-radius:8px\">" +
                "<p>AI Champions Hub</p><h2>" + WebUtility.HtmlEncode(heading) + "</h2><h3>" + WebUtility.HtmlEncode(values["Title"]) +
                "</h3><p style=\"white-space:pre-wrap\">" + WebUtility.HtmlEncode(message) + "</p><table role=\"presentation\" style=\"border-collapse:collapse;width:100%\">";
            foreach (var field in selected)
                html += "<tr><th scope=\"row\" style=\"text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #eee\">" +
                    WebUtility.HtmlEncode(Labels[field]) + "</th><td style=\"padding:8px;white-space:pre-wrap;border-bottom:1px solid #eee\">" +
                    WebUtility.HtmlEncode(values[field]) + "</td></tr>";
            html += "</table><p><a href=\"" + WebUtility.HtmlEncode(url) + "\">" + WebUtility.HtmlEncode(label) + "</a></p>";
            if (validMeeting) html += "<p><a href=\"" + WebUtility.HtmlEncode(meeting) + "\">Join meeting</a></p>";
            html += "<p>You can change notification preferences in the Hub.</p></div>";
            return new WorkResult
            {
                subject = subject, email = html,
                card = "{\"$schema\":\"http://adaptivecards.io/schemas/adaptive-card.json\",\"type\":\"AdaptiveCard\",\"version\":\"1.4\",\"body\":[" +
                    string.Join(",", body) + "],\"actions\":[" + string.Join(",", actions) + "]}"
            };
        }
    }
}
