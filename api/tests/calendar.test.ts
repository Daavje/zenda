import test from "node:test";
import assert from "node:assert/strict";
import {
  generateOccurrences,
  parseRecurrenceRule,
  fromWall,
} from "../src/calendar/recurrence";
import { importCalendar, exportCalendar } from "../src/calendar/ical";
import { isPublicAddress, fetchCalendar } from "../src/calendar/remote-fetch";
const d = (value: string) => new Date(value);
test("weekly recurrence preserves local time across DST", () => {
  const events = generateOccurrences(
    d("2026-10-19T08:00Z"),
    d("2026-10-19T09:00Z"),
    "FREQ=WEEKLY;COUNT=3",
    d("2026-10-01Z"),
    d("2026-11-10Z"),
  );
  assert.deepEqual(
    events.map((x) => x.start.toISOString()),
    [
      "2026-10-19T08:00:00.000Z",
      "2026-10-26T09:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ],
  );
});
test("month-end skips impossible dates without drifting", () => {
  const events = generateOccurrences(
    d("2026-01-31T09:00Z"),
    d("2026-01-31T10:00Z"),
    "FREQ=MONTHLY;COUNT=3",
    d("2026-01-01Z"),
    d("2026-06-01Z"),
  );
  assert.deepEqual(
    events.map((x) => x.start.getUTCMonth()),
    [0, 2, 4],
  );
  assert.ok(events.every((x) => x.start.getUTCDate() === 31));
});
test("leap-day repeats only in leap years", () => {
  const events = generateOccurrences(
    d("2024-02-29T09:00Z"),
    d("2024-02-29T10:00Z"),
    "FREQ=YEARLY;COUNT=2",
    d("2024-01-01Z"),
    d("2029-01-01Z"),
  );
  assert.deepEqual(
    events.map((x) => x.start.getUTCFullYear()),
    [2024, 2028],
  );
});
test("overlap and exclusions use start-inclusive end-exclusive range", () => {
  const start = d("2026-09-16T08:00Z"),
    end = d("2026-09-16T10:00Z");
  assert.equal(
    generateOccurrences(
      start,
      end,
      "FREQ=DAILY;COUNT=1",
      d("2026-09-16T09:00Z"),
      d("2026-09-16T09:30Z"),
    ).length,
    1,
  );
  assert.equal(
    generateOccurrences(start, end, null, end, d("2026-09-17T00:00Z")).length,
    0,
  );
  assert.equal(
    generateOccurrences(
      start,
      end,
      "FREQ=DAILY",
      start,
      end,
      "Europe/Amsterdam",
      [start.toISOString()],
    ).length,
    0,
  );
});
test("BYDAY and UNTIL are applied", () => {
  const events = generateOccurrences(
    d("2026-09-14T08:00Z"),
    d("2026-09-14T09:00Z"),
    "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260921T080000Z",
    d("2026-09-01Z"),
    d("2026-10-01Z"),
  );
  assert.deepEqual(
    events.map((x) => x.start.getUTCDate()),
    [14, 16, 21],
  );
});
test("invalid or unbounded high-frequency rules are refused", () => {
  for (const rule of [
    "FREQ=MINUTELY",
    "FREQ=DAILY;INTERVAL=0",
    "FREQ=DAILY;COUNT=-2",
    "FREQ=DAILY;BYSECOND=1,2,3",
    "FREQ=DAILY;COUNT=2;UNTIL=20260921T080000Z",
  ])
    assert.throws(() => parseRecurrenceRule(rule));
});
test("ICS import/export preserves text, UTC recurrence and exclusions", () => {
  const event = {
    id: "test",
    externalUid: null,
    title: "Gezin, samen; test",
    start: d("2026-09-16T08:00Z"),
    end: d("2026-09-16T09:00Z"),
    location: "Thuis",
    notes: "Eerste regel\nTweede regel",
    recurrenceRule: "FREQ=WEEKLY;COUNT=3",
    recurrenceTimezone: "UTC",
    excludedDates: ["2026-09-23T08:00:00.000Z"],
  };
  const imported = importCalendar(
    exportCalendar([event], "Europe/Amsterdam"),
    "Europe/Amsterdam",
  )[0]!;
  assert.equal(imported.title, event.title);
  assert.equal(imported.notes, event.notes);
  assert.equal(+imported.start, +event.start);
  assert.equal(imported.recurrenceTimezone, "UTC");
  assert.deepEqual(imported.excludedDates, event.excludedDates);
});
test("calendar feed URLs cannot access local or private addresses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "169.254.169.254",
    "172.16.0.1",
    "100.64.0.1",
    "::1",
    "0.0.0.0",
  ])
    assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  await assert.rejects(fetchCalendar("https://127.0.0.1/private"));
  await assert.rejects(fetchCalendar("http://example.com/calendar.ics"));
});
test("timezone conversion is independent of server timezone", () => {
  assert.equal(
    fromWall(d("2026-07-01T10:00Z"), "Europe/Amsterdam").toISOString(),
    "2026-07-01T08:00:00.000Z",
  );
});

test("ICS moved and cancelled occurrences do not duplicate the series", () => {
  const source = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:series",
    "DTSTART;TZID=Europe/Amsterdam:20261019T100000",
    "DTEND;TZID=Europe/Amsterdam:20261019T110000",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:School",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:series",
    "RECURRENCE-ID;TZID=Europe/Amsterdam:20261026T100000",
    "DTSTART;TZID=Europe/Amsterdam:20261027T110000",
    "DTEND;TZID=Europe/Amsterdam:20261027T120000",
    "SUMMARY:Verplaatst",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:series",
    "RECURRENCE-ID;TZID=Europe/Amsterdam:20261102T100000",
    "STATUS:CANCELLED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const imported = importCalendar(source, "Europe/Amsterdam");
  assert.equal(imported.length, 2);
  assert.deepEqual(imported[0].excludedDates, [
    "2026-10-26T09:00:00.000Z",
    "2026-11-02T09:00:00.000Z",
  ]);
  assert.equal(imported[1].start.toISOString(), "2026-10-27T10:00:00.000Z");
  assert.equal(imported[1].recurrenceRule, null);
});
test("RDATE is a union, and all-day default end follows local midnight", () => {
  const source = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:rdate",
    "DTSTART:20261019T080000Z",
    "DTEND:20261019T090000Z",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "RDATE:20261026T080000Z,20261028T080000Z",
    "SUMMARY:Extra",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:allday",
    "DTSTART;VALUE=DATE:20260329",
    "SUMMARY:Zomertijd",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const imported = importCalendar(source, "Europe/Amsterdam");
  assert.equal(imported.length, 3);
  const allDay = imported.find((x) => x.externalUid === "allday")!;
  assert.equal(+allDay.end - +allDay.start, 23 * 3600000);
});
