import { AvenzoApiClient } from "@avenzo/api-client";
import { getToken } from "./tokenStore";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:5000";

// Singleton — always passes getToken synchronously from the module-level cache in tokenStore.
export const apiClient = new AvenzoApiClient({ baseUrl, getToken });
