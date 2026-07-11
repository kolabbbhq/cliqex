import { z } from 'zod';

export const CreateWhatsappTemplateSchema = z.object({
  name: z
    .string()
    .min(1, 'Template name is required')
    .trim()
    .regex(/^[a-z0-9_]+$/, 'Name must be lowercase letters, numbers, and underscores only (e.g. "weekend_promo")'),
  language: z.string().min(1, 'Language code is required').trim(), // e.g. "en_US"
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  bodyText: z.string().min(1, 'Message body is required').trim(),
  bodyExampleValues: z.array(z.string()).optional(),
});

export type CreateWhatsappTemplateInput = z.infer<typeof CreateWhatsappTemplateSchema>;
