import type { PaymentMethod } from "./payment";
import type { PublicRestaurant, PublicMenuItem } from "./restaurant";

export interface MenuCategory {
  id: number;
  name: string;
  sortOrder: number;
}

export interface PaymentMethodInfo {
  id: number;
  type: PaymentMethod;
  displayName: string;
  isDefault: boolean;
  qrImageUrl?: string | null;
  upiId?: string | null;
}

export interface MenuResponse {
  restaurant: PublicRestaurant;
  categories: MenuCategory[];
  items: PublicMenuItem[];
  paymentMethods: PaymentMethodInfo[];
}
