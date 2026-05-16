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
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
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
    customerSignup: (body: { email: string; password: string; name?: string; phone?: string }) =>
      this.request<{ accessToken: string; expiresIn: number; user: object }>("/api/v1/customer/auth/signup", {
        method: "POST",
        body: JSON.stringify(body),
        auth: false,
      }),
    customerLogin: (email: string, password: string) =>
      this.request<{ accessToken: string; expiresIn: number; user: object }>("/api/v1/customer/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        auth: false,
      }),
    customerMe: () => this.request<{ user: object }>("/api/v1/customer/auth/me"),
    restaurantLogin: (email: string, password: string) =>
      this.request<{ accessToken: string; expiresIn: number; user: object; restaurant: object | null }>("/api/v1/restaurant/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        auth: false,
      }),
    restaurantMe: () => this.request<{ user: object; restaurant: object | null }>("/api/v1/restaurant/me"),
    me: () => this.request<object>("/api/v1/me"),
  };

  public_ = {
    getRestaurant: (slug: string) =>
      this.request<object>(`/api/v1/public/restaurants/${slug}`, { auth: false }),
    getMenu: (slug: string) =>
      this.request<{ restaurant: object; categories: object[]; items: object[]; paymentMethods: object[] }>(`/api/v1/public/restaurants/${slug}/menu`, { auth: false }),
    getPaymentMethods: (params: { slug?: string; restaurantId?: string }) =>
      this.request<object[]>(`/api/v1/public/payment-methods?${new URLSearchParams(params)}`, { auth: false }),
    lookupOrder: (params: Record<string, string>) =>
      this.request<object>(`/api/v1/public/orders/lookup?${new URLSearchParams(params)}`, { auth: false }),
    findOrder: (params: { phone: string; code: string }) =>
      this.request<{ trackingToken: string }>(`/api/v1/public/orders/find?${new URLSearchParams(params)}`, { auth: false }),
  };

  orders = {
    create: (body: object) =>
      this.request<object>("/api/v1/customer/orders", { method: "POST", body: JSON.stringify(body) }),
    get: (trackingToken: string) =>
      this.request<object>(`/api/v1/customer/orders/${trackingToken}`),
    paymentStatus: (trackingToken: string) =>
      this.request<{ paymentStatus: string; orderStatus: string }>(`/api/v1/customer/orders/${trackingToken}/payment-status`, { auth: false }),
    list: (params?: Record<string, string>) =>
      this.request<{ items: object[]; pagination: object }>(
        `/api/v1/customer/orders${params ? "?" + new URLSearchParams(params) : ""}`
      ),
    cancel: (trackingToken: string) =>
      this.request<object>(`/api/v1/customer/orders/${trackingToken}/cancel`, { method: "POST" }),
    rate: (trackingToken: string, body: object) =>
      this.request<object>(`/api/v1/customer/orders/${trackingToken}/rating`, { method: "POST", body: JSON.stringify(body) }),
  };

  restaurantOrders = {
    list: (params?: Record<string, string>) =>
      this.request<{ items: object[]; pagination: object }>(
        `/api/v1/restaurant/orders${params ? "?" + new URLSearchParams(params) : ""}`
      ),
    get: (id: string) => this.request<object>(`/api/v1/restaurant/orders/${id}`),
    updateStatus: (id: string, status: string) =>
      this.request<object>(`/api/v1/restaurant/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  };

  payments = {
    createRazorpay: (body: object) =>
      this.request<object>("/api/v1/customer/payments/razorpay/create", { method: "POST", body: JSON.stringify(body) }),
    claimUpi: (body: object) =>
      this.request<object>("/api/v1/customer/payments/upi/claim", { method: "POST", body: JSON.stringify(body) }),
    manualConfirm: (orderId: string) =>
      this.request<object>("/api/v1/restaurant/payments/manual-confirm", { method: "POST", body: JSON.stringify({ orderId }) }),
  };

  restaurant = {
    updateMenuItemAvailability: (id: string, isAvailable?: boolean) =>
      this.request<object>(`/api/v1/restaurant/menu/items/${id}/availability`, {
        method: "PATCH",
        body: JSON.stringify(typeof isAvailable === "boolean" ? { isAvailable } : {}),
      }),
    subscription: (params?: { restaurantId?: string }) =>
      this.request<object>(`/api/v1/restaurant/subscription${params?.restaurantId ? "?" + new URLSearchParams(params) : ""}`),
  };

  deviceTokens = {
    registerCustomer: (body: { token: string; platform: "ios" | "android" | "web"; appType?: string }) =>
      this.request<{ registered: boolean }>("/api/v1/customer/device-token", { method: "POST", body: JSON.stringify(body) }),
    registerRestaurant: (body: { token: string; platform: "ios" | "android" | "web"; appType?: string }) =>
      this.request<{ registered: boolean }>("/api/v1/restaurant/device-token", { method: "POST", body: JSON.stringify(body) }),
  };
}
