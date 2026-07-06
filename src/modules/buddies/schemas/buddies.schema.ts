import { z } from 'zod';

export const CreateBuddySchema = z.object({
  name: z.string().min(2).trim(),
  phone: z.string().min(10, 'Invalid phone number').trim().optional(),
  serviceTypes: z
    .array(z.enum(['GROCERY', 'ERRAND', 'CLEANING']))
    .min(1, 'At least one service type required'),
});

export const UpdateBuddySchema = z.object({
  name: z.string().min(2).trim().optional(),
  phone: z.string().min(10).trim().optional(),
  serviceTypes: z.array(z.enum(['GROCERY', 'ERRAND', 'CLEANING'])).optional(),
  isActive: z.boolean().optional(),
});

export const UpdateBuddyStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'BUSY', 'OFFLINE']),
});

export const ListBuddiesSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['AVAILABLE', 'BUSY', 'OFFLINE']).optional(),
  serviceType: z.enum(['GROCERY', 'ERRAND', 'CLEANING']).optional(),
  isActive: z.coerce.boolean().optional(),
});

export type CreateBuddyInput = z.infer<typeof CreateBuddySchema>;
export type UpdateBuddyInput = z.infer<typeof UpdateBuddySchema>;
export type UpdateBuddyStatusInput = z.infer<typeof UpdateBuddyStatusSchema>;
export type ListBuddiesInput = z.infer<typeof ListBuddiesSchema>;
