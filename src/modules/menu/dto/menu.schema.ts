import { z } from 'zod';

export const CreateMenuItemSchema = z.object({
  name: z.string().min(1).trim(),
  description: z.string().trim().optional(),
  price: z.number().min(0),
  category: z.string().min(1).trim(),
  imageUrl: z.string().url().optional(),
  isAvailable: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  sort: z.number().int().min(0).optional(),
});

export const UpdateMenuItemSchema = CreateMenuItemSchema.partial();

export const ReorderMenuItemsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      sort: z.number().int().min(0),
    }),
  ),
});

export type CreateMenuItemInput = z.infer<typeof CreateMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof UpdateMenuItemSchema>;
export type ReorderMenuItemsInput = z.infer<typeof ReorderMenuItemsSchema>;
