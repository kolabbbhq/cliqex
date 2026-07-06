import { z } from 'zod';

export const InitiatePaymentSchema = z.object({
  orderId: z.string({ required_error: 'Order ID is required' }).uuid(),
});

export const ConfirmBankTransferSchema = z.object({
  proofUrl: z
    .string({ required_error: 'Proof URL is required' })
    .url('Proof must be a valid URL'),
});

export const ListPaymentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  method: z.string().optional(),
});

export type InitiatePaymentInput = z.infer<typeof InitiatePaymentSchema>;
export type ConfirmBankTransferInput = z.infer<typeof ConfirmBankTransferSchema>;
export type ListPaymentsInput = z.infer<typeof ListPaymentsSchema>;
