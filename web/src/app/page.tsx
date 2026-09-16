"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Auth, { User } from "@/components/Auth";
import Dialog from "@/components/Dialog";
import EventEditor from "@/components/EventEditor";

import Settings, { Preferences, readPreferences } from "@/components/Settings";
import {
  Calendar,
  CalendarEvent,
  Feed,
  Person,
  getCalendars,
  getPeople,
  getEvents,
  getEvent,
  request,
} from "@/lib/api";
import { dateKey, daysFor, localInput, toInstant } from "@/lib/dates";

export default function Home() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false);
  useEffect(() => {
    request<User>("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  if (!ready)
    return (
      <main className="loading">
        <span className="brand">zenda✳</span>
        <p>Even alles op een rij zetten…</p>
      </main>
    );
  return user ? (
    <Workspace key={user.id} user={user} onLogout={() => setUser(null)} />
  ) : (
    <Auth onLogin={setUser} />
  );
}
function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [preferences, setPreferences] = useState<Preferences>(() =>
    readPreferences(user.id),
  );
  function changePreferences(value: Preferences) {
    setPreferences(value);
    try {
      localStorage.setItem(
        `zenda:preferences:${user.id}`,
        JSON.stringify(value),
      );
    } catch {}
  }
  const [calendars, setCalendars] = useState<Calendar[]>([]),
    [calendarId, setCalendarId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      getCalendars()
        .then((values) => {
          setCalendars(values);
          setCalendarId((current) =>
            values.some((c) => c.id === current)
              ? current
              : values[0]?.id || "",
          );
          setError("");
        })
        .catch((err) => setError(err.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function logout() {
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await request("/push", "DELETE", { endpoint: subscription.endpoint });
          await subscription.unsubscribe();
        }
      }
      await request("/auth/logout", "POST");
      onLogout();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  const calendar = calendars.find((c) => c.id === calendarId);
  return (
    <div
      className="workspace"
      data-theme={preferences.theme}
      data-density={preferences.density}
      style={
        preferences.theme === "custom"
          ? ({ "--green": preferences.accent } as React.CSSProperties)
          : undefined
      }
    >
      <header className="appHeader">
        <Link className="brand" href="/">
          zenda<span>✳</span>
        </Link>
        <span className="headerTagline">Samen gepland.</span>
        <div className="account">
          <span>{user.name}</span>
          <button className="textButton" onClick={logout}>
            Uitloggen
          </button>
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          {error} <button onClick={load}>Opnieuw proberen</button>
        </div>
      )}
      {calendar ? (
        <Agenda
          key={calendar.id}
          calendar={calendar}
          calendars={calendars}
          user={user}
          onCalendar={setCalendarId}
          preferences={preferences}
          onPreferences={changePreferences}
          onCalendarChanged={load}
        />
      ) : (
        <div className="loading">
          <p>
            {error
              ? "Je agenda kon niet worden geladen."
              : "Je hebt nog geen toegang tot een familieagenda. Vraag je beheerder om toegang."}
          </p>
        </div>
      )}
    </div>
  );
}
function Agenda({
  calendar,
  calendars,
  user,
  onCalendar,
  preferences,
  onPreferences,
  onCalendarChanged,
}: {
  calendar: Calendar;
  calendars: Calendar[];
  user: User;
  onCalendar: (id: string) => void;
  preferences: Preferences;
  onPreferences: (value: Preferences) => void;
  onCalendarChanged: () => Promise<void>;
}) {
  const [current, setCurrent] = useState(
      () =>
        new Date(
          localInput(new Date().toISOString(), calendar.timezone).slice(0, 10) +
            "T12:00:00",
        ),
    ),
    [view, setView] = useState<"day" | "week" | "month">(() =>
      window.matchMedia("(max-width: 760px)").matches
        ? "day"
        : preferences.defaultView,
    );
  const [people, setPeople] = useState<Person[]>([]),
    [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"agenda" | "personal" | "calendar">("agenda");
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [hiddenFeeds, setHiddenFeeds] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`zenda:hidden:${user.id}:${calendar.id}`) || "[]",
      );
    } catch {
      return [];
    }
  });
  function toggleFeed(id: string) {
    setHiddenFeeds((current) => {
      const next = current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id];
      try {
        localStorage.setItem(
          `zenda:hidden:${user.id}:${calendar.id}`,
          JSON.stringify(next),
        );
      } catch {}
      return next;
    });
  }
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [editor, setEditor] = useState<{
    event: CalendarEvent | null;
    day: string;
    occurrence?: string;
  } | null>(null);
  const [search, setSearch] = useState(""),
    [personFilter, setPersonFilter] = useState("");
  const sequence = useRef(0),
    importInput = useRef<HTMLInputElement>(null),
    notified = useRef(new Set<string>());
  const days = useMemo(() => daysFor(current, view), [current, view]);
  const rangeStart = toInstant(dateKey(days[0]) + "T00:00", calendar.timezone);
  const last = days[days.length - 1];
  const rangeEnd = toInstant(
    dateKey(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)) +
      "T00:00",
    calendar.timezone,
  );
  const canEdit = calendar.role !== "VIEW";
  const today = localInput(new Date().toISOString(), calendar.timezone).slice(
    0,
    10,
  );
  const load = useCallback(async () => {
    const generation = ++sequence.current;
    try {
      const [nextPeople, nextEvents, nextFeeds] = await Promise.all([
        getPeople(calendar.id),
        getEvents(calendar.id, rangeStart, rangeEnd),
        request<Feed[]>(`/calendars/${calendar.id}/feeds`),
      ]);
      if (generation !== sequence.current) return;
      setPeople(nextPeople);
      setEvents(nextEvents);
      setFeeds(nextFeeds);
      setSelected((current) =>
        current && nextEvents.some((event) => event.id === current.id)
          ? current
          : null,
      );
      setError("");
    } catch (err) {
      if (generation === sequence.current) setError((err as Error).message);
    } finally {
      if (generation === sequence.current) setLoading(false);
    }
  }, [calendar.id, rangeStart, rangeEnd]);
  useEffect(() => {
    // Fetching remote data updates state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    const focus = () => {
      void load();
    };
    window.addEventListener("focus", focus);
    const requestSequence = sequence;
    return () => {
      requestSequence.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const now = Date.now();
        const upcoming = await getEvents(
          calendar.id,
          new Date(now).toISOString(),
          new Date(now + 8 * 86400000).toISOString(),
        );
        for (const event of upcoming) {
          if (event.reminderMinutes === null) continue;
          const due = +new Date(event.start) - event.reminderMinutes * 60000;
          const key = event.id + event.start;
          if (due <= now && due >= now - 60000 && !notified.current.has(key)) {
            notified.current.add(key);
            setNotice(
              `Herinnering: ${event.title} om ${localInput(event.start, calendar.timezone).slice(11)}.`,
            );
          }
        }
      } catch {
        /* The main calendar refresh displays connectivity failures. */
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [calendar.id, calendar.timezone]);
  function navigate(direction: number) {
    setCurrent((date) =>
      view === "month"
        ? new Date(date.getFullYear(), date.getMonth() + direction, 1, 12)
        : new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate() + direction * (view === "week" ? 7 : 1),
            12,
          ),
    );
  }
  function newEvent(day = dateKey(current)) {
    setEditor({ event: null, day });
  }
  async function edit(single: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      const event = single
        ? selected
        : await getEvent(calendar.id, selected.id);
      setEditor({
        event,
        day: localInput(event.start, calendar.timezone).slice(0, 10),
        ...(single ? { occurrence: selected.start } : {}),
      });
      setSelected(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(single: boolean) {
    if (
      !selected ||
      !confirm(
        single
          ? "Alleen dit voorkomen verwijderen?"
          : selected.recurrenceRule
            ? "De hele reeks verwijderen, inclusief bestanden?"
            : "Deze afspraak verwijderen, inclusief bestanden?",
      )
    )
      return;
    setBusy(true);
    try {
      await request(
        `/calendars/${calendar.id}/events/${selected.id}${single ? "?" + new URLSearchParams({ occurrence: selected.start }) : ""}`,
        "DELETE",
      );
      setSelected(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Agendabestand mag maximaal 2 MB zijn.");
      const result = await request<{ count: number }>(
        `/calendars/${calendar.id}/import`,
        "POST",
        { content: await file.text() },
      );
      setNotice(
        `${result.count} afspraken geïmporteerd. Eerder geïmporteerde afspraken zijn bijgewerkt.`,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  }
  async function notifications() {
    setBusy(true);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error(
          "Pushmeldingen zijn niet beschikbaar in deze browser. Herinneringen blijven zichtbaar zolang Zenda openstaat.",
        );
      const { key } = await request<{ key: string | null }>("/push/key");
      if (!key)
        throw new Error(
          "Pushmeldingen zijn nog niet ingesteld op de server. Herinneringen verschijnen wel als je de agenda open hebt.",
        );
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error("Sta meldingen toe in je browserinstellingen.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const bytes = Uint8Array.from(
        atob(key.replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      );
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      await request("/push", "POST", subscription.toJSON());
      setNotice("Meldingen zijn ingeschakeld op dit apparaat.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = events.filter(
    (event) =>
      !hiddenFeeds.includes(event.feedId || "family") &&
      (!personFilter ||
        event.people.some((p) => p.person.id === personFilter)) &&
      [event.title, event.location, event.notes].some((value) =>
        value?.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  function onDay(event: CalendarEvent, day: string) {
    return (
      localInput(event.start, calendar.timezone).slice(0, 10) <= day &&
      localInput(
        new Date(+new Date(event.end) - 1).toISOString(),
        calendar.timezone,
      ).slice(0, 10) >= day
    );
  }
  function bubbles(event: CalendarEvent) {
    return (
      <span className="eventPeople">
        {event.people.map(({ person }) => (
          <span
            key={person.id}
            className="bubble"
            style={{ background: person.color }}
            title={person.name}
          >
            {person.initials}
          </span>
        ))}
      </span>
    );
  }
  const heading = current.toLocaleDateString("nl-NL", {
    month: "long",
    year: "numeric",
    ...(view === "day" ? { day: "numeric" } : {}),
  });
  return (
    <div className="appBody">
      <aside className="sidebar">
        <div className="calendarPicker">
          <span className="eyebrow">FAMILIEAGENDA</span>
          {calendars.length > 1 ? (
            <select
              aria-label="Agenda kiezen"
              value={calendar.id}
              onChange={(e) => onCalendar(e.target.value)}
            >
              {calendars.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
          ) : (
            <h2>{calendar.name}</h2>
          )}
        </div>
        <nav className="mainTabs" aria-label="Hoofdnavigatie">
          <button
            aria-current={tab === "agenda" ? "page" : undefined}
            onClick={() => setTab("agenda")}
          >
            ▦ Agenda
          </button>
          <button
            aria-current={tab === "personal" ? "page" : undefined}
            onClick={() => setTab("personal")}
          >
            ⚙ Instellingen
          </button>
          <button
            aria-current={tab === "calendar" ? "page" : undefined}
            onClick={() => setTab("calendar")}
          >
            ♧ Agenda-instellingen
          </button>
        </nav>
        <section className="calendarLayers">
          <h3>Weergeven</h3>
          <label className="checkLabel">
            <input
              type="checkbox"
              checked={!hiddenFeeds.includes("family")}
              onChange={() => toggleFeed("family")}
            />
            <span className="layerDot" style={{ background: "var(--green)" }} />
            {calendar.name}
          </label>
          {feeds.map((feed) => (
            <label className="checkLabel" key={feed.id}>
              <input
                type="checkbox"
                checked={!hiddenFeeds.includes(feed.id)}
                onChange={() => toggleFeed(feed.id)}
              />
              <span className="layerDot" style={{ background: feed.color }} />
              <span>
                {feed.name}
                <small>
                  {feed.ownerId === user.id
                    ? "Mijn externe agenda"
                    : "Van " + (feed.owner?.name || "een gezinslid")}
                </small>
              </span>
            </label>
          ))}
          <button className="textButton" onClick={() => setTab("personal")}>
            + Externe agenda toevoegen
          </button>
        </section>
        <section className="familyLegend">
          <h3>Het gezin</h3>
          {people.map((person) => (
            <button
              key={person.id}
              className="legendPerson"
              aria-pressed={personFilter === person.id}
              onClick={() => {
                setPersonFilter((current) =>
                  current === person.id ? "" : person.id,
                );
                setTab("agenda");
              }}
            >
              <span className="bubble" style={{ background: person.color }}>
                {person.initials}
              </span>
              {person.name}
            </button>
          ))}
        </section>
        <small className="timezone">
          {calendar.timezone}
          <br />
          {calendar.role === "VIEW"
            ? "Familieagenda: alleen lezen"
            : "Wijzigingen automatisch gedeeld"}
        </small>
      </aside>
      <input
        ref={importInput}
        className="srOnly"
        type="file"
        accept=".ics,text/calendar"
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {tab !== "agenda" && (error || notice) && (
        <div className="settingsFeedback" role="status">
          <p className={error ? "error" : "notice"}>
            {error || notice}
            <button
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              Sluiten
            </button>
          </p>
        </div>
      )}
      {tab !== "agenda" ? (
        <Settings
          tab={tab}
          calendar={calendar}
          user={user}
          people={people}
          preferences={preferences}
          onPreferences={onPreferences}
          onChanged={load}
          onCalendarChanged={onCalendarChanged}
          onNotifications={notifications}
          onImport={() => importInput.current?.click()}
          busy={busy}
        />
      ) : (
        <main className="calendarMain">
          <div className="pageHeading">
            <div>
              <h1>{heading}</h1>
            </div>
            {canEdit && (
              <button className="primary" onClick={() => newEvent()}>
                + Nieuwe afspraak
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="error">
              {error}{" "}
              <button
                onClick={() => {
                  void load();
                }}
              >
                Opnieuw laden
              </button>
              <button aria-label="Melding sluiten" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button
                aria-label="Melding sluiten"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          <div className="toolbar">
            <div className="navigation">
              <button aria-label="Vorige periode" onClick={() => navigate(-1)}>
                ‹
              </button>
              <button onClick={() => setCurrent(new Date(today + "T12:00:00"))}>
                Vandaag
              </button>
              <button aria-label="Volgende periode" onClick={() => navigate(1)}>
                ›
              </button>
            </div>
            <div className="filters">
              <input
                aria-label="Zoeken in deze periode"
                placeholder="Zoek een afspraak…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Filter op persoon"
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value)}
              >
                <option value="">Iedereen</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="viewSwitch">
              {(["day", "week", "month"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={view === value}
                  className={view === value ? "active" : ""}
                  onClick={() => setView(value)}
                >
                  {{ day: "Dag", week: "Week", month: "Maand" }[value]}
                </button>
              ))}
            </div>
          </div>
          <div className="calendarStatus" aria-live="polite">
            {loading
              ? "Agenda laden…"
              : `${filtered.length} ${filtered.length === 1 ? "afspraak" : "afspraken"} in deze periode`}
          </div>
          <section className={`calendarGrid ${view}`} aria-label="Afspraken">
            <div className="weekdays">
              {(view === "day"
                ? [current.toLocaleDateString("nl-NL", { weekday: "long" })]
                : [
                    "Maandag",
                    "Dinsdag",
                    "Woensdag",
                    "Donderdag",
                    "Vrijdag",
                    "Zaterdag",
                    "Zondag",
                  ]
              ).map((name) => (
                <div key={name}>{name}</div>
              ))}
            </div>
            <div className="days">
              {days.map((day) => {
                const key = dateKey(day),
                  dayEvents = filtered.filter((event) => onDay(event, key));
                return (
                  <article
                    className={`dayCell ${day.getMonth() !== current.getMonth() ? "outside" : ""} ${key === today ? "today" : ""}`}
                    key={key}
                  >
                    <header>
                      <span className="dayNumber">{day.getDate()}</span>
                      {view !== "month" && (
                        <small>
                          {day.toLocaleDateString("nl-NL", { month: "short" })}
                        </small>
                      )}
                      {canEdit && (
                        <button
                          className="addDay"
                          aria-label={`Afspraak toevoegen op ${key}`}
                          onClick={() => newEvent(key)}
                        >
                          +
                        </button>
                      )}
                    </header>
                    {dayEvents.map((event) => (
                      <button
                        className="eventCard"
                        key={event.id + event.start}
                        style={{
                          borderLeftColor:
                            feeds.find((feed) => feed.id === event.feedId)
                              ?.color ||
                            event.people[0]?.person.color ||
                            "var(--green)",
                        }}
                        onClick={() => setSelected(event)}
                      >
                        <span className="eventTime">
                          {localInput(event.start, calendar.timezone).slice(11)}{" "}
                          – {localInput(event.end, calendar.timezone).slice(11)}
                          {event.recurrenceRule && " ↻"}
                        </span>
                        <strong>{event.title}</strong>
                        {event.feedId && (
                          <small className="eventSource">
                            {
                              feeds.find((feed) => feed.id === event.feedId)
                                ?.name
                            }
                          </small>
                        )}
                        {event.location && view !== "month" && (
                          <span className="muted">{event.location}</span>
                        )}
                        {bubbles(event)}
                      </button>
                    ))}
                    {!dayEvents.length && view === "day" && (
                      <p className="emptyDay">
                        Nog niets gepland. Ruimte voor iets moois.
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
          <footer className="calendarFooter">
            <span>
              <i /> Vandaag
            </span>
            <span>Alles bij elkaar, iedereen in beeld.</span>
          </footer>
        </main>
      )}
      {editor && (
        <EventEditor
          calendar={calendar}
          people={people}
          {...editor}
          onClose={() => setEditor(null)}
          onSaved={load}
        />
      )}
      {selected && (
        <Dialog
          title={selected.title}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <p className="detailTime">
            {new Date(selected.start).toLocaleString("nl-NL", {
              timeZone: calendar.timezone,
              dateStyle: "full",
              timeStyle: "short",
            })}
            <br />
            tot{" "}
            {new Date(selected.end).toLocaleString("nl-NL", {
              timeZone: calendar.timezone,
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
          {bubbles(selected)}
          {selected.location && (
            <section className="detailSection">
              <h3>Locatie</h3>
              <p>{selected.location}</p>
            </section>
          )}
          {selected.notes && (
            <section className="detailSection">
              <h3>Notities</h3>
              <p className="preWrap">{selected.notes}</p>
            </section>
          )}
          {selected.recurrenceRule && (
            <p className="notice">↻ Terugkerende afspraak</p>
          )}
          {selected.reminderMinutes !== null && (
            <p className="muted">
              Herinnering: {selected.reminderMinutes} minuten vooraf.
            </p>
          )}
          {selected.attachments.length > 0 && (
            <section className="detailSection">
              <h3>Bestanden</h3>
              {selected.attachments.map((file) => (
                <div className="fileRow" key={file.id}>
                  <a
                    href={`/api/calendars/${calendar.id}/events/${selected.id}/files/${file.id}`}
                  >
                    {file.name}{" "}
                    <small>({Math.ceil(file.size / 1024)} kB)</small>
                  </a>
                  {canEdit && !selected.feedId && (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm(`Bestand ${file.name} verwijderen?`))
                          return;
                        setBusy(true);
                        try {
                          await request(
                            `/calendars/${calendar.id}/events/${selected.id}/files/${file.id}`,
                            "DELETE",
                          );
                          setSelected({
                            ...selected,
                            attachments: selected.attachments.filter(
                              (x) => x.id !== file.id,
                            ),
                          });
                          await load();
                        } catch (err) {
                          setError((err as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Verwijderen
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          {selected.feedId && (
            <p className="notice">
              Deze afspraak komt uit een externe agenda. Wijzigingen worden daar
              beheerd.
            </p>
          )}
          {canEdit && !selected.feedId && (
            <div className="detailActions">
              {selected.recurrenceRule ? (
                <>
                  <div>
                    <button disabled={busy} onClick={() => edit(true)}>
                      Dit voorkomen bewerken
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => edit(false)}
                    >
                      Hele reeks bewerken
                    </button>
                  </div>
                  <div>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => remove(true)}
                    >
                      Dit voorkomen verwijderen
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => remove(false)}
                    >
                      Hele reeks verwijderen
                    </button>
                  </div>
                </>
              ) : (
                <div>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() => remove(false)}
                  >
                    Verwijderen
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => edit(false)}
                  >
                    Bewerken
                  </button>
                </div>
              )}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
