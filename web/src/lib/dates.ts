export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function daysFor(date: Date, view: "day" | "week" | "month") {
  const first = new Date(
    date.getFullYear(),
    date.getMonth(),
    view === "month" ? 1 : date.getDate(),
    12,
  );
  if (view !== "day")
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const length = view === "day" ? 1 : view === "week" ? 7 : 42;
  return Array.from(
    { length },
    (_, i) =>
      new Date(first.getFullYear(), first.getMonth(), first.getDate() + i, 12),
  );
}
export function localInput(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function toInstant(value: string, timezone: string) {
  const target = new Date(value + ":00Z").getTime();
  if (!Number.isFinite(target))
    throw new Error("Vul een geldige datum en tijd in.");
  let result = target;
  for (let i = 0; i < 4; i++) {
    const displayed = new Date(
      localInput(new Date(result).toISOString(), timezone) + ":00Z",
    ).getTime();
    const correction = target - displayed;
    if (!correction) return new Date(result).toISOString();
    result += correction;
  }
  throw new Error(
    "Dit tijdstip bestaat niet door de overgang naar zomertijd. Kies een ander tijdstip.",
  );
}
