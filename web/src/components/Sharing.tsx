"use client";
import { useEffect, useState, useCallback } from "react";
import { Calendar, request } from "@/lib/api";
import Dialog from "./Dialog";
type Member = {
  userId: string;
  role: string;
  user: { name: string; email: string };
};
export default function Sharing({
  calendar,
  userId,
  onClose,
}: {
  calendar: Calendar;
  userId: string;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      request<Member[]>(`/calendars/${calendar.id}/members`)
        .then(setMembers)
        .catch((err) => setError(err.message)),
    [calendar.id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await request(
        `/calendars/${calendar.id}/members`,
        "POST",
        Object.fromEntries(new FormData(form)),
      );
      await load();
      form.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(member: Member) {
    if (!confirm(`Toegang van ${member.user.name} intrekken?`)) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `/calendars/${calendar.id}/members/${member.userId}`,
        "DELETE",
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Samen in deze agenda" onClose={onClose}>
      <p className="muted">
        Laat de ander eerst een Zenda-account maken. Voeg daarna het e-mailadres
        toe. Er wordt geen e-mail verstuurd.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="memberList">
        {members.map((member) => (
          <div key={member.userId}>
            <span>
              <strong>{member.user.name}</strong>
              <small>
                {member.user.email} ·{" "}
                {
                  { VIEW: "Lezen", EDIT: "Bewerken", ADMIN: "Beheren" }[
                    member.role
                  ]
                }
              </small>
            </span>
            {member.userId !== userId && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => remove(member)}
              >
                Intrekken
              </button>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={add}>
        <label>
          E-mailadres
          <input name="email" type="email" required />
        </label>
        <label>
          Toegang
          <select name="role" defaultValue="EDIT">
            <option value="VIEW">Alleen lezen</option>
            <option value="EDIT">Afspraken en personen bewerken</option>
            <option value="ADMIN">Beheren, inclusief toegang delen</option>
          </select>
        </label>
        <button disabled={busy} className="primary">
          Toegang geven / aanpassen
        </button>
      </form>
    </Dialog>
  );
}
