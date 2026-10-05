import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Order } from "../../lib/types";
import { createRefreshQueue } from "../../shared/cart-sync";
import { connectShop } from "./api";
import { finishLogin, googleLogin } from "./auth";
import {
  SHOP_URL,
  imageUrl,
  message,
  money,
  type CartItem,
  type Product,
} from "./config";
const emptyDetails = { name: "", phone: "", address: "", city: "", state: "" };
type Tab = "Shop" | "Bag" | "Account";
export default function App() {
  return (
    <SafeAreaProvider>
      <Store />
    </SafeAreaProvider>
  );
}
function Store() {
  const [client, setClient] = useState<SupabaseClient | null>(null),
    [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]),
    [cart, setCart] = useState<CartItem[]>([]),
    [orders, setOrders] = useState<Order[]>([]);
  const params = useLocalSearchParams<{
    tab?: Tab;
    product?: string;
    checkout?: string;
  }>();
  const tab: Tab = ["Shop", "Bag", "Account"].includes(params.tab || "")
    ? params.tab!
    : "Shop";
  const setTab = (next: Tab) => router.setParams({ tab: next });
  const selected = products.find((p) => p.id === params.product) || null;
  const setSelected = (next: Product | null) =>
    router.setParams({ product: next?.id || "" });
  const [category, setCategory] = useState("All essentials");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connection, setConnection] = useState("Connecting");
  const checkout = params.checkout === "1";
  const setCheckout = (next: boolean) =>
    router.setParams({ checkout: next ? "1" : "" });
  const [details, setDetails] = useState(emptyDetails),
    [receipt, setReceipt] = useState<Order | null>(null);
  const user = session?.user,
    signedIn = !!user && !user.is_anonymous,
    userId = signedIn ? user.id : undefined;
  const activeUser = useRef<string | undefined>(undefined);
  const realtimeJoined = useRef(false);
  const operation = useRef(false),
    requestId = useRef(""),
    refreshCart = useRef<() => Promise<void>>(async () => {});
  const count = cart.reduce((n, i) => n + i.quantity, 0),
    subtotal = cart.reduce(
      (n, i) =>
        n +
        (products.find((p) => p.id === i.product_id)?.price || 0) * i.quantity,
      0,
    ),
    fee = count && subtotal < 15000000 ? 250000 : 0;
  const applyShop = useCallback(
    async (shop: Awaited<ReturnType<typeof connectShop>>) => {
      const { data, error: authError } = await shop.client.auth.getSession();
      if (authError) throw authError;
      setProducts(shop.products);
      setClient(shop.client);
      activeUser.current = data.session?.user.is_anonymous
        ? undefined
        : data.session?.user.id;
      setDetails((current) => ({
        ...current,
        name: data.session?.user.user_metadata.full_name || "",
      }));
      setConnection(activeUser.current ? "Connecting" : "Sign in to sync");
      setSession(data.session);
    },
    [setProducts, setClient, setDetails, setConnection, setSession],
  );
  async function initialise() {
    setLoading(true);
    setError("");
    try {
      await applyShop(await connectShop());
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void connectShop()
      .then((shop) => {
        if (alive) return applyShop(shop);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [applyShop]);
  useEffect(() => {
    if (!client) return;
    let alive = true;
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      const nextId = next?.user.is_anonymous ? undefined : next?.user.id;
      if (activeUser.current !== nextId) {
        activeUser.current = nextId;
        setCart([]);
        setOrders([]);
        setReceipt(null);
        requestId.current = "";
        setDetails({
          ...emptyDetails,
          name: next?.user.user_metadata.full_name || "",
        });
        setConnection(nextId ? "Connecting" : "Sign in to sync");
      }
      setSession(next);
    });
    if (AppState.currentState === "active") client.auth.startAutoRefresh();
    const state = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        client.auth.startAutoRefresh();
        setConnection(realtimeJoined.current ? "Live" : "Connecting");
        void refreshCart.current();
      } else {
        client.auth.stopAutoRefresh();
        setConnection("Paused");
      }
    });
    const complete = (url: string) => {
      void finishLogin(client, url).catch((e) => {
        if (alive) setError(message(e));
      });
    };
    const links = Linking.addEventListener("url", (event) =>
      complete(event.url),
    );
    void Linking.getInitialURL().then((url) => {
      if (url && alive) complete(url);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      state.remove();
      links.remove();
      client.auth.stopAutoRefresh();
    };
  }, [client]);
  useEffect(() => {
    if (!client || !userId) return;
    const queue = createRefreshQueue(
      async () => {
        const { data, error: e } = await client
          .from("cart_items")
          .select("product_id,quantity")
          .eq("user_id", userId);
        if (e) throw e;
        return data || [];
      },
      setCart,
      (e) => {
        setConnection("Offline");
        setError(message(e));
      },
    );
    refreshCart.current = queue.refresh;
    const channel = client
      .channel(`mobile-cart:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cart_versions",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queue.refresh();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeJoined.current = true;
          setConnection("Live");
          void queue.refresh();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
          realtimeJoined.current = false;
          setConnection("Reconnecting");
        }
      });
    void queue.refresh();
    return () => {
      realtimeJoined.current = false;
      queue.dispose();
      refreshCart.current = async () => {};
      void client.removeChannel(channel);
    };
  }, [client, userId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!client || !userId || tab !== "Account") return;
    let alive = true;
    void client
      .from("orders")
      .select("*,items:order_items(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) setError("Order history could not be loaded.");
        else setOrders((data as Order[]) || []);
      });
    return () => {
      alive = false;
    };
  }, [client, userId, tab]);
  async function login() {
    if (!client || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await googleLogin(client);
    } catch (e) {
      setError(message(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function update(p: Product, quantity: number) {
    if (!signedIn) {
      setTab("Account");
      setNotice("Sign in with the same Google account as the website.");
      return;
    }
    if (!client || !userId || operation.current) return;
    const id = userId;
    quantity = Math.max(0, Math.min(20, quantity));
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      const result = quantity
        ? await client
            .from("cart_items")
            .upsert(
              { user_id: id, product_id: p.id, quantity },
              { onConflict: "user_id,product_id" },
            )
        : await client
            .from("cart_items")
            .delete()
            .eq("user_id", id)
            .eq("product_id", p.id);
      if (result.error) throw result.error;
      if (activeUser.current === id) {
        await refreshCart.current();
        if (quantity) setNotice(`${p.name} saved to your bag`);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function refresh() {
    setRefreshing(true);
    try {
      await refreshCart.current();
    } finally {
      setRefreshing(false);
    }
  }
  async function logout() {
    if (!client || operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const { error: e } = await client.auth.signOut({ scope: "local" });
      if (e) throw e;
    } catch (e) {
      setError(message(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  async function placeOrder() {
    if (!client || !userId || !count || operation.current) return;
    if (
      details.name.trim().length < 2 ||
      !/^[+\d\s()-]{7,25}$/.test(details.phone) ||
      details.address.trim().length < 5 ||
      details.city.trim().length < 2 ||
      details.state.trim().length < 2
    ) {
      setError(
        "Please complete your delivery details and enter a valid phone number.",
      );
      return;
    }
    operation.current = true;
    setBusy(true);
    setError("");
    const id = userId;
    try {
      const { data, error: e } = await client.auth.getSession();
      if (e || !data.session) throw new Error("Please sign in again.");
      if (!requestId.current) requestId.current = Crypto.randomUUID();
      // The server still verifies this bearer token with Supabase. Native fetch can
      // set Origin to the shop origin; browser requests retain the existing guard.
      const response = await fetch(SHOP_URL + "/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: SHOP_URL,
          Authorization: "Bearer " + data.session.access_token,
        },
        body: JSON.stringify({ ...details, requestId: requestId.current }),
        signal: AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Checkout failed. Retry with the same details.",
        );
      if (activeUser.current === id) {
        setReceipt(result);
        setCart([]);
        requestId.current = "";
        await refreshCart.current();
      }
    } catch (e) {
      setError(message(e));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  const quantity = (id: string) =>
    cart.find((i) => i.product_id === id)?.quantity || 0;
  const totals = (
    <View style={s.totals}>
      <View style={s.row}>
        <Text style={s.muted}>Subtotal</Text>
        <Text>{money(subtotal)}</Text>
      </View>
      <View style={s.row}>
        <Text style={s.muted}>Delivery</Text>
        <Text>{fee ? money(fee) : "Free"}</Text>
      </View>
      <View style={s.row}>
        <Text style={s.strong}>Total</Text>
        <Text style={s.price}>{money(subtotal + fee)}</Text>
      </View>
    </View>
  );
  return (
    <SafeAreaView style={s.screen} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View>
          <Text style={s.brand}>
            STARK<Text style={s.brandLight}> SUPPLY</Text>
            <Text style={s.orange}>®</Text>
          </Text>
          <Text style={s.headerSub}>GOOD GEAR. EVERY DAY.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open bag, ${count} items`}
          onPress={() => setTab("Bag")}
          style={s.badge}
        >
          <Text style={s.strong}>Bag · {count}</Text>
        </Pressable>
      </View>
      {error ? (
        <View style={s.error}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable
            accessibilityLabel="Dismiss error"
            onPress={() => setError("")}
          >
            <Text style={s.errorText}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      {notice ? (
        <View style={s.notice}>
          <Text style={s.noticeText}>{notice}</Text>
        </View>
      ) : null}
      {loading ? (
        <View style={s.empty}>
          <ActivityIndicator size="large" color="#426024" />
          <Text style={s.muted}>Getting your essentials…</Text>
        </View>
      ) : !client ? (
        <View style={s.empty}>
          <Text style={s.title}>Let’s reconnect.</Text>
          {
            <ActionButton
              label={"Try again"}
              onPress={() => {
                void initialise();
              }}
              secondary={false}
              disabled={false}
            />
          }
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor="#426024"
            />
          }
        >
          {tab === "Shop" ? (
            <>
              <Text style={s.eyebrow}>THE EVERYDAY COLLECTION / 01</Text>
              <Text style={s.hero}>
                Upgrade your{"\n"}
                <Text style={s.orange}>everyday.</Text>
              </Text>
              <Text style={s.description}>
                For the desk. For the commute. For whatever’s next.
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.categories}
              >
                {["All essentials", "Audio", "Workspace"].map((value) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: category === value }}
                    key={value}
                    onPress={() => setCategory(value)}
                    style={[s.chip, category === value && s.chipSelected]}
                  >
                    <Text
                      style={[
                        s.chipText,
                        category === value && s.chipSelectedText,
                      ]}
                    >
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {products
                .filter(
                  (p) =>
                    category === "All essentials" || p.category === category,
                )
                .map((p) => (
                  <View style={s.product} key={p.id}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View ${p.name}`}
                      onPress={() => setSelected(p)}
                      style={s.productImage}
                    >
                      <Text style={s.imageLabel}>
                        {p.category.toUpperCase()}
                      </Text>
                      <Image
                        source={{ uri: imageUrl(p.image) }}
                        style={s.image}
                        resizeMode="contain"
                      />
                      <Text style={s.imageTag}>{p.tag}</Text>
                    </Pressable>
                    <View style={s.productBody}>
                      <Text style={s.productName}>{p.name}</Text>
                      <Text style={s.muted}>{p.description}</Text>
                      <View style={s.productBottom}>
                        <Text style={s.price}>{money(p.price)}</Text>
                        {
                          <ActionButton
                            label={
                              quantity(p.id) >= 20
                                ? "Limit reached"
                                : "+ Add to bag"
                            }
                            onPress={() => {
                              void update(p, quantity(p.id) + 1);
                            }}
                            secondary={false}
                            disabled={busy || quantity(p.id) >= 20}
                          />
                        }
                      </View>
                    </View>
                  </View>
                ))}
              {!products.length && (
                <Text style={s.description}>
                  New essentials are on their way.
                </Text>
              )}
              <View style={s.perks}>
                <Text style={s.strong}>Delivered to your door.</Text>
                <Text style={s.muted}>
                  Free delivery from ₦150,000. Cash on delivery.
                </Text>
              </View>
            </>
          ) : tab === "Bag" ? (
            <>
              <Text style={s.eyebrow}>YOUR EVERYDAY ESSENTIALS</Text>
              <View style={s.row}>
                <Text style={s.title}>Your bag.</Text>
                <Text style={[s.sync, connection === "Live" && s.live]}>
                  ● {connection}
                </Text>
              </View>
              {!signedIn ? (
                <View style={s.panel}>
                  <Text style={s.productName}>One account. One bag.</Text>
                  <Text style={s.description}>
                    Sign in with the Google account you use on the website to
                    see your saved items here.
                  </Text>
                  {
                    <ActionButton
                      label={"Continue with Google"}
                      onPress={() => {
                        void login();
                      }}
                      secondary={false}
                      disabled={busy}
                    />
                  }
                </View>
              ) : !count ? (
                <View style={s.panel}>
                  <Text style={s.productName}>
                    A little room for good gear.
                  </Text>
                  <Text style={s.description}>
                    Your bag is empty. Find something that fits your everyday.
                  </Text>
                  {
                    <ActionButton
                      label={"Explore essentials"}
                      onPress={() => setTab("Shop")}
                      secondary={false}
                      disabled={busy}
                    />
                  }
                </View>
              ) : (
                <>
                  {cart.map((i) => {
                    const p = products.find((p) => p.id === i.product_id);
                    if (!p) return null;
                    return (
                      <View style={s.cartItem} key={p.id}>
                        <Image
                          source={{ uri: imageUrl(p.image) }}
                          style={s.cartImage}
                          resizeMode="contain"
                        />
                        <View style={s.cartBody}>
                          <Text style={s.strong}>{p.name}</Text>
                          <Text style={s.muted}>{money(p.price)}</Text>
                          <View style={s.quantity}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Reduce ${p.name} quantity`}
                              disabled={busy}
                              onPress={() => {
                                void update(p, i.quantity - 1);
                              }}
                              style={s.quantityButton}
                            >
                              <Text style={s.quantityText}>−</Text>
                            </Pressable>
                            <Text style={s.strong}>{i.quantity}</Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Increase ${p.name} quantity`}
                              disabled={busy || i.quantity >= 20}
                              onPress={() => {
                                void update(p, i.quantity + 1);
                              }}
                              style={s.quantityButton}
                            >
                              <Text style={s.quantityText}>+</Text>
                            </Pressable>
                          </View>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${p.name}`}
                          disabled={busy}
                          onPress={() => {
                            void update(p, 0);
                          }}
                          style={s.remove}
                        >
                          <Text style={s.muted}>✕</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                  <View style={s.panel}>
                    <Text style={s.strong}>
                      {subtotal >= 15000000
                        ? "You’ve unlocked free delivery."
                        : `${money(15000000 - subtotal)} away from free delivery.`}
                    </Text>
                    {totals}
                    {
                      <ActionButton
                        label={"Continue to checkout"}
                        onPress={() => {
                          setReceipt(null);
                          setCheckout(true);
                        }}
                        secondary={false}
                        disabled={busy}
                      />
                    }
                    <Text style={s.footnote}>
                      Cash on delivery. No upfront payment.
                    </Text>
                  </View>
                </>
              )}
            </>
          ) : (
            <>
              <Text style={s.eyebrow}>YOUR COLLECTION</Text>
              <Text style={s.title}>A familiar face.</Text>
              {!signedIn ? (
                <View style={s.panel}>
                  <Text style={s.productName}>Welcome to Stark Supply.</Text>
                  <Text style={s.description}>
                    Use the same Google account on web and mobile. Your bag and
                    order history stay together.
                  </Text>
                  {
                    <ActionButton
                      label={busy ? "Opening Google…" : "Continue with Google"}
                      onPress={() => {
                        void login();
                      }}
                      secondary={false}
                      disabled={busy}
                    />
                  }
                </View>
              ) : (
                <>
                  <View style={s.panel}>
                    <Text style={s.productName}>
                      {user.user_metadata.full_name || "Your account"}
                    </Text>
                    <Text style={s.description}>{user.email}</Text>
                    <Text style={[s.sync, connection === "Live" && s.live]}>
                      ● Cart sync: {connection}
                    </Text>
                    {
                      <ActionButton
                        label={"Sign out on this phone"}
                        onPress={() => {
                          void logout();
                        }}
                        secondary={true}
                        disabled={busy}
                      />
                    }
                  </View>
                  <Text style={s.subheading}>Your orders</Text>
                  {!orders.length ? (
                    <Text style={s.description}>No orders just yet.</Text>
                  ) : (
                    orders.map((o) => (
                      <View style={s.panel} key={o.id}>
                        <View style={s.row}>
                          <Text style={s.strong}>{o.reference}</Text>
                          <Text style={s.sync}>Confirmed</Text>
                        </View>
                        <Text style={s.footnote}>
                          {new Date(o.created_at).toLocaleDateString()}
                        </Text>
                        {o.items?.map((i, index) => (
                          <Text key={index} style={s.description}>
                            {i.name} × {i.quantity}
                          </Text>
                        ))}
                        <Text style={s.price}>{money(o.total)}</Text>
                        <Text style={s.footnote}>
                          Cash on delivery · {o.city}, {o.state}
                        </Text>
                      </View>
                    ))
                  )}
                </>
              )}
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(SHOP_URL);
                }}
              >
                <Text style={s.link}>Visit the website ↗</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}
      <View style={s.navigation}>
        {(["Shop", "Bag", "Account"] as Tab[]).map((value) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            key={value}
            onPress={() => setTab(value)}
            style={[s.navItem, tab === value && s.navSelected]}
          >
            <Text style={[s.navText, tab === value && s.orange]}>
              {value === "Bag" ? `Bag (${count})` : value}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={!!selected}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={s.screen}>
          <ScrollView contentContainerStyle={s.content}>
            {
              <ActionButton
                label={"← Back to essentials"}
                onPress={() => setSelected(null)}
                secondary={true}
                disabled={false}
              />
            }
            {selected && (
              <>
                <Text style={s.eyebrow}>{selected.category.toUpperCase()}</Text>
                <Image
                  source={{ uri: imageUrl(selected.image) }}
                  style={s.detailImage}
                  resizeMode="contain"
                />
                <Text style={s.title}>{selected.name}</Text>
                <Text style={s.description}>{selected.description}</Text>
                <Text style={s.price}>{money(selected.price)}</Text>
                {
                  <ActionButton
                    label={"+ Add to bag"}
                    onPress={() => {
                      void update(selected, quantity(selected.id) + 1);
                      setSelected(null);
                    }}
                    secondary={false}
                    disabled={busy || quantity(selected.id) >= 20}
                  />
                }
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={checkout}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setCheckout(false);
        }}
      >
        <SafeAreaView style={s.screen}>
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            {
              <ActionButton
                label={"← Back to bag"}
                onPress={() => setCheckout(false)}
                secondary={true}
                disabled={busy}
              />
            }
            {error ? <Text style={s.errorText}>{error}</Text> : null}
            {receipt ? (
              <>
                <Text style={s.eyebrow}>ORDER CONFIRMED</Text>
                <Text style={s.hero}>Good gear is{"\n"}on its way.</Text>
                <Text style={s.description}>
                  Thanks, {receipt.customer_name.split(" ")[0]}. Your order is
                  saved.
                </Text>
                <View style={s.panel}>
                  <Text style={s.strong}>{receipt.reference}</Text>
                  <Text style={s.price}>{money(receipt.total)}</Text>
                  <Text style={s.description}>Cash on delivery</Text>
                  <Text style={s.muted}>
                    {receipt.email_status === "sent"
                      ? "Your confirmation email has been sent for delivery."
                      : "Your order is confirmed. Your email receipt is pending."}
                  </Text>
                </View>
                {
                  <ActionButton
                    label={"View my orders"}
                    onPress={() => {
                      setCheckout(false);
                      setTab("Account");
                    }}
                    secondary={false}
                    disabled={busy}
                  />
                }
              </>
            ) : (
              <>
                <Text style={s.eyebrow}>THE FINAL STEP</Text>
                <Text style={s.title}>Make it yours.</Text>
                <Text style={s.description}>
                  Where should we send your essentials?
                </Text>
                {(["name", "phone", "address", "city", "state"] as const).map(
                  (field) => (
                    <View style={s.field} key={field}>
                      <Text style={s.strong}>
                        {
                          {
                            name: "Full name",
                            phone: "Phone number",
                            address: "Delivery address",
                            city: "City",
                            state: "State",
                          }[field]
                        }
                      </Text>
                      <TextInput
                        accessibilityLabel={field}
                        style={s.input}
                        value={details[field]}
                        onChangeText={(value) =>
                          setDetails((current) => ({
                            ...current,
                            [field]: value,
                          }))
                        }
                        keyboardType={
                          field === "phone" ? "phone-pad" : "default"
                        }
                        autoComplete={
                          field === "name"
                            ? "name"
                            : field === "phone"
                              ? "tel"
                              : field === "address"
                                ? "street-address"
                                : undefined
                        }
                        maxLength={
                          field === "address"
                            ? 300
                            : field === "phone"
                              ? 25
                              : 100
                        }
                        editable={!busy}
                      />
                    </View>
                  ),
                )}
                <Text style={s.description}>Receipt email: {user?.email}</Text>
                {totals}
                {
                  <ActionButton
                    label={
                      busy
                        ? "Saving your order…"
                        : `Place order · ${money(subtotal + fee)}`
                    }
                    onPress={() => {
                      void placeOrder();
                    }}
                    secondary={false}
                    disabled={busy || !count}
                  />
                }
                <Text style={s.footnote}>
                  Cash on delivery. No payment is taken now.
                </Text>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f5f7f3" },
  header: {
    paddingHorizontal: 22,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#e6e2da",
  },
  brand: {
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.7,
    color: "#222822",
  },
  brandLight: { fontWeight: "400" },
  orange: { color: "#426024" },
  headerSub: {
    fontSize: 9,
    letterSpacing: 1.5,
    marginTop: 4,
    color: "#777b73",
  },
  badge: {
    backgroundColor: "#efede6",
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  content: { padding: 22, paddingBottom: 36, gap: 16 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    color: "#777b73",
    marginTop: 10,
  },
  hero: {
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: -2.5,
    lineHeight: 51,
    color: "#222822",
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.4,
    color: "#222822",
  },
  description: { fontSize: 14, color: "#6c7168", lineHeight: 22 },
  muted: { color: "#777b73", fontSize: 12, lineHeight: 18 },
  categories: { flexGrow: 0, marginVertical: 5 },
  chip: {
    paddingHorizontal: 17,
    paddingVertical: 12,
    borderRadius: 25,
    marginRight: 8,
    backgroundColor: "#eeece5",
  },
  chipSelected: { backgroundColor: "#25372c" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#576052" },
  chipSelectedText: { color: "#fff" },
  product: {
    backgroundColor: "#fff",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e9e5dd",
    marginBottom: 6,
  },
  productImage: { height: 245, backgroundColor: "#eeece5", padding: 20 },
  image: { flex: 1, width: "100%", marginVertical: 10 },
  imageLabel: { fontSize: 9, letterSpacing: 1.5, color: "#7e8278" },
  imageTag: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: "#7e8278",
    textAlign: "center",
  },
  productBody: { padding: 20, gap: 5 },
  productName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#222822",
    letterSpacing: -0.5,
  },
  productBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    gap: 10,
  },
  price: { fontSize: 19, fontWeight: "700", color: "#26372c" },
  button: {
    backgroundColor: "#ceff74",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 13, fontWeight: "700", color: "#17201a" },
  secondary: { backgroundColor: "#ebe8df" },
  secondaryText: { color: "#26372c" },
  disabled: { opacity: 0.45 },
  perks: { paddingVertical: 20, gap: 5 },
  strong: { fontWeight: "700", fontSize: 13, color: "#26372c" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    padding: 25,
  },
  panel: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e9e5dd",
    borderRadius: 18,
    padding: 22,
    gap: 15,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  sync: {
    fontSize: 10,
    color: "#857055",
    backgroundColor: "#efebe1",
    padding: 7,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  live: { color: "#315d36", backgroundColor: "#e4efdf" },
  cartItem: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e9e5dd",
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },
  cartImage: {
    width: 70,
    height: 90,
    backgroundColor: "#efede6",
    borderRadius: 10,
  },
  cartBody: { flex: 1, gap: 5 },
  quantity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 5,
  },
  quantityButton: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: "#e7e3da",
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityText: { fontSize: 21, color: "#26372c" },
  remove: { padding: 10 },
  totals: {
    borderTopWidth: 1,
    borderTopColor: "#e9e5dd",
    paddingTop: 17,
    gap: 13,
  },
  footnote: { fontSize: 11, color: "#8a8d83", lineHeight: 18 },
  subheading: { fontSize: 21, fontWeight: "700", color: "#26372c" },
  link: { color: "#426024", fontWeight: "600", paddingVertical: 10 },
  navigation: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e6e2da",
    paddingHorizontal: 15,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: "#f5f7f3",
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: 12,
  },
  navSelected: { backgroundColor: "#e3f1d3" },
  navText: { fontSize: 13, fontWeight: "700", color: "#767c70" },
  error: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#fae9e5",
    flexDirection: "row",
    gap: 12,
  },
  errorText: { flexShrink: 1, color: "#973e2a", fontSize: 12, lineHeight: 19 },
  notice: { backgroundColor: "#26372c", padding: 12 },
  noticeText: { color: "#fff", textAlign: "center", fontSize: 12 },
  detailImage: {
    width: "100%",
    height: 300,
    backgroundColor: "#eeece5",
    borderRadius: 20,
  },
  field: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#dcd8ce",
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#fff",
    fontSize: 15,
    color: "#26372c",
  },
});
function ActionButton({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </Pressable>
  );
}
