const response = await fetch("http://127.0.0.1:3001/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Voorbeeldgezin",
    email: "demo@zenda.test",
    password: "Zenda-demo-2026!",
  }),
});
if (response.status !== 201 && response.status !== 409)
  throw new Error(await response.text());
console.log("Local disposable UI test account ready.");
