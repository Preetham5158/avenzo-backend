export interface PublicRestaurant {
  slug: string;
  name: string;
  address: string;
  locality: string;
  pickupNote: string | null;
  foodType: string;
  isActive: boolean;
  serviceAvailable: boolean;
  serviceMessage: string | null;
  avgRating: number | null;
  ratingCount: number;
}

export interface PublicMenuItem {
  key: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  foodType: "VEG" | "NON_VEG" | "EGG";
  isAvailable: boolean;
  isActive: boolean;
  price: number;
  category: { name: string; sortOrder: number };
  isPopular: boolean;
}
