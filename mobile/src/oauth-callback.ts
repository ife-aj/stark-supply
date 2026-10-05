export function callbackCode(url: string): string | null {
  const callback = new URL(url);
  if (
    callback.protocol !== "starksupply:" ||
    callback.hostname !== "auth" ||
    callback.pathname !== "/callback"
  )
    return null;
  const error =
    callback.searchParams.get("error_description") ||
    callback.searchParams.get("error");
  if (error) throw new Error(error);
  return callback.searchParams.get("code");
}
