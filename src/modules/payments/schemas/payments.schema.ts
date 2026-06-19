import { z } from 'zod';

// ----------------------------------------------------------------
// Initiate Paystack payment — called after customer confirms quote
// ----------------------------------------------------------------
export const InitiatePaymentSchema = z.object({
  orderId: z.string().uuid('Invalid order ID'),
  method: z.enum(['PAYSTACK', 'BANK_TRANSFER']),
});

// ----------------------------------------------------------------
// Manual bank transfer confirmation — admin confirms they received it
// ----------------------------------------------------------------
export const ConfirmBankTransferSchema = z.object({
  proofUrl: z.string().url('Invalid proof URL').optional(),
  notes: z.string().trim().optional(),
});

// ----------------------------------------------------------------
// List payments — CRM payments tab filters
// ----------------------------------------------------------------
export const ListPaymentsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED']).optional(),
  method: z.enum(['PAYSTACK', 'BANK_TRANSFER']).optional(),
});

export type InitiatePaymentInput = z.infer<typeof InitiatePaymentSchema>;
export type ConfirmBankTransferInput = z.infer<typeof ConfirmBankTransferSchema>;
export type ListPaymentsInput = z.infer<typeof ListPaymentsSchema>;
