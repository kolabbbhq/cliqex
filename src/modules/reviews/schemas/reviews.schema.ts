import { z } from 'zod';

export const ListReviewsSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),

  rating: z.coerce.number().min(1).max(5).optional(),
  buddyId: z.string().uuid().optional(),
  hasComment: z.coerce.boolean().optional(),
  awaitingComment: z.coerce.boolean().optional(),

  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export type ListReviewsInput = z.infer<typeof ListReviewsSchema>;