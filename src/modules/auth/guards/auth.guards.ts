import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { JwtPayload } from '@modules/auth/auth.types';

@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // Fix: signature must match IAuthGuard — include ExecutionContext param
  handleRequest<TUser = any>(err: any, payload: any, info: any, _context: ExecutionContext): TUser {
    if (err || !payload) {
      throw err ?? new UnauthorizedException('Invalid or expired token');
    }
    const isSuperAdmin = (payload as JwtPayload).role === 'SUPER_ADMIN';
    this.tenantContext.set((payload as JwtPayload).businessId, isSuperAdmin);
    return payload as TUser;
  }
}

// Add missing LocalGuard export
@Injectable()
export class LocalGuard extends AuthGuard('local') {}
