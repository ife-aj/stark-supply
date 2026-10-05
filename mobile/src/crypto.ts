import "fast-text-encoding";
import * as ExpoCrypto from "expo-crypto";

// Provide the two WebCrypto operations Supabase uses for S256 PKCE on native.
// Retain the platform implementation whenever it already supplies them.
type PkceCrypto = {
  getRandomValues: typeof ExpoCrypto.getRandomValues;
  subtle?: {
    digest: (
      algorithm: string,
      data: ArrayBuffer | ArrayBufferView,
    ) => Promise<ArrayBuffer>;
  };
};
const runtime = globalThis as unknown as { crypto?: PkceCrypto };
if (!runtime.crypto)
  runtime.crypto = { getRandomValues: ExpoCrypto.getRandomValues };
if (!runtime.crypto.getRandomValues)
  runtime.crypto.getRandomValues = ExpoCrypto.getRandomValues;
if (!runtime.crypto.subtle) {
  runtime.crypto.subtle = {
    digest(algorithm, data) {
      if (algorithm !== "SHA-256")
        throw new Error("This native digest adapter supports SHA-256 only.");
      return ExpoCrypto.digest(
        ExpoCrypto.CryptoDigestAlgorithm.SHA256,
        data as Parameters<typeof ExpoCrypto.digest>[1],
      );
    },
  };
}
