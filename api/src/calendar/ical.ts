import ICAL from "ical.js";
import {
  fromWall,
  wallTime,
  parseRecurrenceRule,
  generateOccurrences,
} from "./recurrence";
import { createHash } from "node:crypto";

type ExportEvent = {
  recurrenceTimezone?: string | null;
  id: string;
  externalUid: string | null;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
  notes: string | null;
  recurrenceRule: string | null;
  excludedDates: string[];
};
export function importCalendar(source: string, timezone: string) {
  const root = new ICAL.Component(ICAL.parse(source));
  if (root.name !== "vcalendar")
    throw new Error("Dit is geen iCalendar-bestand.");
  const components = root.getAllSubcomponents("vevent");
  if (components.length > 1000)
    throw new Error("Importeer maximaal 1000 afspraken tegelijk.");
  const uid = (component: ICAL.Component) =>
    String(
      component.getFirstPropertyValue("uid") ||
        createHash("sha256").update(component.toString()).digest("hex"),
    );
  const convertTime = (time: ICAL.Time, zone: string) => {
    if (time.zone?.tzid === "UTC") return time.toJSDate();
    return fromWall(
      new Date(
        Date.UTC(
          time.year,
          time.month - 1,
          time.day,
          time.hour,
          time.minute,
          time.second,
        ),
      ),
      zone,
    );
  };
  const convert = (component: ICAL.Component, property: string) => {
    const prop = component.getFirstProperty(property);
    const time = prop?.getFirstValue() as ICAL.Time | undefined;
    if (!time) throw new Error("Een afspraak mist een datum.");
    return convertTime(time, String(prop?.getParameter("tzid") || timezone));
  };
  const read = (component: ICAL.Component) => {
    if (component.getAllProperties("rrule").length > 1)
      throw new Error(
        "Meerdere herhalingsregels per afspraak worden niet ondersteund.",
      );
    const start = convert(component, "dtstart");
    const startValue = component.getFirstPropertyValue("dtstart") as ICAL.Time;
    const sourceZone = String(
      component.getFirstProperty("dtstart")?.getParameter("tzid") || timezone,
    );
    const recurrenceTimezone =
      startValue.zone?.tzid === "UTC" ? "UTC" : sourceZone;
    const duration = component.getFirstPropertyValue("duration") as
      ICAL.Duration | undefined;
    const nextDay = new Date(
      Date.UTC(startValue.year, startValue.month - 1, startValue.day + 1),
    );
    const end = component.hasProperty("dtend")
      ? convert(component, "dtend")
      : duration
        ? new Date(+start + duration.toSeconds() * 1000)
        : startValue.isDate
          ? fromWall(nextDay, sourceZone)
          : new Date(+start + 3600000);
    const recurrenceRule =
      component.getFirstPropertyValue("rrule")?.toString() || null;
    parseRecurrenceRule(recurrenceRule);
    const excludedDates = component
      .getAllProperties("exdate")
      .flatMap((property) =>
        property
          .getValues()
          .map((value) =>
            convertTime(
              value as ICAL.Time,
              String(property.getParameter("tzid") || timezone),
            ).toISOString(),
          ),
      );
    if (
      !Number.isFinite(+start) ||
      !Number.isFinite(+end) ||
      end <= start ||
      start.getUTCFullYear() < 1900 ||
      start.getUTCFullYear() > 2200
    )
      throw new Error("Ongeldige begin- of einddatum.");
    return {
      externalUid: uid(component),
      title: String(
        component.getFirstPropertyValue("summary") || "Zonder titel",
      ).slice(0, 200),
      start,
      end,
      recurrenceRule,
      recurrenceTimezone,
      excludedDates,
      location:
        String(component.getFirstPropertyValue("location") || "") || null,
      notes:
        String(component.getFirstPropertyValue("description") || "") || null,
    };
  };
  const masters = components.filter(
    (component) =>
      !component.hasProperty("recurrence-id") &&
      component.getFirstPropertyValue("status") !== "CANCELLED",
  );
  const result = masters.map(read);
  for (const component of components.filter((component) =>
    component.hasProperty("recurrence-id"),
  )) {
    if (component.getFirstProperty("recurrence-id")?.getParameter("range"))
      throw new Error(
        "Reekswijzigingen met THISANDFUTURE worden niet ondersteund.",
      );
    const master = result.find((event) => event.externalUid === uid(component));
    const original = convert(component, "recurrence-id").toISOString();
    if (master) master.excludedDates.push(original);
    if (component.getFirstPropertyValue("status") !== "CANCELLED")
      result.push({
        ...read(component),
        externalUid: uid(component) + "#" + original,
        recurrenceRule: null,
      });
  }
  for (const component of masters) {
    const master = result.find(
      (event) => event.externalUid === uid(component),
    )!;
    for (const property of component.getAllProperties("rdate")) {
      for (const value of property.getValues()) {
        if (!(value instanceof ICAL.Time))
          throw new Error("RDATE-periodes worden niet ondersteund.");
        const start = convertTime(
          value,
          String(property.getParameter("tzid") || timezone),
        );
        if (
          +start === +master.start ||
          master.excludedDates.includes(start.toISOString())
        )
          continue;
        if (
          master.recurrenceRule &&
          generateOccurrences(
            master.start,
            master.end,
            master.recurrenceRule,
            start,
            new Date(+start + 1),
            master.recurrenceTimezone,
          ).some((value) => +value.start === +start)
        )
          continue;
        result.push({
          ...master,
          externalUid: master.externalUid + "#rdate#" + start.toISOString(),
          start,
          end: new Date(+start + (+master.end - +master.start)),
          recurrenceRule: null,
          excludedDates: [],
        });
      }
    }
  }
  if (result.length > 1000)
    throw new Error("Importeer maximaal 1000 afspraken tegelijk.");
  return result;
}
const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const escape = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
function fold(line: string) {
  const lines: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char) > 73) {
      lines.push(current);
      current = " " + char;
    } else current += char;
  }
  return [...lines, current].join("\r\n");
}
export function exportCalendar(events: ExportEvent[], timezone: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zenda//Familieagenda//NL",
    "CALSCALE:GREGORIAN",
    `X-WR-TIMEZONE:${timezone}`,
  ];
  for (const event of events) {
    const eventZone = event.recurrenceTimezone || timezone;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escape(event.externalUid || event.id + "@zenda")}`,
      `DTSTAMP:${stamp(new Date())}`,
      `SUMMARY:${escape(event.title)}`,
    );
    if (event.recurrenceRule)
      lines.push(
        `DTSTART;TZID=${eventZone}:${stamp(wallTime(event.start, eventZone)).replace(/Z$/, "")}`,
        `DTEND;TZID=${eventZone}:${stamp(wallTime(event.end, eventZone)).replace(/Z$/, "")}`,
        `RRULE:${event.recurrenceRule}`,
      );
    else
      lines.push(`DTSTART:${stamp(event.start)}`, `DTEND:${stamp(event.end)}`);
    if (event.location) lines.push(`LOCATION:${escape(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escape(event.notes)}`);
    if (event.excludedDates.length)
      lines.push(
        `EXDATE:${event.excludedDates.map((x) => stamp(new Date(x))).join(",")}`,
      );
    lines.push("END:VEVENT");
  }
  return [...lines, "END:VCALENDAR", ""].map(fold).join("\r\n");
}
