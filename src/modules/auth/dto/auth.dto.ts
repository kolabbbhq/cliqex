import { createZodDto } from 'nestjs-zod';
import {
  LoginSchema,
  RefreshTokenSchema,
  ChangePasswordSchema,
} from '@modules/auth/schemas/auth.schema';

export class LoginDto extends createZodDto(LoginSchema) {}
export class RefreshTokenDto extends createZodDto(RefreshTokenSchema) {}
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}
