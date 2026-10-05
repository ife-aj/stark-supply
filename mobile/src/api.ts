import "react-native-url-polyfill/auto";
import * as SecureStore from "expo-secure-store";
import {
  createClient,
  processLock,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { SHOP_URL, type Product } from "./config";

// SecureStore entries can have size limits. Chunk long sessions and write the
// manifest last; clean both old chunks and interrupted writes on the next save.
const CHUNK_SIZE = 1500;
const storage = {
  async getItem(key: string) {
    const count = await SecureStore.getItemAsync(key + ".count");
    if (!count) return null;
    const parts = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        SecureStore.getItemAsync(key + "." + i),
      ),
    );
    return parts.every((p) => p !== null) ? parts.join("") : null;
  },
  async setItem(key: string, value: string) {
    const previous = Number(
      (await SecureStore.getItemAsync(key + ".count")) || 0,
    );
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++)
      await SecureStore.setItemAsync(
        key + "." + i,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    await SecureStore.setItemAsync(key + ".count", String(count));
    for (let i = count; i < previous; i++)
      await SecureStore.deleteItemAsync(key + "." + i);
  },
  async removeItem(key: string) {
    const count = Number((await SecureStore.getItemAsync(key + ".count")) || 0);
    await SecureStore.deleteItemAsync(key + ".count");
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.deleteItemAsync(key + "." + i),
      ),
    );
  },
};
let cached: SupabaseClient | undefined;
export async function connectShop(): Promise<{
  client: SupabaseClient;
  products: Product[];
}> {
  const [configuration, listing] = await Promise.all([
    fetch(SHOP_URL + "/api/config", { signal: AbortSignal.timeout(15000) }),
    fetch(SHOP_URL + "/api/products", { signal: AbortSignal.timeout(15000) }),
  ]);
  if (!configuration.ok || !listing.ok)
    throw new Error("The shop is unavailable. Please try again.");
  const config = await configuration.json();
  const result = await listing.json();
  if (!config.configured || !config.url || !config.key)
    throw new Error("The shop backend is not configured.");
  if (result.error) throw new Error(result.error);
  if (!cached)
    cached = createClient(config.url, config.key, {
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        lock: processLock,
      },
    });
  return { client: cached, products: result.products };
}
