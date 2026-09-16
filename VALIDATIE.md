# Validatie van Zenda

Uitgevoerd op Windows met Node.js 24.19.0, in een aparte tijdelijke database:

- Typecontrole van API en webapp.
- ESLint voor de webapp.
- Productiebuild met Next.js 16.3.5 en gecompileerde TypeScript-API.
- 11 kalendertests: wintertijd, maandultimo, schrikkeldagen, overlap, uitsluitingen, BYDAY/UNTIL, invoervalidatie, ICS-rondreis, gewijzigde/geannuleerde voorkomens, RDATE en interne feedadressen.
- HTTP-integratietest met echte Prisma/PostgreSQL-aanroepen: registratie, sessies, rollen, agenda-isolatie, personen, herhalingen, losse wijzigingen, bestanden, import/export, foutstatus bij geblokkeerde feedadressen, intrekken van rechten en uitloggen.
- Herinneringstest met database-opslag en een nagebootste pushdienst: één aflevering per voorkomen en geen meldingen na het intrekken van toegang.
- Familiebeheer: beheerde accounts krijgen één agenda; leden kunnen geen accounts beheren of extra familieagenda maken. Naamwijziging, wachtwoordreset met sessie-intrekking en accountverwijdering zijn getest. Gedeelde afspraken blijven bestaan na accountverwijdering.
- Privéagenda’s: aanmaken door een lezer, delen met gekozen leden, intrekken van toegang, weigeren van leden uit andere gezinnen, en blokkeren van details, bestanden, export en beheeracties voor niet-gerechtigden. Ook de familiebeheerder krijgt geen toegang tot een privéfeed zonder gekozen te zijn.
- Herinneringen volgen de externe-agendarechten, ook nadat een eigenaar de zichtbaarheid intrekt.
- Browsercontrole van de nieuwe indeling: externe agenda uitzetten, delen met een gezinslid, donker thema en accountaanmaak vanuit Agenda-instellingen.
- Browsercontrole: inloggen, persoon toevoegen, herhalende afspraak opslaan, één voorkomen aanpassen en weergave op 390 px breedte. Geen browserconsolefouten in deze controle.
- `npm audit`: beide pakketten zonder gemelde kwetsbaarheden na de updates. `deepmerge-ts` en `mysql2` zijn als indirecte Prisma-afhankelijkheden op gerepareerde versies vastgezet; Prisma-generatie en validatie zijn daarna opnieuw gecontroleerd.

## Praktische grenzen

- De Docker-configuratie is toegevoegd maar niet lokaal uitgevoerd; Docker is op deze machine niet beschikbaar via de shell.
- Echte Web Push-aflevering vereist toestemming op het apparaat en bereikbaarheid van een pushprovider. De automatische test verstuurt geen echte meldingen.
- De agenda-import is met fixtures getest. Een echte school-, Google- of Outlook-feed kan extra formaten gebruiken; fouten verschijnen bij de koppeling en overschrijven geen laatst geslaagde data.
- De oorspronkelijke PostgreSQL-database was niet bereikbaar. Bestaande gegevens zijn niet gemigreerd of overschreven.
- Externe koppelingen zijn iCalendar-abonnementen; tweerichtings-CalDAV en OAuth zijn niet geïmplementeerd.
