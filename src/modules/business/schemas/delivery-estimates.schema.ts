// src/modules/business/schemas/delivery-estimates.schema.ts
import { z } from 'zod';

export const UpdateDeliveryEstimatesSchema = z
  .object({
    estimatedDeliveryMin: z.coerce.number().int().min(1),
    estimatedDeliveryMax: z.coerce.number().int().min(1),
    estimatedDeliveryUnit: z.enum(['minutes', 'hours']),
  })
  .refine((data) => data.estimatedDeliveryMax >= data.estimatedDeliveryMin, {
    message: 'estimatedDeliveryMax must be greater than or equal to estimatedDeliveryMin',
    path: ['estimatedDeliveryMax'],
  });

export type UpdateDeliveryEstimatesInput = z.infer<typeof UpdateDeliveryEstimatesSchema>;