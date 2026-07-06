import { Injectable, Scope, UnauthorizedException } from '@nestjs/common';

// ----------------------------------------------------------------
// TenantContext
//
// REQUEST-SCOPED service — a new instance is created for every
// incoming HTTP request. This means it safely holds data for
// one request without leaking to another.
//
// How it works:
// 1. JwtGuard validates the JWT and calls context.set(businessId)
// 2. Any repository that needs businessId calls context.get()
// 3. SUPER_ADMIN has no businessId — they pass it explicitly
//    or use a special bypass
// ----------------------------------------------------------------
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private businessId: string | null = null;
  private isSuperAdmin: boolean = false;

  // Called by JwtGuard after validating the token
  set(businessId: string | null, isSuperAdmin = false): void {
    this.businessId    = businessId;
    this.isSuperAdmin  = isSuperAdmin;
  }

  // Called by repositories to get the current business
  get(): string {
    if (this.isSuperAdmin) {
      throw new Error(
        'TenantContext.get() called in a SUPER_ADMIN context. ' +
        'Pass businessId explicitly or use getOptional().',
      );
    }
    if (!this.businessId) {
      throw new UnauthorizedException('No business context — are you logged in?');
    }
    return this.businessId;
  }

  // Use this when businessId might legitimately be null
  getOptional(): string | null {
    return this.businessId;
  }

  getIsSuperAdmin(): boolean {
    return this.isSuperAdmin;
  }
}