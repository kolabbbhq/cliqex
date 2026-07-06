import { createZodDto } from 'nestjs-zod';
import {
  InitiatePaymentSchema,
  ConfirmBankTransferSchema,
  ListPaymentsSchema,
} from '../schemas/payments.schema';

export class InitiatePaymentDto extends createZodDto(InitiatePaymentSchema) {}
export class ConfirmBankTransferDto extends createZodDto(ConfirmBankTransferSchema) {}
export class ListPaymentsDto extends createZodDto(ListPaymentsSchema) {}
