# Hosted demo — ready to deploy, not published

**Status (Oct 29):** everything is prepared and checked; nothing is online. Going live on a public URL is Tony's call (AGENTS.md hard rule 2, OPEN_QUESTIONS #39). Organizer rule Q-012: keep a hosted demo up until Nov 18, ideally Nov 25.

## What a judge gets from one link

The static replay of the recorded testnet run (`web/dist`, about 2.6 MB, 15 files since the v2 pages), no keys, no wallet, no server:

- the plant floor step by step (Play, Back/Next, the arrow keys), with a short guide on first visit;
- the flat map or the 3D twin (the "3D" button, or `?view=3d`);
- **Behind the curtain**: every one of the 13 testnet transactions with signer, who paid the gas, refusal text and an explorer link, and the attestation of Kevin's model;
- **Three plants**: stock by plant, the Plant A discrepancy, Kevin's proposed moves between plants, the mass balance (Riverside's waste gap) and the books, as the ledger stands at the end of the run (read-only), with Kevin's printable 5am brief (`brief.html`) and the bookkeeper CSV (`books.csv`);
- the video page, `?video=1` (`&view=3d`), which plays the storyboard on its own clock (docs/RECORDING.md).

The explorer links go to `testnet.nearblocks.io`, so a judge can check every claim on chain from the page.

## Why static, and not the live API

| | Static replay (recommended) | The API (`npm run api`) on a small server |
|---|---|---|
| What a judge sees | the recorded run, every screen above | the same run click by click, plus Apply/Approve buttons and the import wizard |
| Visitors at once | any number, each with their own page | **one shared run**: two judges clicking at the same time take each other's turns (the API holds one demo session) |
| Keys on the host | none | none in replay mode, but a host that can run `--live` is one flag away from signing on testnet |
| Uptime | a CDN, no sleep | free tiers sleep after idle minutes; first click waits for a cold start |
| Cost and accounts | free; Tony's existing Cloudflare account | a free Node host account (Render, Koyeb) with a sleeping instance |

The API adds two things a judge could not get from the static page: the import wizard and pressing the buttons. Both run from a clean clone with `npm run api` (README), so the hosted page does not need them. **Recommendation: host the static replay only.**

## Host: Vercel (Tony, Nov 11: one host for both projects)

- **How:** the Vercel CLI uploads the built `web/dist` from a folder named `day-one-kevin` (the project name), with the `vercel.json` that `npm run host:build` writes (the same headers as `_headers`). No Git connection, so the private repo stays private.
- **Private until Friday:** with Vercel's default Deployment Protection, a deployment's own address (`day-one-kevin-<id>-coderofvibes.vercel.app`) opens only for someone signed in to Tony's Vercel account; anyone else is sent to a Vercel sign-in page. Only the project's public name, `https://day-one-kevin.vercel.app`, is open to all.
- **What happened Nov 11:** a project's **first** deployment always goes to production and takes the public name, even with `--environment preview`. It did so twice; each time the public name was taken down within about a minute (the first time by removing the project, the second by `vercel alias rm day-one-kevin.vercel.app`). Now the project `day-one-kevin` exists with one deployment, `https://day-one-kevin-fbfw1xthl-coderofvibes.vercel.app` (checked anonymously: 302 to Vercel's sign-in), and the public name answers 404. Later deploys without `--prod` are previews, also locked.
- **Friday, to go public:** `npm run host:build`, copy `web/dist` into a folder named `day-one-kevin` linked to the project (`vercel link --yes --project day-one-kevin`), then `vercel deploy --prod --yes` there. If `https://day-one-kevin.vercel.app` still answers 404, attach it: `vercel alias set <the deployment address> day-one-kevin.vercel.app`. Then open it signed out.
- **Kept out of search:** `X-Robots-Tag: noindex` on every file, so even the public address is reachable by link, not by search, until the repo is public.
- **How long it stays up:** until it is deleted. Nothing to renew for Nov 18 or Nov 25.

The Cloudflare steps below were the plan until Nov 11 and still work as a fallback.

## Steps for Tony on Cloudflare (fallback)

1. From the repo root on the branch that will be submitted:

   ```bash
   npm run host:build
   ```

   It checks the web data matches the recording, builds `web/dist`, writes `_headers` and refuses if any file holds a key, a token or a value from `.env` that `.env.example` does not carry (the example is committed, so an account id, RPC URL or model id in it is public already; a refusal names the key, never the value). It ends with `web/dist is ready to publish` and the deploy command. Nothing is published.

2. Publish (the only step that puts it online):

   ```bash
   npx --yes wrangler@4.152.0 pages deploy web/dist --project-name day-one-kevin --branch main
   ```

   The first time, Wrangler asks to create the project (answer yes, production branch `main`). If it asks to log in, it opens the browser for the Cloudflare account the bridge uses.

3. Open the URL it prints, press Play, switch on Behind the curtain and 3D, and open one explorer link.

4. After any re-record (`npm run web:data` changes), repeat steps 1–2; the URL stays the same.

**To take it down:** `npx --yes wrangler@4.152.0 pages project delete day-one-kevin`.

## Fallbacks

- **Netlify Drop:** drag the `web/dist` folder onto app.netlify.com/drop (free Netlify account). Same files; `_headers` works there too.
- **GitHub Pages:** only once the repo is public (Pages from a private repo needs a paid plan).
- **No hosted demo:** the video and the README's keyless commands carry the demo; Q-012 asks for a hosted demo only if there is one.
