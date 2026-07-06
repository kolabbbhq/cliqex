import { z } from 'zod';

export const SendQuoteSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string({ required_error: 'Item ID is required' }),
      unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
    }),
  ).min(1, 'At least one priced item is required'),
  deliveryFee: z.coerce.number().min(0).default(0),
});

export const UpdateItemPriceSchema = z.object({
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
});

export type SendQuoteInput = z.infer<typeof SendQuoteSchema>;
export type UpdateItemPriceInput = z.infer<typeof UpdateItemPriceSchema>;
