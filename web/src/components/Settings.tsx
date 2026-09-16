"use client";
import { useState } from "react";
import { Calendar, Person, request } from "@/lib/api";
import { User } from "./Auth";
import Feeds from "./Feeds";
import Sharing from "./Sharing";
import PeopleManager from "./PeopleManager";
export type Preferences = {
  theme: string;
  density: string;
  defaultView: "day" | "week" | "month";
  accent: string;
};
export const defaultPreferences: Preferences = {
  theme: "sage",
  density: "comfortable",
  defaultView: "week",
  accent: "#526d54",
};
export function readPreferences(userId: string): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(`zenda:preferences:${userId}`) || "{}",
    );
    return { ...defaultPreferences, ...value };
  } catch {
    return defaultPreferences;
  }
}
export default function Settings({
  tab,
  calendar,
  user,
  people,
  preferences,
  onPreferences,
  onChanged,
  onCalendarChanged,
  onNotifications,
  onImport,
  busy,
}: {
  tab: "personal" | "calendar";
  calendar: Calendar;
  user: User;
  people: Person[];
  preferences: Preferences;
  onPreferences: (value: Preferences) => void;
  onChanged: () => Promise<void>;
  onCalendarChanged: () => Promise<void>;
  onNotifications: () => void;
  onImport: () => void;
  busy: boolean;
}) {
  const [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false);
  const owner = calendar.ownerId === user.id;
  return (
    <main className="settingsMain">
      <header className="settingsHeading">
        <span className="eyebrow">ALLES OP JOUW MANIER</span>
        <h1>{tab === "personal" ? "Instellingen" : "Agenda-instellingen"}</h1>
        <p className="muted">
          {tab === "personal"
            ? "Jouw weergave, meldingen en externe agenda’s."
            : `Beheer van ${calendar.name}.`}
        </p>
      </header>
      {tab === "personal" ? (
        <>
          <section className="settingsCard">
            <h2>Uiterlijk</h2>
            <p className="muted">
              Deze voorkeuren worden voor jouw account op dit apparaat bewaard.
            </p>
            <div className="themeChoices">
              {[
                ["sage", "Salie"],
                ["ocean", "Oceaan"],
                ["rose", "Roze"],
                ["dark", "Donker"],
              ].map(([theme, name]) => (
                <button
                  key={theme}
                  className={`themeChoice ${theme}`}
                  aria-pressed={preferences.theme === theme}
                  onClick={() => onPreferences({ ...preferences, theme })}
                >
                  <span className="themePreview" />
                  {name}
                  {preferences.theme === theme && " ✓"}
                </button>
              ))}
            </div>
            <div className="formRow">
              <label>
                Ruimte tussen afspraken
                <select
                  value={preferences.density}
                  onChange={(e) =>
                    onPreferences({ ...preferences, density: e.target.value })
                  }
                >
                  <option value="comfortable">Ruim</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
              <label>
                Standaardweergave
                <select
                  value={preferences.defaultView}
                  onChange={(e) =>
                    onPreferences({
                      ...preferences,
                      defaultView: e.target.value as Preferences["defaultView"],
                    })
                  }
                >
                  <option value="day">Dag</option>
                  <option value="week">Week</option>
                  <option value="month">Maand</option>
                </select>
              </label>
            </div>
            <label>
              Eigen accentkleur
              <input
                type="color"
                value={preferences.accent}
                onChange={(e) =>
                  onPreferences({
                    ...preferences,
                    theme: "custom",
                    accent: e.target.value,
                  })
                }
              />
            </label>
            <button
              className="textButton"
              onClick={() => onPreferences(defaultPreferences)}
            >
              Standaard herstellen
            </button>
          </section>
          <section className="settingsCard">
            <h2>Meldingen</h2>
            <p className="muted">Ontvang herinneringen op dit apparaat.</p>
            <button disabled={busy} onClick={onNotifications}>
              Meldingen instellen
            </button>
          </section>
          <Feeds calendar={calendar} userId={user.id} onChanged={onChanged} />
        </>
      ) : (
        <>
          <section className="settingsCard">
            <h2>Familieagenda</h2>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {saved && (
              <p className="notice" role="status">
                Agendanaam opgeslagen.
              </p>
            )}
            {owner ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const data = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  setSaving(true);
                  setError("");
                  setSaved(false);
                  try {
                    await request(`/calendars/${calendar.id}`, "PATCH", data);
                    await onCalendarChanged();
                    setSaved(true);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <label>
                  Naam
                  <input
                    name="name"
                    required
                    maxLength={100}
                    defaultValue={calendar.name}
                  />
                </label>
                <button disabled={saving}>Naam opslaan</button>
              </form>
            ) : (
              <p>
                {calendar.name} · De familiebeheerder beheert de accounts en
                agendanaam.
              </p>
            )}
            <p className="fieldHint">Tijdzone: {calendar.timezone}</p>
          </section>
          <section className="settingsCard">
            <h2>Personen in afspraken</h2>
            <p className="muted">
              Namen, initialen en kleuren voor de bolletjes in de agenda. Een
              persoon hoeft geen eigen inlogaccount te hebben.
            </p>
            <PeopleManager
              calendarId={calendar.id}
              people={people}
              canEdit={calendar.role !== "VIEW"}
              onPeopleChanged={onChanged}
            />
          </section>
          {owner && <Sharing calendar={calendar} userId={user.id} />}
          <section className="settingsCard">
            <h2>Agendagegevens</h2>
            <p className="muted">
              Een import voegt afspraken toe aan de gezamenlijke familieagenda.
              De export bevat alleen afspraken die jij mag zien.
            </p>
            <div className="actions">
              {calendar.role !== "VIEW" && (
                <button onClick={onImport} disabled={busy}>
                  Bestand importeren (.ics)
                </button>
              )}
              <a
                className="buttonLink"
                href={`/api/calendars/${calendar.id}/export`}
              >
                Exporteren (.ics)
              </a>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
