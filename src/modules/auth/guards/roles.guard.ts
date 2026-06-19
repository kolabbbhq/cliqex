import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '@modules/auth/auth.types';
import { ROLES_KEY } from '@common/decorators/roles.decorator';
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const admin: AuthenticatedAdmin = request.user;

    if (!admin) throw new ForbiddenException('Not authenticated');

    // Fix: cast admin.role to AdminRole since AuthenticatedAdmin.role is string
    const hasRole = requiredRoles.includes(admin.role as AdminRole);

    if (!hasRole) {
      throw new ForbiddenException(`Access denied. Required role: ${requiredRoles.join(' or ')}`);
    }

    return true;
  }
}
