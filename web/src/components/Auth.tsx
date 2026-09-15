"use client";
import Link from "next/link";
import { useState } from "react";
import { request } from "@/lib/api";
export type User = { id: string; name: string; email: string };
export default function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      onLogin(
        await request<User>(
          `/auth/${register ? "register" : "login"}`,
          "POST",
          data,
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="authPage">
      <section className="authStory">
        <Link className="brand" href="/">
          zenda<span>✳</span>
        </Link>
        <div>
          <span className="eyebrow">MEER TIJD VOOR ELKAAR</span>
          <h1>
            Het hele gezin.
            <br />
            Eén agenda.
          </h1>
          <p>
            Van de eerste schooldag tot een weekend samen.
            <br />
            Geef alles een plek, met iedereen in beeld.
          </p>
          <div className="samplePeople">
            <span>JI</span>
            <span>SA</span>
            <span>NO</span>
            <span>+</span>
          </div>
        </div>
        <small>Samen gepland. Ruimte voor het leven.</small>
      </section>
      <section className="authPanel">
        <form onSubmit={submit}>
          <span className="eyebrow">WELKOM BIJ ZENDA</span>
          <h2>{register ? "Maak je eigen plek" : "Fijn dat je er bent"}</h2>
          <p className="muted">
            {register
              ? "Een gratis account voor jouw gezinsagenda."
              : "Log in en bekijk wat er op de planning staat."}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {register && (
            <label>
              Je naam
              <input name="name" required autoComplete="name" maxLength={100} />
            </label>
          )}
          <label>
            E-mailadres
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
            />
          </label>
          <label>
            Wachtwoord
            <input
              name="password"
              type="password"
              required
              minLength={register ? 12 : 1}
              maxLength={256}
              autoComplete={register ? "new-password" : "current-password"}
            />
            {register && <small>Minimaal 12 tekens.</small>}
          </label>
          <button className="primary full" disabled={busy}>
            {busy
              ? "Even wachten…"
              : register
                ? "Account aanmaken"
                : "Inloggen"}
          </button>
          <button
            className="textButton full"
            type="button"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register
              ? "Al een account? Inloggen"
              : "Nieuw hier? Maak een account"}
          </button>
        </form>
      </section>
    </main>
  );
}
