import { callbackCode } from "./oauth-callback";
import * as WebBrowser from "expo-web-browser";
import { type SupabaseClient } from "@supabase/supabase-js";
import { CALLBACK_URL } from "./config";
WebBrowser.maybeCompleteAuthSession();

// PKCE ties the callback code to the app that initiated login. Accept only our
// callback route and never log a callback containing credentials.
const exchanging = new Map<string, Promise<void>>();
export async function finishLogin(client: SupabaseClient, url: string) {
  const code = callbackCode(url);
  if (!code) return;
  // Android Linking and openAuthSessionAsync may deliver the same callback.
  if (!exchanging.has(code)) {
    const promise = (async () => {
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
    })();
    exchanging.set(code, promise);
    // Keep the completed entry for duplicate delivery, bounded to this app run.
    if (exchanging.size > 8) exchanging.delete(exchanging.keys().next().value!);
  }
  await exchanging.get(code);
}
export async function googleLogin(client: SupabaseClient) {
  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: CALLBACK_URL,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Google sign-in could not start.");
  const result = await WebBrowser.openAuthSessionAsync(data.url, CALLBACK_URL);
  if (result.type === "success") await finishLogin(client, result.url);
}
