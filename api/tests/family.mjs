import assert from "node:assert/strict";
export async function testFamily(db, base) {
  async function call(path, method = "GET", body, cookie = "", status = 200) {
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const raw = await r.text();
    assert.equal(r.status, status, `${method} ${path}: ${raw}`);
    return {
      body: raw ? JSON.parse(raw) : null,
      cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
    };
  }
  const password = "family-test-password";
  const admin = await call(
    "/auth/register",
    "POST",
    { name: "Family owner", email: "family-owner@test.example", password },
    "",
    201,
  );
  const calendar = (await call("/calendars", "GET", undefined, admin.cookie))
    .body[0];
  const path = `/calendars/${calendar.id}`;
  assert.equal(calendar.ownerId, admin.body.id);
  const createUser = async (name, role = "EDIT") =>
    (
      await call(
        path + "/users",
        "POST",
        { name, email: `${name}@test.example`, password, role },
        admin.cookie,
        201,
      )
    ).body;
  const anna = await createUser("anna", "VIEW");
  const ben = await createUser("ben");
  const a = await call("/auth/login", "POST", { email: anna.email, password });
  const b = await call("/auth/login", "POST", { email: ben.email, password });
  assert.equal(
    (await call("/calendars", "GET", undefined, a.cookie)).body.length,
    1,
    "Managed member has only one calendar",
  );
  await call("/calendars", "POST", { name: "Extra" }, a.cookie, 409);
  await call(path + "/users", "POST", { name: "Unauthorized" }, b.cookie, 403);
  await call(
    path + "/users/" + anna.id,
    "DELETE",
    { confirmEmail: anna.email },
    b.cookie,
    403,
  );
  await call(path, "PATCH", { name: "Ons thuis" }, admin.cookie);
  await call(path, "PATCH", { name: "Denied" }, b.cookie, 403);
  const feed = (
    await call(
      path + "/feeds",
      "POST",
      { name: "Private work", url: "https://127.0.0.1/private.ics" },
      a.cookie,
      201,
    )
  ).body;
  await db.query(
    'INSERT INTO "Event" (id,title,start,"end","calendarId","feedId","externalUid","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())',
    [
      "private-event",
      "Private dentist",
      "2026-10-01T10:00:00Z",
      "2026-10-01T11:00:00Z",
      calendar.id,
      feed.id,
      `${feed.id}:test`,
    ],
  );
  await db.query(
    'INSERT INTO "Attachment" (id,"eventId",name,data,size) VALUES ($1,$2,$3,$4,$5)',
    [
      "private-file",
      "private-event",
      "secret.txt",
      new TextEncoder().encode("private"),
      7,
    ],
  );
  const range = "?start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z";
  assert.equal(
    (await call(path + "/events" + range, "GET", undefined, a.cookie)).body
      .length,
    1,
  );
  for (const cookie of [admin.cookie, b.cookie]) {
    assert.equal(
      (await call(path + "/feeds", "GET", undefined, cookie)).body.length,
      0,
    );
    assert.equal(
      (await call(path + "/events" + range, "GET", undefined, cookie)).body
        .length,
      0,
    );
    await call(path + "/events/private-event", "GET", undefined, cookie, 404);
    await call(
      path + "/events/private-event/files/private-file",
      "GET",
      undefined,
      cookie,
      404,
    );
    const exported = await fetch(base + path + "/export", {
      headers: { Cookie: cookie },
    });
    assert.doesNotMatch(await exported.text(), /Private dentist/);
    await call(
      path + "/feeds/" + feed.id,
      "PATCH",
      { name: "Attempt", color: "#123456", sharedWith: [] },
      cookie,
      404,
    );
    await call(
      path + "/feeds/" + feed.id + "/sync",
      "POST",
      undefined,
      cookie,
      404,
    );
    await call(path + "/feeds/" + feed.id, "DELETE", undefined, cookie, 404);
  }
  const data = { name: "Anna werk", color: "#123456", sharedWith: [ben.id] };
  await call(path + "/feeds/" + feed.id, "PATCH", data, a.cookie, 204);
  assert.equal(
    (await call(path + "/events" + range, "GET", undefined, b.cookie)).body
      .length,
    1,
  );
  assert.equal(
    (await call(path + "/events" + range, "GET", undefined, admin.cookie)).body
      .length,
    0,
    "Family admin cannot bypass personal feed visibility",
  );
  const bfeed = (await call(path + "/feeds", "GET", undefined, b.cookie))
    .body[0];
  assert.equal(bfeed.url, undefined);
  assert.deepEqual(bfeed.shares, []);
  assert.equal(bfeed.lastError, null);
  await call(
    path + "/feeds/" + feed.id,
    "PATCH",
    { ...data, sharedWith: ["outside-family"] },
    a.cookie,
    400,
  );
  await call(
    path + "/feeds/" + feed.id,
    "PATCH",
    { ...data, sharedWith: [] },
    a.cookie,
    204,
  );
  await call(path + "/events/private-event", "GET", undefined, b.cookie, 404);
  const shared = (
    await call(
      path + "/events",
      "POST",
      {
        title: "Blijft bestaan",
        start: "2026-10-01T12:00:00Z",
        end: "2026-10-01T13:00:00Z",
        people: [],
      },
      b.cookie,
      201,
    )
  ).body;
  await call(
    path + "/users/" + anna.id,
    "PATCH",
    { name: "Anna nieuw", role: "EDIT", password: "new-family-password" },
    admin.cookie,
    204,
  );
  await call("/auth/me", "GET", undefined, a.cookie, 401);
  await call("/auth/login", "POST", { email: anna.email, password }, "", 401);
  const anew = await call("/auth/login", "POST", {
    email: anna.email,
    password: "new-family-password",
  });
  await call(
    path + "/users/" + anna.id,
    "DELETE",
    { confirmEmail: "wrong" },
    admin.cookie,
    400,
  );
  await call(
    path + "/users/" + admin.body.id,
    "DELETE",
    { confirmEmail: admin.body.email },
    admin.cookie,
    404,
  );
  await call(
    path + "/users/" + anna.id,
    "DELETE",
    { confirmEmail: anna.email },
    admin.cookie,
    204,
  );
  await call("/auth/me", "GET", undefined, anew.cookie, 401);
  assert.equal(
    (await db.query('SELECT id FROM "CalendarFeed" WHERE id=$1', [feed.id]))
      .rows.length,
    0,
  );
  assert.equal(
    (await db.query('SELECT id FROM "Event" WHERE id=$1', ["private-event"]))
      .rows.length,
    0,
  );
  assert.equal(
    (
      await db.query('SELECT id FROM "Attachment" WHERE id=$1', [
        "private-file",
      ])
    ).rows.length,
    0,
  );
  await call(path + "/events/" + shared.id, "GET", undefined, admin.cookie);
  console.log(
    "PASS: managed family accounts, single calendar, owner-only administration, private feeds, selected audience, event/file/export privacy, revocation, password reset, safe account deletion.",
  );
}
