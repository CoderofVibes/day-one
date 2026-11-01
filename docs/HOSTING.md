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

## Recommended host: Cloudflare Pages, direct upload

- **Why:** Tony already has a Cloudflare account (the muse-claude-bridge relay runs on `coderofvibes.workers.dev`, logged in with `wrangler login` on the dev PC). Direct upload with Wrangler needs no Git connection, so the private repo stays private.
- **Limits that matter** (developers.cloudflare.com/pages/platform/limits, checked Oct 29): 20,000 files per site and 25 MiB per file on the free plan; direct uploads are not builds, so the 500 builds a month do not apply. We upload 11 files.
- **How long it stays up:** a Pages deployment stays until it is deleted. Nothing to renew for Nov 18 or Nov 25.
- **URL:** `https://day-one-kevin.pages.dev` (the project name in `scripts/host-build.ts`; any free name works).
- **Kept out of search:** `_headers` sends `X-Robots-Tag: noindex`, so the page is reachable by link but not indexed while the repo is private.

## Steps for Tony (about 5 minutes)

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
