"use client";
import { useEffect, useState } from "react";
import { Calendar, Feed, Member, request } from "@/lib/api";

function Audience({
  members,
  selected,
  onChange,
  ownerId,
}: {
  members: Member[];
  selected: string[];
  onChange: (ids: string[]) => void;
  ownerId: string;
}) {
  return (
    <fieldset>
      <legend>Wie mag deze agenda zien?</legend>
      <p className="muted">
        Alleen jij, tenzij je hieronder gezinsleden kiest.
      </p>
      <div className="audienceOptions">
        {members
          .filter((member) => member.userId !== ownerId)
          .map((member) => (
            <label className="checkLabel" key={member.userId}>
              <input
                type="checkbox"
                checked={selected.includes(member.userId)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, member.userId]
                      : selected.filter((id) => id !== member.userId),
                  )
                }
              />
              {member.user.name}
            </label>
          ))}
      </div>
    </fieldset>
  );
}
function FeedEditor({
  feed,
  members,
  userId,
  onSave,
  onAction,
  busy,
}: {
  feed: Feed;
  members: Member[];
  userId: string;
  onSave: (feed: Feed, data: unknown) => Promise<void>;
  onAction: (feed: Feed, remove: boolean) => Promise<void>;
  busy: boolean;
}) {
  const [selected, setSelected] = useState(
    feed.shares.map((share) => share.userId),
  );
  return (
    <section className="settingsCard">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(feed, {
            ...Object.fromEntries(new FormData(event.currentTarget)),
            sharedWith: selected,
          });
        }}
      >
        <div className="formRow">
          <label>
            Naam
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={feed.name}
            />
          </label>
          <label>
            Kleur
            <input name="color" type="color" defaultValue={feed.color} />
          </label>
        </div>
        <Audience
          members={members}
          selected={selected}
          onChange={setSelected}
          ownerId={userId}
        />
        <p className="muted">
          {feed.lastSync
            ? `Bijgewerkt op ${new Date(feed.lastSync).toLocaleString("nl-NL")}`
            : "Nog niet gesynchroniseerd"}
        </p>
        {feed.lastError && <p className="error">{feed.lastError}</p>}
        <div className="actions">
          <button className="primary" disabled={busy}>
            Wijzigingen opslaan
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(feed, false)}
          >
            Verversen
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => onAction(feed, true)}
          >
            Koppeling verwijderen
          </button>
        </div>
      </form>
    </section>
  );
}
export default function Feeds({
  calendar,
  userId,
  onChanged,
}: {
  calendar: Calendar;
  userId: string;
  onChanged: () => Promise<void>;
}) {
  const [feeds, setFeeds] = useState<Feed[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [sharedWith, setSharedWith] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const path = `/calendars/${calendar.id}/feeds`;
  const load = async () => {
    setFeeds(await request<Feed[]>(path));
  };
  useEffect(() => {
    Promise.all([
      request<Feed[]>(path),
      request<Member[]>(`/calendars/${calendar.id}/members`),
    ])
      .then(([f, m]) => {
        setFeeds(f);
        setMembers(m);
      })
      .catch((err) => setError(err.message));
  }, [path, calendar.id]);
  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      await onChanged();
      setNotice("Opgeslagen. Je keuzes zijn bijgewerkt.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function act(feed: Feed, remove: boolean) {
    if (
      remove &&
      !confirm(
        `Koppeling ${feed.name} verwijderen uit Zenda? De oorspronkelijke externe agenda blijft bestaan.`,
      )
    )
      return;
    await change(() =>
      request(
        `${path}/${feed.id}${remove ? "" : "/sync"}`,
        remove ? "DELETE" : "POST",
      ),
    );
  }
  return (
    <section>
      <h2>Mijn externe agenda’s</h2>
      <p className="muted">
        Koppel school, werk of een andere agenda met een iCalendar-link. Elke 15
        minuten bijgewerkt. Aan- en uitzetten doe je naast de familieagenda.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {feeds
        .filter((feed) => feed.ownerId === userId)
        .map((feed) => (
          <FeedEditor
            key={feed.id + JSON.stringify(feed.shares)}
            feed={feed}
            members={members}
            userId={userId}
            busy={busy}
            onAction={act}
            onSave={(feed, data) =>
              change(() => request(`${path}/${feed.id}`, "PATCH", data))
            }
          />
        ))}
      <section className="settingsCard">
        <h3>Externe agenda toevoegen</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = {
              ...Object.fromEntries(new FormData(form)),
              sharedWith,
            };
            void change(async () => {
              await request(path, "POST", data);
              form.reset();
              setSharedWith([]);
            });
          }}
        >
          <div className="formRow">
            <label>
              Naam
              <input
                name="name"
                required
                maxLength={100}
                placeholder="Bijvoorbeeld: mijn werk"
              />
            </label>
            <label>
              Kleur
              <input name="color" type="color" defaultValue="#627faa" />
            </label>
          </div>
          <label>
            iCalendar-abonnementslink
            <input
              name="url"
              required
              maxLength={2048}
              placeholder="https://…/agenda.ics"
            />
            <small>
              Een HTTPS- of webcal-link. Een geheime toegangscode wordt alleen
              op de server bewaard.
            </small>
          </label>
          <Audience
            members={members}
            selected={sharedWith}
            onChange={setSharedWith}
            ownerId={userId}
          />
          <button className="primary" disabled={busy}>
            {busy ? "Even wachten…" : "Agenda koppelen"}
          </button>
        </form>
      </section>
      {feeds.some((feed) => feed.ownerId !== userId) && (
        <section className="settingsCard">
          <h3>Met jou gedeeld</h3>
          {feeds
            .filter((feed) => feed.ownerId !== userId)
            .map((feed) => (
              <p key={feed.id}>
                {feed.name}{" "}
                <span className="muted">
                  · van {feed.owner?.name || "een gezinslid"}
                </span>
              </p>
            ))}
          <small>Alleen de eigenaar kan deze koppelingen aanpassen.</small>
        </section>
      )}
    </section>
  );
}
