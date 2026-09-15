"use client";
import { useEffect, useState } from "react";
import { Calendar, request } from "@/lib/api";
import Dialog from "./Dialog";
type Feed = {
  id: string;
  name: string;
  lastSync: string | null;
  lastError: string | null;
};
export default function Feeds({
  calendar,
  onClose,
  onChanged,
}: {
  calendar: Calendar;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [feeds, setFeeds] = useState<Feed[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const path = `/calendars/${calendar.id}/feeds`;
  const load = () => request<Feed[]>(path).then(setFeeds);
  useEffect(() => {
    request<Feed[]>(path)
      .then(setFeeds)
      .catch((err) => setError(err.message));
  }, [path]);
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await request(path, "POST", Object.fromEntries(new FormData(form)));
      await load();
      await onChanged();
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(feed: Feed, remove = false) {
    if (
      remove &&
      !confirm(
        `Koppeling ${feed.name} en de bijbehorende externe afspraken verwijderen?`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await request(
        `${path}/${feed.id}${remove ? "" : "/sync"}`,
        remove ? "DELETE" : "POST",
      );
      await load();
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Externe agenda’s"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="muted">
        Voeg een iCalendar-abonnementslink toe, bijvoorbeeld van school of je
        werk. Zenda ververst deze elke 15 minuten. Je bewerkt die afspraken in
        de oorspronkelijke agenda.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {feeds.map((feed) => (
        <section className="feedItem" key={feed.id}>
          <h3>{feed.name}</h3>
          <small className="muted">
            {feed.lastSync
              ? `Laatst bijgewerkt: ${new Date(feed.lastSync).toLocaleString("nl-NL")}`
              : "Nog niet gesynchroniseerd"}
          </small>
          {feed.lastError && <p className="error">{feed.lastError}</p>}
          {calendar.role === "ADMIN" && (
            <div className="actions">
              <button disabled={busy} onClick={() => act(feed)}>
                Verversen
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() => act(feed, true)}
              >
                Verwijderen
              </button>
            </div>
          )}
        </section>
      ))}
      {!feeds.length && <p>Er zijn nog geen externe agenda’s gekoppeld.</p>}
      {calendar.role === "ADMIN" && (
        <form onSubmit={add}>
          <label>
            Naam
            <input
              name="name"
              required
              maxLength={100}
              placeholder="Bijvoorbeeld: schoolvakanties"
            />
          </label>
          <label>
            iCalendar-link
            <input
              name="url"
              required
              maxLength={2048}
              placeholder="https://…/agenda.ics"
            />
            <small>
              Gebruik de rechtstreekse HTTPS- of webcal-link. Een link met een
              geheime toegangscode wordt alleen op de server bewaard.
            </small>
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Synchroniseren…" : "Agenda koppelen"}
          </button>
        </form>
      )}
    </Dialog>
  );
}
