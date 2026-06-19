import { PaymentMethod, PaymentStatus } from '@prisma/client';

// ----------------------------------------------------------------
// Paystack initialize response
// ----------------------------------------------------------------
export interface PaystackInitResponse {
  authorizationUrl: string; // URL sent to customer
  accessCode: string;
  reference: string; // stored as paystackRef on Payment
}

export interface CreatePaymentInput {
  orderId: string;
  customerId: string;
  method: PaymentMethod;
  amount: number;
  paystackRef?: string;
  paystackLink?: string;
  proofUrl?: string;
}
// ----------------------------------------------------------------
// Paystack webhook event — what Paystack POSTs to our webhook
// ----------------------------------------------------------------
export interface PaystackWebhookEvent {
  event: string; // 'charge.success' | 'transfer.success' etc
  data: {
    id: number;
    domain: string;
    status: string; // 'success' | 'failed'
    reference: string; // matches our paystackRef
    amount: number; // in kobo (divide by 100)
    currency: string;
    customer: {
      email: string;
      customer_code: string;
      phone: string | null;
    };
    paid_at: string;
    created_at: string;
    metadata?: Record<string, any>;
  };
}

// ----------------------------------------------------------------
// Payment record view — CRM payments tab
// ----------------------------------------------------------------
export interface PaymentView {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  customerPhone: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  paystackRef: string | null;
  paystackLink: string | null;
  proofUrl: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

// ----------------------------------------------------------------
// Paginated payments
// ----------------------------------------------------------------
export interface PaginatedPayments {
  data: PaymentView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
