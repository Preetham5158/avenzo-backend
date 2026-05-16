export interface PublicRestaurant {
  slug: string;
  name: string;
  description?: string;
  isOpen: boolean;
}

export interface PublicMenuItem {
  key: string;
  name: string;
  price: number;
  description?: string;
  isAvailable: boolean;
  category?: { name: string; sortOrder: number };
}
