"use client";
import { useState } from "react";
import {
  Calendar,
  CalendarEvent,
  Person,
  createEvent,
  updateEvent,
  request,
} from "@/lib/api";
import { localInput, toInstant } from "@/lib/dates";
import Dialog from "./Dialog";
export default function EventEditor({
  calendar,
  people,
  event,
  day,
  occurrence,
  onClose,
  onSaved,
}: {
  calendar: Calendar;
  people: Person[];
  event: CalendarEvent | null;
  day: string;
  occurrence?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState(
    event?.people.map((x) => x.person.id) || [],
  );
  const [rule, setRule] = useState(
    occurrence ? "" : event?.recurrenceRule || "",
  );
  const [files, setFiles] = useState<File[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const ruleParts: Record<string, string> = Object.fromEntries(
    rule
      .split(";")
      .filter(Boolean)
      .map((part) => part.split("=")),
  );
  function changeRule(key: string, value: string) {
    const parts = { ...ruleParts };
    if (value) parts[key] = value;
    else delete parts[key];
    setRule(
      Object.entries(parts)
        .map(([name, entry]) => `${name}=${entry}`)
        .join(";"),
    );
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    let persisted = !!savedId;
    try {
      const start = toInstant(String(form.get("start")), calendar.timezone),
        end = toInstant(String(form.get("end")), calendar.timezone);
      if (end <= start)
        throw new Error("De eindtijd moet na de begintijd liggen.");
      const input = {
        title: String(form.get("title")).trim(),
        start,
        end,
        location: String(form.get("location")),
        notes: String(form.get("notes")),
        recurrenceRule: rule || null,
        people: selected,
        reminderMinutes:
          form.get("reminder") === "" ? null : Number(form.get("reminder")),
      };
      let id = savedId;
      if (!id) {
        const saved =
          occurrence && event
            ? await request<CalendarEvent>(
                `/calendars/${calendar.id}/events/${event.id}/occurrences`,
                "POST",
                { ...input, occurrence },
              )
            : event
              ? await updateEvent(calendar.id, event.id, input)
              : await createEvent(calendar.id, input);
        id = saved.id;
        setSavedId(id);
        persisted = true;
      } else await updateEvent(calendar.id, id, input);
      for (const file of files) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await request(`/calendars/${calendar.id}/events/${id}/files`, "POST", {
          name: file.name,
          data,
        });
        setFiles((current) => current.filter((item) => item !== file));
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(
        (err as Error).message +
          (persisted
            ? " De afspraak is opgeslagen; je kunt de bestanden opnieuw proberen."
            : ""),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        event
          ? occurrence
            ? "Dit voorkomen bewerken"
            : event.recurrenceRule
              ? "Hele reeks bewerken"
              : "Afspraak bewerken"
          : "Nieuwe afspraak"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save}>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {event?.recurrenceRule && !occurrence && (
          <p className="notice">
            Je wijzigt de hele reeks, vanaf de oorspronkelijke begindatum.
          </p>
        )}
        <label>
          Titel
          <input
            autoFocus
            name="title"
            required
            maxLength={200}
            defaultValue={event?.title}
            placeholder="Bijvoorbeeld: samen naar de tandarts"
          />
        </label>
        <div className="formRow">
          <label>
            Begint
            <input
              type="datetime-local"
              name="start"
              required
              defaultValue={
                event
                  ? localInput(event.start, calendar.timezone)
                  : day + "T12:00"
              }
            />
          </label>
          <label>
            Eindigt
            <input
              type="datetime-local"
              name="end"
              required
              defaultValue={
                event
                  ? localInput(event.end, calendar.timezone)
                  : day + "T13:00"
              }
            />
          </label>
        </div>
        <p className="fieldHint">Tijden in {calendar.timezone}</p>
        <label>
          Locatie
          <input
            name="location"
            maxLength={500}
            defaultValue={event?.location || ""}
            placeholder="Waar spreken jullie af?"
          />
        </label>
        <fieldset>
          <legend>Wie zijn erbij?</legend>
          <div className="peopleChips">
            {people.map((person) => (
              <button
                type="button"
                key={person.id}
                className={`personChip ${selected.includes(person.id) ? "selected" : ""}`}
                aria-pressed={selected.includes(person.id)}
                onClick={() =>
                  setSelected((current) =>
                    current.includes(person.id)
                      ? current.filter((id) => id !== person.id)
                      : [...current, person.id],
                  )
                }
              >
                <span className="bubble" style={{ background: person.color }}>
                  {person.initials}
                </span>
                {person.name}
              </button>
            ))}
          </div>
          {!people.length && (
            <p className="muted">Je kunt later personen toevoegen.</p>
          )}
        </fieldset>
        {!occurrence && (
          <label>
            Herhalen
            <select
              value={
                [
                  "",
                  "FREQ=DAILY",
                  "FREQ=WEEKLY",
                  "FREQ=WEEKLY;INTERVAL=2",
                  "FREQ=MONTHLY",
                  "FREQ=YEARLY",
                ].includes(rule)
                  ? rule
                  : "custom"
              }
              onChange={(e) =>
                setRule(
                  e.target.value === "custom"
                    ? "FREQ=WEEKLY;COUNT=10"
                    : e.target.value,
                )
              }
            >
              <option value="">Niet herhalen</option>
              <option value="FREQ=DAILY">Elke dag</option>
              <option value="FREQ=WEEKLY">Elke week</option>
              <option value="FREQ=WEEKLY;INTERVAL=2">Elke twee weken</option>
              <option value="FREQ=MONTHLY">Elke maand</option>
              <option value="FREQ=YEARLY">Elk jaar</option>
              <option value="custom">Aangepaste herhaling…</option>
            </select>
          </label>
        )}
        {!occurrence && rule && (
          <fieldset>
            <legend>Herhaling verfijnen</legend>
            <label>
              Periode
              <select
                value={ruleParts.FREQ || "WEEKLY"}
                onChange={(e) => changeRule("FREQ", e.target.value)}
              >
                <option value="DAILY">Dag</option>
                <option value="WEEKLY">Week</option>
                <option value="MONTHLY">Maand</option>
                <option value="YEARLY">Jaar</option>
              </select>
            </label>
            <label>
              Aantal periodes tussen afspraken
              <input
                type="number"
                min="1"
                max="999"
                required
                value={ruleParts.INTERVAL || "1"}
                onChange={(e) => changeRule("INTERVAL", e.target.value)}
              />
            </label>
            {ruleParts.FREQ === "WEEKLY" && (
              <div className="peopleChips" aria-label="Dagen van de week">
                {[
                  ["MO", "Ma"],
                  ["TU", "Di"],
                  ["WE", "Wo"],
                  ["TH", "Do"],
                  ["FR", "Vr"],
                  ["SA", "Za"],
                  ["SU", "Zo"],
                ].map(([code, label]) => {
                  const days = (ruleParts.BYDAY || "")
                    .split(",")
                    .filter(Boolean);
                  return (
                    <button
                      type="button"
                      key={code}
                      className={`personChip ${days.includes(code) ? "selected" : ""}`}
                      aria-pressed={days.includes(code)}
                      onClick={() =>
                        changeRule(
                          "BYDAY",
                          (days.includes(code)
                            ? days.filter((day) => day !== code)
                            : [...days, code]
                          ).join(","),
                        )
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <label>
              Stoppen na aantal afspraken (leeg voor onbeperkt)
              <input
                type="number"
                min="1"
                max="10000"
                value={ruleParts.COUNT || ""}
                onChange={(e) => {
                  const parts = { ...ruleParts };
                  delete parts.UNTIL;
                  if (e.target.value) parts.COUNT = e.target.value;
                  else delete parts.COUNT;
                  setRule(
                    Object.entries(parts)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(";"),
                  );
                }}
              />
            </label>
            {ruleParts.UNTIL && (
              <p className="fieldHint">
                De bestaande einddatum van de reeks blijft behouden totdat je
                een aantal afspraken invult.
              </p>
            )}
          </fieldset>
        )}
        <label>
          Herinnering
          <select name="reminder" defaultValue={event?.reminderMinutes ?? ""}>
            <option value="">Geen herinnering</option>
            <option value="0">Op het begintijdstip</option>
            <option value="5">5 minuten vooraf</option>
            <option value="15">15 minuten vooraf</option>
            <option value="30">30 minuten vooraf</option>
            <option value="60">1 uur vooraf</option>
            <option value="1440">1 dag vooraf</option>
          </select>
        </label>
        <label>
          Notities
          <textarea
            name="notes"
            rows={3}
            maxLength={20000}
            defaultValue={event?.notes || ""}
            placeholder="Alles wat handig is om te weten"
          />
        </label>
        <label>
          Bestanden toevoegen
          <input
            type="file"
            multiple
            onChange={(e) => {
              const chosen = Array.from(e.target.files || []);
              if (
                chosen.some((file) => file.size > 5 * 1024 * 1024) ||
                chosen.length + (event?.attachments.length || 0) > 10
              ) {
                setError("Maximaal 10 bestanden van elk 5 MB.");
                e.target.value = "";
                setFiles([]);
              } else {
                setError("");
                setFiles(chosen);
              }
            }}
          />
          <small>
            Maximaal 5 MB per bestand. Bestaande bestanden staan bij de
            afspraak.
          </small>
        </label>
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Annuleren
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Opslaan…" : "Afspraak opslaan"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
