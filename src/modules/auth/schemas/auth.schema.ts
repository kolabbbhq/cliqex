import { z } from 'zod';


export const LoginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(6, 'Password must be at least 6 characters'),
});


export const RefreshTokenSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token is required' })
    .min(1, 'Refresh token cannot be empty'),
});


export const ChangePasswordSchema = z
  .object({
    currentPassword: z
      .string({ required_error: 'Current password is required' })
      .min(1),
    newPassword: z
      .string({ required_error: 'New password is required' })
      .min(8, 'New password must be at least 8 characters')
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        'Password must contain uppercase, lowercase and a number',
      ),
    confirmPassword: z.string({ required_error: 'Please confirm your password' }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });


export const CreateAdminSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').trim(),
  email: z.string().email('Invalid email').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['SUPER_ADMIN', 'AGENT']).default('AGENT'),
});


export type LoginInput          = z.infer<typeof LoginSchema>;
export type CreateAdminInput    = z.infer<typeof CreateAdminSchema>;
export type RefreshTokenInput   = z.infer<typeof RefreshTokenSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
