<br/>
<div align="center">
    <h1 align="center">
        Almanach
    </h1>
    <br>
    <a href="https://github.com/chteau/almanach">
        <img src="assets/brand/almanach-logo.svg" alt="Almanach logo" width="100">
    </a>
    <br>
    <br>
    <p align="center"><i>Every freelance deadline in one place, on your own server.</i></p>
    <div align="center">
        <img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun Badge" />
        <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Badge" />
        <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React Badge" />
        <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL Badge" />
        <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Badge" />
        <img src="https://img.shields.io/badge/License-AGPL--3.0-green?style=for-the-badge" alt="AGPL-3.0 License Badge" />
    </div>
    <br/>
    <p align="center"><a href="README.md">Français</a> · English</p>
</div>

Almanach is a free, self-hosted dashboard for freelancers: clients, missions, quotes, invoices,
time tracking, and above all every administrative deadline of your country (returns,
contributions, VAT thresholds), with how much to set aside.

The tools that know your obligations are paid online services that keep your data. The free
tools don't know your country's rules. Almanach does both.

<p align="center">
    <img src="docs/screenshots/desktop-30-tableau-de-bord.png" alt="Almanach dashboard" width="800">
</p>

## Status

In development, close to 1.0, no release yet. France is the reference country: its 2026 rules
are **verified**, and every figure cites its official source and the date it was checked.
The UK is verified too (2026-27 tax year, against gov.uk). Germany and the US are
**experimental**, and the app says so at sign-up. The full
picture is in the [specification](docs/cahier-des-charges.md) (French).

| Country | Pack | What it covers |
|---|---|---|
| France | Verified | Micro-entreprise (BNC, BIC services and sales), monthly or quarterly URSSAF, versement libératoire, ACRE, CIPAV, CFE, VAT exemption |
| Germany | Experimental | Freiberufler and Gewerbe, Kleinunternehmer, Umsatzsteuer-Voranmeldung, prepayments (ESt, GewSt) |
| United Kingdom | Verified | Sole trader, Self Assessment (registration, returns, payments on account), income tax with or without Scotland, Class 4 NIC, Making Tax Digital (quarterly), VAT threshold. Out of scope: partnerships, limited companies, flat rate scheme; estimates ignore expenses and the trading allowance |
| United States | Experimental | Sole proprietor and single-member LLC, self-employment tax, estimated taxes, Form 1040 |

## What it does

- **Never miss a deadline.** Calendar (month, week, list, agenda) of returns, payments, mission
  ends and invoices to chase. Reminders by e-mail, by ntfy, and an iCal feed for your calendar
  app.
- **Know how much to set aside.** The dashboard estimates the year's contributions and tax,
  tracks thresholds (micro ceiling, VAT exemption) and simulates "what if I invoice X more?".
- **Invoice properly.** Quotes, invoices, deposits and credit notes as PDFs, in French, English
  or German, with the legal mentions of your country and your client's. Numbering, logo, colour,
  layout and font are set in Settings. Changing the numbering after the first invoice waits for
  1 January, so the year's series stays unbroken.
- **Track your time.** Timer, manual entries, weekly grid, and one click to invoice the time not
  billed yet.
- **Follow your situation.** Change status or country from a given date: each deadline follows
  the situation of the period it covers. Ending your activity keeps the last returns and makes
  the account read-only.
- **Bring your clients.** CSV import from your previous tool, with a report of rejected lines
  before anything is imported ([format, French](docs/import-csv.md)).
- **Stay in control of the rules.** Pack updates are signed (Ed25519). A received update is never
  applied by itself: you read what changes, in plain words ("the rate goes from 25.6 % to 26 % on
  Jul 1, 2026"), then apply it or leave it for later. Back to the shipped pack in one click.
- **Keep your companies apart.** Several structures in one account (a micro-entreprise and a
  SASU, or a business in another country), each with its own clients, invoices, time, deadlines,
  thresholds and estimates. A second active French micro-entreprise triggers a warning: a person
  has only one, and activities are declared under the same SIRET.
- **Connect Stripe.** Stripe customers become clients of the company and collected payments become
  receipts linked to their client, with a read-only key ([details, French](docs/stripe.md)).
- **Link two instances.** One micro-entreprise, two activities tracked in two instances (one behind a
  VPN, one personal): ceilings, VAT franchise and alerts count the sum. Only monthly totals per tax
  category travel, through Ed25519-signed requests ([details, French](docs/federation.md)).
- **Add external sources.** Quotes and invoices from another tool, read from an `almanach-feed/1`
  HTTPS feed, read-only and tagged with their source; test sources and Stripe test mode stay out of
  every total ([details, French](docs/external-sources.md)).
- **Ask an AI assistant.** MCP server on `/mcp`, with personal tokens for read or read + drafts
  ([details, French](docs/mcp.md)).
- **Keep your data.** Full JSON export, re-import into a fresh instance. Two-factor
  authentication (TOTP), revocable sessions, lockout after repeated failures.

## Commitments

- Free and open source, forever, under the [AGPL-3.0](LICENSE).
- No hosted version, no paid plan, no telemetry.
- No outgoing request until an administrator turns it on (pack updates, new-release notice, Stripe sync, links between instances, external sources, MCP), in Settings or in the server configuration (`STRIPE_SYNC`, `FEDERATION`, `EXTERNAL_SOURCES`, `MCP`).

## Install

You need Docker and Docker Compose. It runs on a server, a NAS or a Raspberry Pi.

```sh
git clone https://github.com/chteau/almanach.git
cd almanach
cp .env.example .env   # then fill in your settings
docker compose up -d
```

Then open `http://localhost:8080`. The setup wizard asks for the token printed in the logs
(`docker compose logs almanach`), then creates the administrator account.

While migrations run at start-up, the server already answers with a maintenance page (503) that
reloads by itself.

### Configuration

Everything is optional.

| Variable | Purpose |
|---|---|
| `SMTP_URL` | Mail server for reminders (`smtps://user:password@host:465`). |
| `SMTP_FROM` | Sender of reminders. |
| `REMINDERS` | `false` turns the reminder job off (on by default, every 10 minutes). |
| `PACK_PUBLIC_KEYS` | Ed25519 public keys allowed to sign packs, comma-separated. Without them, no update is accepted and only the shipped packs are used. |
| `PACK_UPDATE_URL` | HTTPS folder serving `index.json` and signed packs. Checked once a day, only once an administrator turns it on in Settings. |
| `MAINTENANCE` | `true` serves only the maintenance page, for example while restoring a backup. |
| `SECRETS_KEY` | 32-byte key in base64 (`openssl rand -base64 32`) encrypting stored secrets (Stripe keys, private keys of links between instances). Without it, no Stripe key can be saved and no link created. |
| `RELEASE_CHECK_URL` | Endpoint asked once a day for a new release, only once an administrator turns it on. |
| `STRIPE_SYNC` | `true` allows Stripe syncs on the instance, like the box in **Settings → Instance** (then shown checked and locked). When absent, the box decides. Each company still turns it on with its own key. |
| `FEDERATION` | `true` allows links between instances, the same way. |
| `EXTERNAL_SOURCES` | `true` allows external document sources, the same way. |
| `MCP` | `true` opens the `/mcp` endpoint to personal access tokens, the same way. |
| `FEDERATION_INTERVAL_MINUTES` | Minutes between two automatic exchanges with linked instances (15 by default). A local change also triggers an exchange about thirty seconds later. |

### Publish a pack update

```sh
bun apps/server/src/cli/pack-keygen.ts keys/almanach.pem             # once; keep the private key offline
bun apps/server/src/cli/pack-sign.ts packs/fr keys/almanach.pem 3 "2027 rates" > fr-3.json
```

Import `fr-3.json` from **Settings → Country rule packs**, or publish it next to an `index.json`
(`{ "bundles": ["fr-3.json"] }`) in the `PACK_UPDATE_URL` folder. The number must go up with every
release: an instance always refuses a pack older than its own.

## Development

You need [Bun](https://bun.sh) 1.3 or newer, and PostgreSQL 16 for the end-to-end tests.

```sh
bun install
bun run lint && bun run typecheck && bun run test
E2E_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres bun run test:e2e
```

| Folder | Contents |
|---|---|
| `apps/server` | Hono API, PostgreSQL database (Drizzle), deadline engine, PDFs, reminders. |
| `apps/web` | React 19 interface, in French, English and German. |
| `packages/shared` | Zod schemas and calculations shared by the server and the interface. |
| `packs/` | Rules per country and per year, in YAML, every figure with its source. |
| `e2e/` | Playwright tests on desktop and mobile, with accessibility checks (axe). |

## Contributing

Contributions are welcome, especially **country packs** and **translations**. A tax rule must
cite its official source and the date it was checked, or it won't be accepted. A pack nobody has
verified stays marked experimental.

## Disclaimer

Almanach helps you not forget anything and gives **estimates**. It is not tax or accounting
advice: always check with your country's official sources, linked in the app.

## License

AGPL-3.0, see [LICENSE](LICENSE).
