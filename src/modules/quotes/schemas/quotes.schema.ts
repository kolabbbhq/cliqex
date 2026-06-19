import { z } from 'zod';

// ----------------------------------------------------------------
// Build and send quote — main admin action from CRM
// Admin sets price for every item + delivery fee, then fires it
// ----------------------------------------------------------------
export const SendQuoteSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().uuid('Invalid item ID'),
        unitPrice: z
          .number({ required_error: 'Price is required' })
          .positive('Price must be greater than 0'),
      }),
    )
    .min(1, 'At least one item is required'),

  deliveryFee: z
    .number({ required_error: 'Delivery fee is required' })
    .min(0, 'Delivery fee cannot be negative')
    .default(0),
});

// ----------------------------------------------------------------
// Update a single item price — admin adjusts one line on the quote
// ----------------------------------------------------------------
export const UpdateItemPriceSchema = z.object({
  unitPrice: z
    .number({ required_error: 'Price is required' })
    .positive('Price must be greater than 0'),
});

export type SendQuoteInput = z.infer<typeof SendQuoteSchema>;
export type UpdateItemPriceInput = z.infer<typeof UpdateItemPriceSchema>;
