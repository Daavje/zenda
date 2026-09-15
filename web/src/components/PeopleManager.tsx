"use client";
import { useState } from "react";
import { createPerson, deletePerson, updatePerson, Person } from "@/lib/api";
import Dialog from "./Dialog";
export default function PeopleManager({
  calendarId,
  people,
  canEdit,
  onPeopleChanged,
}: {
  calendarId: string;
  people: Person[];
  canEdit: boolean;
  onPeopleChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<Person> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = {
        name: editing.name || "",
        initials: editing.initials || "",
        color: editing.color || "#7264d5",
      };
      if (editing.id) await updatePerson(calendarId, editing.id, data);
      else await createPerson(calendarId, data);
      await onPeopleChanged();
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !editing?.id ||
      !confirm(
        `Persoon ${editing.name} verwijderen? Afspraken blijven bestaan.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deletePerson(calendarId, editing.id);
      await onPeopleChanged();
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="peopleSection">
      <div className="sectionHeading">
        <h3>Wie zijn erbij?</h3>
        {canEdit && (
          <button
            className="iconButton"
            aria-label="Persoon toevoegen"
            onClick={() => {
              setEditing({ name: "", initials: "", color: "#7264d5" });
              setError("");
            }}
          >
            +
          </button>
        )}
      </div>
      {people.map((person) => (
        <button
          className="personRow"
          key={person.id}
          disabled={!canEdit}
          onClick={() => {
            setEditing(person);
            setError("");
          }}
        >
          <span className="bubble" style={{ background: person.color }}>
            {person.initials}
          </span>
          <span>{person.name}</span>
          {canEdit && <span className="muted">↗</span>}
        </button>
      ))}
      {!people.length && (
        <p className="muted">
          Voeg je gezinsleden toe. Ze krijgen ieder een eigen kleur.
        </p>
      )}
      {editing && (
        <Dialog
          title={editing.id ? "Persoon bewerken" : "Nieuwe persoon"}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form onSubmit={save}>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <label>
              Naam
              <input
                autoFocus
                required
                maxLength={100}
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <div className="formRow">
              <label>
                Initialen
                <input
                  required
                  maxLength={3}
                  value={editing.initials}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      initials: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <label>
                Kleur
                <input
                  type="color"
                  value={editing.color}
                  onChange={(e) =>
                    setEditing({ ...editing, color: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="actions">
              {editing.id && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={remove}
                >
                  Verwijderen
                </button>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Opslaan…" : "Opslaan"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
