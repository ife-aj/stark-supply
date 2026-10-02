# Deploy Stark Supply to your Cloudflare account

## Create your account

Sign up at https://dash.cloudflare.com/sign-up and verify your email. You can deploy to a `workers.dev` subdomain without buying a domain. Use Workers, not a static Pages deployment: this shop has server-side checkout and email routes.

## Connect the repository

1. Open Workers & Pages, then Create application / Import a repository (the label may vary).
2. Connect GitHub and authorize access to `ife-aj/stark-supply`.
3. Select this repository and production branch `main`.
4. Name the Worker **stark-supply**. This must match `wrangler.jsonc`.
5. Set build command: `pnpm build`.
6. Set deploy command: `pnpm deploy`.
7. Leave root directory at the repository root. Use Node 22.13+ (Node 22) and the pnpm version in package.json.
8. Deploy. Public non-secret settings are already in `wrangler.jsonc`.

The initial deployment can render the storefront, but checkout stays unavailable until secrets are configured.

## Add runtime secrets

Open your Worker → Settings → Variables and Secrets. Add these as **Secret**, then deploy the changes:

- `SUPABASE_SERVICE_ROLE_KEY`: the existing working legacy service-role key.
- `MAILGUN_API_KEY`: the latest working Mailgun domain sending key.

Use your private keys from the setup files. Do not commit or upload those files to GitHub. Set these as runtime secrets, not just build variables.

## Update OAuth URLs

After deployment, copy the actual `https://stark-supply.YOUR_SUBDOMAIN.workers.dev` URL shown by Cloudflare.

In Supabase → Authentication → URL Configuration:

- Set Site URL to the new Cloudflare origin.
- Add the new origin plus `/checkout` and `/orders` to Redirect URLs. Keep the old working site in the allow list while testing.

In Google Cloud Console → Google Auth Platform → Clients → your Web OAuth client:

- Add the new Cloudflare origin to authorized JavaScript origins.
- Keep the Supabase redirect URI unchanged: `https://hzxhjpuxrvcdzwpjonok.supabase.co/auth/v1/callback`.

## Verify

Use your verified Mailgun recipient Google account. Add an item, sign in, check that the bag persists, place an order, check My orders and Gmail. Open the Cloudflare URL in incognito and on mobile. Submit the Cloudflare URL and GitHub repository once this passes.

Mailgun's sandbox sends only to verified authorized recipients. Google OAuth in testing mode permits test users only. These restrictions are independent of the site's public access.

## Automatic updates

Once the repository is connected, pushes to `main` build and deploy through Cloudflare Workers Builds.

## Local deployment alternative

```
pnpm install
pnpm typecheck
pnpm build
pnpm exec wrangler login
pnpm deploy
pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config dist/server/wrangler.json
pnpm exec wrangler secret put MAILGUN_API_KEY --config dist/server/wrangler.json
```

Paste secrets only into Wrangler's prompts. Do not put secret values into shell command arguments.
