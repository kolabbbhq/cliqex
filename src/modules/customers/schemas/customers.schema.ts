import { z } from 'zod';

export const UpdateCustomerSchema = z.object({
  name: z.string().min(2).trim().optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  address: z.string().min(5).trim().optional(),
});

export const ListCustomersSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().trim().optional(), 
});

export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
export type ListCustomersInput = z.infer<typeof ListCustomersSchema>;
