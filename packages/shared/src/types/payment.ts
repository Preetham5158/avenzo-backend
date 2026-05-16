export type PaymentMethod = "CASH" | "UPI" | "RAZORPAY";

export interface PaymentInfo {
  paymentStatus: string;
  amountDue: number;
  currency: string;
  upiId?: string;
}
