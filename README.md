# Stark Supply — HNG shop task

A responsive React + TypeScript shop, built with Vinext (Next.js-compatible routes) for Cloudflare Workers. Supabase stores products, profiles, carts, orders and order items. Google authentication uses a Google Cloud OAuth client through Supabase Auth. Server routes create orders and send Mailgun receipts. Prices use integer kobo; payment is cash on delivery because the task did not request a payment gateway.

## Deployment status

The original hosted shop has passed a real Google login, checkout and Mailgun receipt test. This repository is prepared for your own Cloudflare account; it needs its own deployment and runtime secrets.

## 1. Supabase

1. Create a Supabase project, then run `supabase/schema.sql` once in SQL Editor. The script creates tables, RLS policies, auth profile sync, checkout transaction and four demo products.
2. Under Authentication, enable anonymous sign-ins (used for persistent guest bags). Enable **manual identity linking** so Google login can upgrade the anonymous shopper without losing their bag. Enable CAPTCHA for anonymous sign-ins before opening the shop to the public, and wire the configured CAPTCHA token into `signInAnonymously` if enabled.
3. Copy the project URL, publishable/anon key and legacy service-role key to the environment below. Never expose the service-role key in the frontend or Git.
4. Set Auth Site URL to your published origin and add the origin and `/checkout` and `/orders` URLs to the redirect allow list. For development add the equivalent localhost URLs.

## 2. Google Cloud Console

1. Create/select a project. Open Google Auth Platform and configure app branding, audience and contact email. Request only basic identity scopes (`openid`, `email`, `profile`).
2. Create an OAuth client of type **Web application**. Set authorized JavaScript origin to your published origin.
3. Set authorized redirect URI to `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`. Use the exact callback displayed in Supabase's Google provider settings.
4. Enable Google in Supabase Auth providers. Paste the Google client ID and client secret there, not into frontend code.
5. While Google's app is in testing, add your test users. Test with the account you will use for your HNG demo.

## 3. Mailgun

1. Create a Mailgun account and sending domain. For a sandbox, add and verify each recipient who will receive test receipts. A sandbox cannot email arbitrary recipients.
2. For a custom domain, complete Mailgun's DNS verification.
3. Create a domain sending key. Choose US or EU to match the domain's region.
4. Set the environment values. `MAILGUN_FROM` must use your Mailgun sending domain.

## Environment

Copy `.env.example` to `.env` for local development. Set the same variables as runtime secrets in the published site's environment settings. The public config endpoint returns only Supabase URL and anon key. All database administration and Mailgun credentials stay on the server.

```
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=your-legacy-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-legacy-service-role-key
MAILGUN_API_KEY=your-domain-sending-key
MAILGUN_DOMAIN=sandbox-example.mailgun.org
MAILGUN_FROM=Stark Supply <orders@sandbox-example.mailgun.org>
MAILGUN_REGION=US
```

## Development

Requires Node 22.13+ and pnpm. Run `pnpm install`, then `pnpm dev`. `pnpm build` generates the Cloudflare Worker; `pnpm typecheck` checks TypeScript. `pnpm deploy` publishes to your Cloudflare account after `pnpm exec wrangler login`. See CLOUDFLARE.md for the dashboard workflow.

## Verify before submitting

- Browse and filter products on desktop and mobile.
- Add items while anonymous, reload, and confirm the bag is restored from Supabase.
- Continue with Google and confirm the bag remains. Test a returning Google account too; existing-identity linking can require signing out and signing in again. Guest cart merging across separate existing accounts is not implemented.
- Checkout with valid details. Confirm one row in `orders`, its snapshots in `order_items`, and an empty saved cart.
- Confirm the Mailgun receipt arrives at an authorized recipient and the order email status is `sent` (this means Mailgun accepted it, not that delivery is guaranteed).
- Retry the same request ID and confirm no second order is created. Email failures can be retried from the confirmation screen or My orders.
- Sign in as a different account and verify RLS prevents reading other carts and orders.
- Check invalid/expired auth, invalid form data and unavailable integrations. The client never supplies order prices or totals to the server.
- Verify the new Cloudflare URL in incognito before HNG submission.

## Reliability limits

Order creation, item snapshots and cart deletion share a Postgres transaction. Checkout retries use a user-scoped idempotency key; concurrent order creation is serialized per user. Email is a separate operation and its failure never deletes an order. A conditional database claim prevents concurrent sends; a process interruption after claiming an email can leave `sending` status. Inspect Mailgun logs before resetting such a record to `failed`, because delivery after a timeout is ambiguous. This project has no background email worker or stock management.

## Project map

- `app/shop.tsx`: storefront, bag, checkout, Google login, orders.
- `app/api/config`: public runtime settings only.
- `app/api/products`: database catalog, or explicit preview catalog before setup.
- `app/api/checkout`: auth verification, delivery validation, transactional order creation, Mailgun receipt.
- `supabase/schema.sql`: database setup and access policies.
- `lib/catalog.ts`: preview products and shipping display rules (database computes authoritative totals).

Product images are demo assets retrieved from PNGkit (Beats Mixr), Keychron (V2), Walmart (onn mouse) and Treoo (JBL Flip). Replace them with your shop's licensed photography before commercial use. Demo prices are illustrative.

## Mobile app (Lesson 3)

The Expo Android/iOS source lives in `mobile/`. See [mobile/README.md](mobile/README.md)
for the existing-project Supabase migration, mobile Google redirect, APK build,
and physical-phone cart-sync test. The website now subscribes to the same private
cart-change signals as the mobile app.
