# Stark Supply mobile

React Native / Expo app for the existing Stark Supply shop. The app obtains the
public Supabase configuration from the website, signs in to the same Auth project,
and uses the same products API, `cart_items` REST endpoints, checkout API and
order-history tables. No service-role or Mailgun keys belong in this app.

## Required setup (existing Supabase project)

1. Run `supabase/migrations/20261005000000_cart_realtime.sql` in Supabase's SQL
   editor. **Do not rerun `schema.sql`**; it creates the original shop tables.
2. In Authentication → URL Configuration → Redirect URLs, add exactly:
   `starksupply://auth/callback`. Keep the website's existing redirect URLs.
   Google Cloud's authorised callback stays the existing Supabase HTTPS callback;
   no new Google client secret or Android Google credential is needed for this
   browser-based PKCE flow.
3. Merge the PR / deploy the updated website through the existing Cloudflare
   workflow. The web changes are needed for mobile → website live updates and
   repeat login to the same existing Google account.

The migration adds a private, RLS-protected `cart_versions` table and an automatic
trigger for all cart inserts, updates and deletes. Clients subscribe to their own
version row and refetch their own `cart_items`; checkout deletion also emits a
signal. Clients remove old subscriptions on logout and refetch on reconnect and
foreground resume. There is no periodic polling. Realtime needs an online,
foreground app; backgrounded apps catch up when reopened.

## Android APK (no Android Studio or Expo account required)

Open the **Mobile Android APK** workflow in GitHub Actions. It runs on this PR and
on mobile changes merged into main. After a successful run, download the
`stark-supply-android-apk` artifact ZIP. Extract `app-release.apk`, transfer it to
Samsung, open it and allow that file source to install apps if Android asks.

This task-demo APK targets ARM64 phones (including the Samsung S21) and uses the generated Expo debug signing key. It runs without a
Metro server. Use your own signing credentials for a Play Store release. The
workflow uploads the APK for 7 days. A manual **Run workflow** is also available
after the workflow is on the default branch.

Alternative with an Expo account:

```sh
cd mobile
npm ci
npx eas-cli@latest build --platform android --profile preview
```

Local Android development (Android SDK required):

```sh
cd mobile
npm ci
npx expo run:android
```

Use the installed APK for the required OAuth test. Expo Go does not register this
app's `starksupply` scheme and is not the supported Google-login testing path.

## Physical Samsung test (must be performed; not claimed by automated tests)

1. Open the deployed website on your computer and sign in with Google.
2. Open the installed app → Account → Continue with Google. Select **the same
   Google account**. Check the app shows your email and the same saved cart.
3. Keep the app in the foreground on Bag. On the website add a product. Confirm it
   appears on the phone without pulling to refresh or reopening the app.
4. On the website change quantity, then remove the item. Confirm both updates
   appear on the phone. On the phone add/change/remove an item and check the
   website bag updates without a page reload.
5. Close/reopen the app. Check your login survives and the saved cart is restored.
6. Briefly disable internet, change the website cart, then reconnect/reopen the
   phone app. Confirm the current cart is fetched again.
7. Optional: checkout on the app using the existing verified Mailgun recipient.
   Confirm order history on both devices and the cleared cart on the website.
8. Sign out on the phone. Confirm the previous account's bag disappears and the
   website stays signed in. A second Google account must never see the first
   account's cart.

Record a short screen video showing the physical phone, matching Google account,
and website → phone cart change. Only mark the requirement complete after that
physical test passes.

## Verification

```sh
cd mobile
npm run typecheck
npm run lint
npm test
npm run export:android
```

Tests cover overlapping cart reads, account-switch disposal, recovery after a
failed read, and OAuth callback route validation. The Android bundle/build checks
cover native imports; they do not replace Google login or physical-device tests.

Configuration: optionally copy `.env.example` to `.env.local` and set
`EXPO_PUBLIC_SHOP_URL` if the website URL changes. This URL is public. Do not add
server secrets or access tokens to source code.
