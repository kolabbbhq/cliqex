import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const InitiatePaymentSchema = z.object({
  orderId: z.string({ required_error: 'Order ID is required' }).uuid(),
});

export const ConfirmBankTransferSchema = z.object({
  proofUrl: z
    .string()
    .url('Proof must be a valid URL')
    .optional(),
});

export const RejectBankTransferSchema = z.object({
  reason: z.string().min(1, 'Reason is required').optional(),
});

export const ListPaymentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().optional(),
  method: z.string().optional(),
  startDate: z.string().optional(),   // ← ADD
  endDate: z.string().optional(),     // ← ADD
});

export class ListPaymentsDto extends createZodDto(ListPaymentsSchema) {}
export class ConfirmBankTransferDto extends createZodDto(ConfirmBankTransferSchema) {}
export class RejectBankTransferDto extends createZodDto(RejectBankTransferSchema) {}
export class InitiatePaymentDto extends createZodDto(InitiatePaymentSchema) {}

export type InitiatePaymentInput = z.infer<typeof InitiatePaymentSchema>;
export type ConfirmBankTransferInput = z.infer<typeof ConfirmBankTransferSchema>;
export type RejectBankTransferInput = z.infer<typeof RejectBankTransferSchema>;
export type ListPaymentsInput = z.infer<typeof ListPaymentsSchema>;