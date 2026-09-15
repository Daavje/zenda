import ICAL from "ical.js";
import { fromWall, wallTime, parseRecurrenceRule } from "./recurrence";
import { createHash } from "node:crypto";

type ExportEvent = { recurrenceTimezone?: string | null; id: string; externalUid: string | null; title: string; start: Date; end: Date; location: string | null; notes: string | null; recurrenceRule: string | null; excludedDates: string[] };
export function importCalendar(source: string, timezone: string) {
  const root = new ICAL.Component(ICAL.parse(source));
  if (root.name !== "vcalendar") throw new Error("Dit is geen iCalendar-bestand.");
  const components = root.getAllSubcomponents("vevent");
  if (components.length > 1000) throw new Error("Importeer maximaal 1000 afspraken tegelijk.");
  const convert = (component: ICAL.Component, property: string) => {
    const prop = component.getFirstProperty(property);
    const time = prop?.getFirstValue() as ICAL.Time | undefined;
    if (!time) throw new Error("Een afspraak mist een datum.");
    if (time.zone?.tzid === "UTC") return time.toJSDate();
    const zone = String(prop?.getParameter("tzid") || timezone);
    return fromWall(new Date(Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)), zone);
  };
  return components.map(component => {
    // Refuse unsupported exceptions instead of silently importing incorrect series.
    if (component.hasProperty("recurrence-id") || component.hasProperty("rdate")) throw new Error("Dit bestand bevat gewijzigde voorkomens of RDATE. Exporteer deze afspraken afzonderlijk.");
    const start = convert(component, "dtstart");
    const end = component.hasProperty("dtend") ? convert(component, "dtend") : new Date(+start + (new ICAL.Event(component).duration.toSeconds() || 86400) * 1000);
    const recurrenceRule = component.getFirstPropertyValue("rrule")?.toString() || null;
    parseRecurrenceRule(recurrenceRule);
    const sourceZone = component.getFirstProperty("dtstart")?.getParameter("tzid");
    const startValue = component.getFirstPropertyValue("dtstart") as ICAL.Time;
    const recurrenceTimezone = startValue.zone?.tzid === "UTC" ? "UTC" : String(sourceZone || timezone);
    const excludedDates = component.getAllProperties("exdate").flatMap(property => property.getValues().map(value => {
      const time = value as ICAL.Time;
      return time.zone?.tzid === "UTC" ? time.toJSDate().toISOString() : fromWall(new Date(Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)), String(property.getParameter("tzid") || timezone)).toISOString();
    }));
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) throw new Error("Ongeldige begin- of einddatum.");
    return { externalUid: String(component.getFirstPropertyValue("uid") || createHash("sha256").update(component.toString()).digest("hex")), title: String(component.getFirstPropertyValue("summary") || "Zonder titel").slice(0, 200), start, end, recurrenceRule, recurrenceTimezone, excludedDates, location: String(component.getFirstPropertyValue("location") || "") || null, notes: String(component.getFirstPropertyValue("description") || "") || null };
  });
}
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
function fold(line: string) {
  const lines: string[] = []; let current = "";
  for (const char of line) { if (Buffer.byteLength(current + char) > 73) { lines.push(current); current = " " + char; } else current += char; }
  return [...lines, current].join("\r\n");
}
export function exportCalendar(events: ExportEvent[], timezone: string) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Zenda//Familieagenda//NL", "CALSCALE:GREGORIAN", `X-WR-TIMEZONE:${timezone}`];
  for (const event of events) {
    const eventZone = event.recurrenceTimezone || timezone;
    lines.push("BEGIN:VEVENT", `UID:${escape(event.externalUid || event.id + "@zenda")}`, `DTSTAMP:${stamp(new Date())}`, `SUMMARY:${escape(event.title)}`);
    if (event.recurrenceRule) lines.push(`DTSTART;TZID=${eventZone}:${stamp(wallTime(event.start, eventZone)).replace(/Z$/, "")}`, `DTEND;TZID=${eventZone}:${stamp(wallTime(event.end, eventZone)).replace(/Z$/, "")}`, `RRULE:${event.recurrenceRule}`);
    else lines.push(`DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.end)}`);
    if (event.location) lines.push(`LOCATION:${escape(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escape(event.notes)}`);
    if (event.excludedDates.length) lines.push(`EXDATE:${event.excludedDates.map(x => stamp(new Date(x))).join(",")}`);
    lines.push("END:VEVENT");
  }
  return [...lines, "END:VCALENDAR", ""].map(fold).join("\r\n");
}
