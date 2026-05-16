export type UserRole = "USER" | "RESTAURANT_OWNER" | "EMPLOYEE" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
}
