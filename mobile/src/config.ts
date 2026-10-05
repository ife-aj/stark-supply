export const SHOP_URL = (
  process.env.EXPO_PUBLIC_SHOP_URL ||
  "https://stark-supply.ifeoluwaadeyanju6.workers.dev"
).replace(/\/$/, "");
export const CALLBACK_URL = "starksupply://auth/callback";
export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image: string;
  tag: string;
};
export type CartItem = { product_id: string; quantity: number };
export const money = (kobo: number) =>
  "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });
export const imageUrl = (path: string) => new URL(path, SHOP_URL + "/").href;
export const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
