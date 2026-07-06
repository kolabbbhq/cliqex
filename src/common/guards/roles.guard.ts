import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@common/decorators/roles.decorator';

// ----------------------------------------------------------------
// RolesGuard
// Works with @Roles('SUPER_ADMIN') decorator.
// If no roles are specified, all authenticated users pass through.
// ----------------------------------------------------------------
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator — all authenticated users allowed
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user    = request.user; // populated by JwtGuard

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires one of these roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}