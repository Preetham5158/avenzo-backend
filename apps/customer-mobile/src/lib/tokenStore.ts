import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "avenzo_access_token";

// Synchronous cache — populated by restoreToken() on startup, updated by setToken() after login/logout.
// The api-client's getToken() reads from this cache synchronously.
let tokenCache: string | null = null;

export function getToken(): string | null {
  return tokenCache;
}

export async function setToken(token: string | null): Promise<void> {
  tokenCache = token;
  if (token) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}

// Call once on app startup before any authenticated API call.
export async function restoreToken(): Promise<string | null> {
  tokenCache = await AsyncStorage.getItem(TOKEN_KEY);
  return tokenCache;
}
