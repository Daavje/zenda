# Zenda

Een gratis, zelf te hosten gezinsagenda met een eigen Nederlandstalige interface.

## Snel lokaal starten (Windows, macOS of Linux)

Vereist: Node.js 24 en npm. Vanuit deze map:

```powershell
npm run setup
npm run local
```

Open **http://localhost:3000** en maak je eigen account. Je hoeft geen Docker te installeren. De lokale PostgreSQL-compatibele database staat in `.local/database`; deze blijft bestaan na herstart. De lokale modus is bedoeld voor persoonlijk gebruik en ontwikkeling. Stop met Ctrl+C voordat je een kopie van `.local` maakt. `.local` bevat ook de privésleutel voor lokale pushmeldingen en hoort nooit in Git.

Er zijn geen vaste gezinsleden, voorbeeldafspraken of standaardwachtwoorden in de app. De eerste gebruiker krijgt eventueel aanwezige oude agenda’s zonder leden toegewezen. Maak daarom het eerste account voordat je een gemigreerde installatie publiek bereikbaar maakt.

## Functies

- Accounts met gehashte wachtwoorden en intrekbare sessies in HttpOnly-cookies.
- Meerdere agenda’s; delen met bestaande accounts met lees-, bewerk- of beheerdersrechten.
- Personen met een eigen kleur en initialen; meerdere personen per afspraak.
- Dag-, week- en maandweergave, navigatie, zoeken en personenfilter.
- Afspraken aanmaken, bewerken en verwijderen, met begin/einde, locatie en notities.
- Dagelijkse, wekelijkse, maandelijkse en jaarlijkse herhaling; intervallen, weekdagen, aantallen en einddatums via iCalendar-regels.
- Een hele reeks of één voorkomen bewerken/verwijderen; behoud van lokale tijd over zomertijd/wintertijd.
- Bestanden per afspraak (maximaal 10 bestanden, maximaal 5 MB per bestand). Bestanden staan in de database en volgen dezelfde agendarechten.
- Automatisch verversen tussen apparaten, elke 15 seconden als de agenda zichtbaar is.
- Herinneringen in een geopende agenda en Web Push voor meldingen op de achtergrond.
- iCalendar-bestanden importeren/exporteren. Dezelfde UID opnieuw importeren werkt een afspraak bij.
- Externe HTTPS/webcal-agenda’s koppelen, elke 15 minuten verversen, met foutstatus en handmatige verversing. Externe afspraken zijn alleen-lezen.
- Responsieve webinterface, toetsenbordbediening en installatie als webapp via het browsermenu.

Zenda gebruikt PostgreSQL als leidende opslag. Externe koppelingen gebruiken iCalendar-abonnementen. Er is geen tweerichtings-CalDAV-adapter of Google/Microsoft-OAuth-koppeling. Dit was in het contextdocument een open architectuurkeuze; de bestaande REST/Prisma-architectuur is voortgezet.

## Bestaande PostgreSQL-installatie gebruiken

De bestaande `api/.env` en het bestaande `docker-compose.yml` zijn niet overschreven. Maak eerst een databaseback-up. Controleer `DATABASE_URL` en voer uit:

```powershell
npm --prefix api run generate
npm --prefix api run migrate
npm run dev
```

De nieuwe migraties voegen sessies, bestanden, herinneringen, uitzonderingen en externe koppelingen toe. Ze verwijderen geen bestaande agenda’s of afspraken. Een historische migratie die al eerder mislukt was, moet eerst afzonderlijk worden hersteld; gebruik geen database-reset op bestaande gegevens.

## Hosting met Docker

`compose.production.yml` bevat PostgreSQL 17, een migratieservice, de API en de webapp. De bestaande ontwikkelcontainer en het bijbehorende volume blijven apart.

1. Kopieer `.env.example` naar `.env` en vul een lang willekeurig databasewachtwoord en `APP_ORIGIN` in.
2. Gebruik voor `APP_ORIGIN` de exacte publieke HTTPS-origin, zonder afsluitende slash. Meerdere origins mogen kommagescheiden. Voor de database-URL gebruikt dit voorbeeld een wachtwoord met letters en cijfers; andere tekens moeten URL-gecodeerd worden.
3. Start:

```powershell
docker compose -f compose.production.yml up -d --build
```

4. Zet een HTTPS-reverse-proxy, bijvoorbeeld Caddy of nginx, voor `127.0.0.1:3000`. API en database hebben geen publieke poort. De productiesessie gebruikt een Secure-cookie en vereist HTTPS.
5. Maak je eerste account en deel de agenda vanuit **Agenda delen**.

Maak regelmatige PostgreSQL-back-ups met `pg_dump`. Bestanden en accountgegevens zitten in dezelfde database. Test ook het terugzetten van back-ups. De lokale PGlite-map is geen `pg_dump`-bestand; gebruik lokaal de agenda-export voor het overzetten van afspraken, of begin productie met een nieuwe database.

## Meldingen instellen

De lokale startopdracht maakt automatisch VAPID-sleutels aan. Voor hosting genereer je een eigen paar:

```powershell
node api/node_modules/web-push/src/cli.js generate-vapid-keys
```

Vul `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` en `VAPID_SUBJECT` in. De subject is een beheerderadres zoals `mailto:beheerder@example.nl`. Bewaar de privésleutel als geheim. Klik daarna per apparaat op **Meldingen instellen** en geef de browser toestemming.

De API controleert elke 30 seconden welke herinneringen verschuldigd zijn. De server moet draaien; bij langere uitval worden oude meldingen niet alsnog verzonden. Werkelijke aflevering is afhankelijk van browser, apparaat en pushdienst. Voor mobiele browsers is HTTPS nodig; sommige vereisen installatie op het beginscherm. De webapp bewaart geen offline wijzigingen.

## Externe agenda’s

Onder **Externe agenda’s** kun je een rechtstreekse iCalendar-abonnementslink toevoegen. Alleen publieke HTTPS-adressen op poort 443 worden opgehaald; interne IP-adressen, URL-wachtwoorden en redirects worden geweigerd. De gevalideerde DNS-uitkomst wordt vastgezet bij de verbinding. Geheime abonnementslinks zijn alleen server-side beschikbaar.

Een bestand mag maximaal 2 MB en 1000 afspraken bevatten. Normale RRULE-, EXDATE-, RECURRENCE-ID- en RDATE-datums worden verwerkt. RDATE-periodes, THISANDFUTURE-wijzigingen, meerdere RRULE’s per afspraak en tijdzones die niet door Intl worden herkend, geven een expliciete importfout. Een mislukte abonnementsverversing bewaart de laatst geslaagde gegevens. Een bestandimport verwijdert niet automatisch afspraken die uit een later bestand ontbreken; een abonnement doet dat wel.

## Ontwikkeling en controles

```powershell
npm run check
npm test
npm run build
```

`npm test` gebruikt een nieuwe tijdelijke database in het geheugen op poort 55433 en een tijdelijke API op poort 3011. Je eigen database wordt niet gebruikt. De integratietest controleert accountregistratie, sessies, rechten, agenda-isolatie, validatie, herhaling rond wintertijd, losse voorkomens, bestanden, import/export en het intrekken van toegang. Unit-tests controleren maandultimo, schrikkeldagen, bereikoverlap, uitsluitingen, tijdzones en blokkeren van interne feedadressen.

De productiebuild, typecontrole en lintcontrole zijn afzonderlijke controles. Een geslaagde lokale test bewijst geen productiehosting of aflevering via een echte pushdienst. Docker-hosting en providers moeten in de eigen hostingomgeving worden getest.

## Structuur

- `web/`: Next.js/React-interface en proxy naar de API.
- `api/src/server.ts`: REST-routes, authenticatie, rechten en validatie.
- `api/src/calendar/`: herhaling, iCalendar en externe koppelingen.
- `api/src/notifications.ts`: pushabonnementen en herinneringen.
- `api/prisma/`: PostgreSQL-schema en migraties.
- `scripts/dev.mjs`: lokale startopdracht met blijvende opslag.
- `compose.production.yml`: afzonderlijke hostingconfiguratie.

Licentie: MIT. Zenda zelf bevat geen advertenties, abonnementen of betaalde functies.
