export interface ApiClientConfig {
  baseUrl: string;
  getToken?: () => string | null;
  tokenKey?: string;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface ApiListResponse<T> {
  success: true;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ApiError {
  success: false;
  error: { code: string; message: string };
}

type ApiEnvelope = {
  success?: boolean;
  data?: unknown;
  error?: { message?: string };
  pagination?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class AvenzoApiClient {
  private baseUrl: string;
  private getToken: () => string | null;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    const key = config.tokenKey ?? "avenzo_access_token";
    this.getToken = config.getToken ?? (() => {
      if (typeof window === "undefined") return null;
      return sessionStorage.getItem(key);
    });
  }

  private async request<T>(
    path: string,
    options: RequestInit & { auth?: boolean } = {}
  ): Promise<T> {
    const { auth = true, ...fetchOptions } = options;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers as Record<string, string>),
    };
    if (auth) {
      const token = this.getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...fetchOptions, headers });
    const data: unknown = await res.json();
    const envelope: ApiEnvelope = isRecord(data) ? data : {};
    if (!res.ok) throw new Error(envelope.error?.message ?? "Request failed");
    if (typeof envelope.success === "boolean" && "data" in envelope) {
      if ("pagination" in envelope) return { items: envelope.data, pagination: envelope.pagination } as T;
      return envelope.data as T;
    }
    return data as T;
  }

  auth = {
    customerLogin: (email: string, password: string) =>
      this.request<{ accessToken: string; user: object }>("/api/v1/customer/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        auth: false,
      }),
    restaurantLogin: (email: string, password: string) =>
      this.request<{ accessToken: string; user: object; restaurant: object }>("/api/v1/restaurant/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        auth: false,
      }),
    me: () => this.request<object>("/api/v1/me"),
  };

  public_ = {
    getRestaurant: (slug: string) =>
      this.request<object>(`/api/v1/public/restaurants/${slug}`, { auth: false }),
    getMenu: (slug: string) =>
      this.request<{ items: object[]; pagination: object }>(`/api/v1/public/restaurants/${slug}/menu`, { auth: false }),
    lookupOrder: (params: Record<string, string>) =>
      this.request<object>(`/api/v1/public/orders/lookup?${new URLSearchParams(params)}`, { auth: false }),
  };

  orders = {
    create: (body: object) =>
      this.request<object>("/api/v1/customer/orders", { method: "POST", body: JSON.stringify(body) }),
    get: (trackingToken: string) =>
      this.request<object>(`/api/v1/customer/orders/${trackingToken}`),
    list: (params?: Record<string, string>) =>
      this.request<{ items: object[]; pagination: object }>(
        `/api/v1/customer/orders${params ? "?" + new URLSearchParams(params) : ""}`
      ),
    cancel: (trackingToken: string) =>
      this.request<object>(`/api/v1/customer/orders/${trackingToken}/cancel`, { method: "POST" }),
    rate: (trackingToken: string, body: object) =>
      this.request<object>(`/api/v1/customer/orders/${trackingToken}/rating`, { method: "POST", body: JSON.stringify(body) }),
  };

  payments = {
    createRazorpay: (body: object) =>
      this.request<object>("/api/v1/customer/payments/razorpay/create", { method: "POST", body: JSON.stringify(body) }),
    claimUpi: (body: object) =>
      this.request<object>("/api/v1/customer/payments/upi/claim", { method: "POST", body: JSON.stringify(body) }),
  };
}
