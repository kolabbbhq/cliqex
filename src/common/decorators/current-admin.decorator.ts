import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedAdmin } from '@modules/auth/auth.types';

// Usage in controllers:
// async getProfile(@CurrentAdmin() admin: AuthenticatedAdmin)
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
