// src/modules/business/schemas/message-templates.schema.ts
import { z } from 'zod';

export const UpdateMessageTemplatesSchema = z.object({
  greeting: z.string().trim().min(1).max(500).optional(),
  orderReceived: z.string().trim().min(1).max(500).optional(),
  closedMessage: z.string().trim().min(1).max(500).optional(),
  quoteFooter: z.string().trim().min(1).max(300).optional(),
});

export type UpdateMessageTemplatesInput = z.infer<typeof UpdateMessageTemplatesSchema>;