import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { connectShop } from "../../api";
import { finishLogin } from "../../auth";
import { CALLBACK_URL, message } from "../../config";
export default function Callback() {
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (params.error)
          throw new Error(params.error_description || params.error);
        if (!params.code)
          throw new Error("Sign-in did not return a code. Please try again.");
        const { client } = await connectShop();
        await finishLogin(
          client,
          CALLBACK_URL + "?code=" + encodeURIComponent(params.code),
        );
        if (alive) router.replace("/");
      } catch (e) {
        if (alive) setError(message(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.code, params.error, params.error_description]);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#f5f7f3",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        gap: 20,
      }}
    >
      {error ? (
        <>
          <Text>{error}</Text>
          <Pressable onPress={() => router.replace("/")}>
            <Text style={{ color: "#426024" }}>Return to shop</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color="#426024" />
          <Text>Finishing Google sign-in…</Text>
        </>
      )}
    </View>
  );
}
