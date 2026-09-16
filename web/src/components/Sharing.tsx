"use client";
import { useEffect, useState, useCallback } from "react";
import { Calendar, Member, request } from "@/lib/api";
function AccountRow({
  member,
  managed,
  busy,
  onSave,
  onDelete,
}: {
  member: Member;
  managed: boolean;
  busy: boolean;
  onSave: (member: Member, data: unknown) => Promise<void>;
  onDelete: (member: Member, managed: boolean) => Promise<void>;
}) {
  return (
    <section className="settingsCard">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(
            member,
            Object.fromEntries(new FormData(event.currentTarget)),
          );
        }}
      >
        <h3>{member.user.name}</h3>
        <p className="muted">
          {member.user.email}
          {!managed && " · Bestaand zelfstandig account"}
        </p>
        {managed && (
          <label>
            Naam
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={member.user.name}
            />
          </label>
        )}
        <label>
          Toegang
          <select name="role" defaultValue={member.role}>
            <option value="VIEW">Alleen lezen</option>
            <option value="EDIT">Afspraken bewerken</option>
          </select>
        </label>
        {managed && (
          <label>
            Nieuw wachtwoord
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              placeholder="Leeg laten om te behouden"
            />
            <small>
              Minimaal 12 tekens. Bij wijzigen wordt dit gezinslid uitgelogd.
            </small>
          </label>
        )}
        <div className="actions">
          <button disabled={busy}>Opslaan</button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => onDelete(member, managed)}
          >
            {managed ? "Account verwijderen" : "Toegang intrekken"}
          </button>
        </div>
      </form>
    </section>
  );
}
export default function Sharing({
  calendar,
  userId,
}: {
  calendar: Calendar;
  userId: string;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const path = `/calendars/${calendar.id}`;
  const load = useCallback(
    async () => setMembers(await request<Member[]>(`${path}/members`)),
    [path],
  );
  useEffect(() => {
    request<Member[]>(`${path}/members`)
      .then(setMembers)
      .catch((err) => setError(err.message));
  }, [path]);
  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice("Accountbeheer bijgewerkt.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(member: Member, managed: boolean) {
    if (managed) {
      const confirmEmail = prompt(
        `Account van ${member.user.name} definitief verwijderen? Ook de eigen externe koppelingen worden verwijderd. Gezamenlijke afspraken blijven bewaard. Typ ter bevestiging: ${member.user.email}`,
      );
      if (confirmEmail === null) return;
      await change(() =>
        request(`${path}/users/${member.userId}`, "DELETE", { confirmEmail }),
      );
    } else if (
      confirm(
        `Toegang van ${member.user.name} intrekken? Externe koppelingen van dit lid worden uit deze familieagenda verwijderd.`,
      )
    )
      await change(() => request(`${path}/members/${member.userId}`, "DELETE"));
  }
  return (
    <section>
      <h2>Gezinsaccounts</h2>
      <p className="muted">
        Jij beheert de accounts van dit gezin. Nieuwe gezinsleden krijgen
        uitsluitend deze familieagenda. Geef hun inloggegevens zelf aan hen
        door.
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
      {members
        .filter((member) => member.userId === userId)
        .map((member) => (
          <p key={member.userId} className="notice">
            {member.user.name} · Familiebeheerder
          </p>
        ))}
      {members
        .filter((member) => member.userId !== userId)
        .map((member) => (
          <AccountRow
            key={member.userId + member.role + member.user.name}
            member={member}
            managed={member.user.managedById === userId}
            busy={busy}
            onDelete={remove}
            onSave={(member, data) =>
              change(() =>
                member.user.managedById === userId
                  ? request(`${path}/users/${member.userId}`, "PATCH", data)
                  : request(`${path}/members`, "POST", {
                      ...(data as object),
                      email: member.user.email,
                    }),
              )
            }
          />
        ))}
      <section className="settingsCard">
        <h3>Gezinsaccount maken</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            void change(async () => {
              await request(`${path}/users`, "POST", data);
              form.reset();
            });
          }}
        >
          <div className="formRow">
            <label>
              Naam
              <input name="name" required maxLength={100} />
            </label>
            <label>
              E-mailadres
              <input name="email" type="email" required maxLength={254} />
            </label>
          </div>
          <label>
            Wachtwoord
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={256}
              required
            />
          </label>
          <label>
            Toegang
            <select name="role" defaultValue="EDIT">
              <option value="EDIT">Afspraken bewerken</option>
              <option value="VIEW">Alleen lezen</option>
            </select>
          </label>
          <button className="primary" disabled={busy}>
            Account aanmaken
          </button>
        </form>
      </section>
    </section>
  );
}
