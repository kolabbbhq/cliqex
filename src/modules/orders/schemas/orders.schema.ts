import { z } from 'zod';

export const ListOrdersSchema = z.object({
  page:        z.coerce.number().min(1).default(1),
  limit:       z.coerce.number().min(1).max(100).default(20),
  status:      z.enum([
    'NEW', 'QUOTED', 'AWAITING_PAYMENT', 'PAID',
    'PROCESSING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED',
  ]).optional(),
  serviceType: z.enum(['GROCERY', 'ERRAND', 'CLEANING']).optional(),
  customerId:  z.string().uuid().optional(),
  search:      z.string().trim().optional(),
   startDate:   z.coerce.date().optional(),
  endDate:     z.coerce.date().optional(),
});

export const UpdateOrderNotesSchema = z.object({
  notes: z.string().trim().min(1),
});

export const PriceItemSchema = z.object({
  unitPrice: z.number().positive('Price must be greater than 0'),
});

export const PriceAllItemsSchema = z.object({
  items: z.array(
    z.object({
      itemId:    z.string().uuid(),
      unitPrice: z.number().positive(),
    }),
  ).min(1, 'At least one item required'),
  deliveryFee: z.number().min(0).default(0),
});

export const CancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Please provide a reason'),
});

export const AssignBuddySchema = z.object({
  buddyId: z.string().uuid('Invalid buddy ID'),
});

// ----------------------------------------------------------------
// ✅ NEW — Structured flow data stored alongside the order
// When a customer submits via WhatsApp Flow, we save this
// ----------------------------------------------------------------
export const FlowDataSchema = z.object({
  itemList:       z.string(),
  budget:         z.number().min(0),
  preferredStore: z.string().optional(),
  area:           z.string(),
  additionalInfo: z.string().optional(),
  phoneNumber:    z.string(),
});

// ----------------------------------------------------------------
// ✅ NEW — Create order from WhatsApp Flow submission
// Used by WhatsappService.handleFlowSubmission()
// ----------------------------------------------------------------
export const CreateOrderFromFlowSchema = z.object({
  customerId:      z.string().uuid(),
  serviceType:     z.enum(['GROCERY', 'ERRAND', 'CLEANING']),
  deliveryAddress: z.string().min(5),
  flowData:        FlowDataSchema,
});

export type ListOrdersInput       = z.infer<typeof ListOrdersSchema>;
export type UpdateOrderNotesInput = z.infer<typeof UpdateOrderNotesSchema>;
export type PriceItemInput        = z.infer<typeof PriceItemSchema>;
export type PriceAllItemsInput    = z.infer<typeof PriceAllItemsSchema>;
export type CancelOrderInput      = z.infer<typeof CancelOrderSchema>;
export type AssignBuddyInput      = z.infer<typeof AssignBuddySchema>;
export type FlowDataInput         = z.infer<typeof FlowDataSchema>;
export type CreateOrderFromFlowInput = z.infer<typeof CreateOrderFromFlowSchema>;