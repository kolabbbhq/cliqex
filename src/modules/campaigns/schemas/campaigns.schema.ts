import { z } from 'zod';

export const CreateCampaignSchema = z.object({
  name: z.string().min(2).trim(),
templateName: z.string()
  .min(1, 'Meta template name is required')
  .trim()
  .regex(/^[a-z0-9_]+$/, 'templateName must be the exact approved Meta template name (lowercase letters, numbers, underscores only — no spaces, emoji, or punctuation)'),  templateVars: z.record(z.string()).optional(),
  languageCode: z.string().default('en'),              // ← ADD
  audience: z.enum(['ALL', 'ACTIVE', 'INACTIVE', 'VIP']),
  scheduledAt: z.coerce.date().optional(),
});

export const ListCampaignsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;
export type ListCampaignsInput = z.infer<typeof ListCampaignsSchema>;