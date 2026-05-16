import type { PaymentMethodInfo } from "./menu";

export type OrderStatus = "PENDING" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
export type PaymentStatus =
  | "PAYMENT_NOT_REQUIRED"
  | "PAYMENT_PENDING"
  | "PAYMENT_CLAIMED"
  | "PAID";

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export interface CreateOrderItem {
  menuKey: string;
  quantity: number;
}

export interface CreateOrderRequest {
  items: CreateOrderItem[];
  sessionId: string;
  restaurantSlug: string;
  phone?: string;
  paymentMethodId?: number;
  tableNumber?: string;
  idempotencyKey?: string;
  guest?: boolean;
}

export interface CreateOrderResponse {
  trackingToken: string;
  orderNumber: string;
  pickupCode: string;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethodInfo | null;
  trackingUrl: string;
}

export interface OrderItem {
  nameAtOrder: string;
  quantity: number;
  priceAtOrder: number;
}

export interface OrderDetail {
  orderNumber: string;
  pickupCode: string;
  totalPrice: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  readyAt: string | null;
  createdAt: string;
  updatedAt: string;
  restaurant: { name: string; slug: string; pickupNote: string | null };
  items: OrderItem[];
  tableNumber: string | null;
  hasRating: boolean;
  rating: number | null;
  paymentInfo?: { paymentStatus: string; amountDue: number; currency: string; upiId?: string };
}

export interface OrderSummary {
  trackingToken: string;
  orderNumber: string;
  pickupCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalPrice: number;
  createdAt: string;
  readyAt: string | null;
  restaurant: { name: string; slug: string; locality: string; address: string };
  items: OrderItem[];
  tableNumber: string | null;
  rating: number | null;
}
