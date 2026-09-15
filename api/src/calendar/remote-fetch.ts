import https from "node:https";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";

export function isPublicAddress(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
export async function fetchCalendar(source: string): Promise<string> {
  const url = new URL(source.replace(/^webcal:/i, "https:"));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    source.length > 2048
  )
    throw new Error(
      "Gebruik een rechtstreekse HTTPS-agendalink zonder gebruikersnaam of wachtwoord.",
    );
  const addresses = isIP(url.hostname)
    ? [url.hostname]
    : await resolve4(url.hostname);
  if (!addresses.length || addresses.some((ip) => !isPublicAddress(ip)))
    throw new Error("Gebruik een publiek bereikbaar agenda-adres.");
  // Pin the validated DNS result; redirects are refused to prevent access to private services.
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        family: 4,
        timeout: 10000,
        headers: { Accept: "text/calendar", "User-Agent": "Zenda/1.0" },
        lookup: (_host, _options, callback) => callback(null, addresses[0]!, 4),
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              "De agendalink geeft geen bestand terug. Gebruik de rechtstreekse iCalendar-link.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024)
            request.destroy(new Error("De externe agenda is groter dan 2 MB."));
          else chunks.push(chunk);
        });
        response.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8")),
        );
        response.on("error", reject);
      },
    );
    const deadline = setTimeout(
      () =>
        request.destroy(new Error("De externe agenda reageert niet op tijd.")),
      15000,
    );
    request.on("close", () => clearTimeout(deadline));
    request.on("timeout", () =>
      request.destroy(new Error("De externe agenda reageert niet op tijd.")),
    );
    request.on("error", reject);
  });
}
