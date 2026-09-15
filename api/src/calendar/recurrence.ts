import { RRule } from "rrule";

export function wallTime(date: Date, timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (key: string) => Number(parts.find(p => p.type === key)!.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")));
}

export function fromWall(date: Date, timezone: string): Date {
  let instant = date.getTime();
  for (let i = 0; i < 4; i++) {
    const correction = date.getTime() - wallTime(new Date(instant), timezone).getTime();
    if (!correction) break;
    instant += correction;
  }
  return new Date(instant);
}

export function parseRecurrenceRule(rule: string | null | undefined) {
  if (!rule) return null;
  if (rule.length > 500 || /[\r\n]/.test(rule)) throw new Error("Ongeldige herhalingsregel.");
  const options = RRule.parseString(rule);
  if (options.freq === undefined || options.freq > RRule.DAILY || (options.interval !== undefined && (!Number.isInteger(options.interval) || options.interval < 1 || options.interval > 1000)) || (options.count !== undefined && options.count !== null && (!Number.isInteger(options.count) || options.count < 1 || options.count > 10000))) throw new Error("Ongeldige herhalingsregel.");
  if (options.count && options.until) throw new Error("Gebruik een einddatum of aantal herhalingen, niet beide.");
  return options;
}

export function generateOccurrences(start: Date, end: Date, rule: string | null | undefined, rangeStart: Date, rangeEnd: Date, timezone = "Europe/Amsterdam", excludedDates: string[] = []) {
  const options = parseRecurrenceRule(rule);
  const duration = end.getTime() - start.getTime();
  const excluded = new Set(excludedDates);
  if (!options) return start < rangeEnd && end > rangeStart && !excluded.has(start.toISOString()) ? [{ start, end }] : [];
  const recurrence = new RRule({ ...options, dtstart: wallTime(start, timezone), ...(options.until ? { until: wallTime(options.until, timezone) } : {}), tzid: null });
  const candidates = recurrence.between(new Date(rangeStart.getTime() - duration - 172800000), new Date(rangeEnd.getTime() + 172800000), true);
  if (candidates.length > 10000) throw new Error("Te veel afspraken in dit bereik.");
  return candidates.map(value => {
    const occurrenceStart = fromWall(value, timezone);
    return { start: occurrenceStart, end: new Date(occurrenceStart.getTime() + duration) };
  }).filter(value => value.start < rangeEnd && value.end > rangeStart && !excluded.has(value.start.toISOString()));
}
