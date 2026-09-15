export type Person = {
  id: string;
  name: string;
  initials: string;
  color: string;
};
export type Calendar = {
  id: string;
  name: string;
  timezone: string;
  role: "VIEW" | "EDIT" | "ADMIN";
};
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  notes: string | null;
  recurrenceRule: string | null;
  people: { person: Person }[];
  reminderMinutes: number | null;
  feedId: string | null;
  attachments: { id: string; name: string; size: number }[];
};
export type EventInput = {
  title: string;
  start: string;
  end: string;
  location: string;
  notes: string;
  recurrenceRule: string | null;
  people: string[];
  reminderMinutes: number | null;
};
export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    cache: "no-store",
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(
      detail?.error ||
        "De server is niet bereikbaar. Controleer of de API en database draaien.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
const base = (c: string) => `/calendars/${encodeURIComponent(c)}`;
export const getCalendars = () => request<Calendar[]>("/calendars");
export const createCalendar = (name: string) =>
  request<Calendar>("/calendars", "POST", { name });
export const getPeople = (c: string) => request<Person[]>(`${base(c)}/people`);
export const createPerson = (c: string, data: Omit<Person, "id">) =>
  request<Person>(`${base(c)}/people`, "POST", data);
export const updatePerson = (c: string, id: string, data: Omit<Person, "id">) =>
  request<Person>(`${base(c)}/people/${id}`, "PATCH", data);
export const deletePerson = (c: string, id: string) =>
  request<void>(`${base(c)}/people/${id}`, "DELETE");
export const getEvents = (c: string, start: string, end: string) =>
  request<CalendarEvent[]>(
    `${base(c)}/events?${new URLSearchParams({ start, end })}`,
  );
export const getEvent = (c: string, id: string) =>
  request<CalendarEvent>(`${base(c)}/events/${id}`);
export const createEvent = (c: string, data: EventInput) =>
  request<CalendarEvent>(`${base(c)}/events`, "POST", data);
export const updateEvent = (c: string, id: string, data: EventInput) =>
  request<CalendarEvent>(`${base(c)}/events/${id}`, "PATCH", data);
export const deleteEvent = (c: string, id: string) =>
  request<void>(`${base(c)}/events/${id}`, "DELETE");
