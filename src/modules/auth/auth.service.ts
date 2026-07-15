import * as bcrypt from 'bcrypt';

import {
  TokenPair,
  JwtPayload,
  LoginResponse,
  RefreshResponse,
  AuthenticatedAdmin,
} from '@modules/auth/auth.types';
import { Admin } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

import { ConfigService } from '@nestjs/config';
import { AuthRepository } from '@modules/auth/auth.repository';

import { ChangePasswordInput } from '@modules/auth/schemas/auth.schema';
import { Logger, Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly authRepository: AuthRepository,
  ) {}

  async validateAdmin(email: string, password: string): Promise<Admin> {
    const admin = await this.authRepository.findByEmail(email);

    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Your account has been deactivated');
    }

    const passwordMatches = await bcrypt.compare(password, admin.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return admin;
  }

  async login(admin: Admin): Promise<LoginResponse> {
  const tokens = this.generateTokenPair(admin);

  const business = admin.businessId
  ? await this.authRepository.findBusinessSlug(admin.businessId)
  : null;

  this.logger.log(`Admin logged in: ${admin.email} (${admin.role})`);

  return {
    admin: this.sanitizeAdmin(admin),
    tokens,
    business: business ? { slug: business.slug } : null,
  };
}
  async refresh(refreshToken: string): Promise<RefreshResponse> {
    let payload: JwtPayload;

    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const admin = await this.authRepository.findById(payload.sub);

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Admin not found or deactivated');
    }

    const tokens = this.generateTokenPair(admin);

    return { tokens };
  }

  async changePassword(adminId: string, data: ChangePasswordInput): Promise<void> {
    const admin = await this.authRepository.findById(adminId);

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    const currentPasswordMatches = await bcrypt.compare(data.currentPassword, admin.passwordHash);

    if (!currentPasswordMatches) {
      throw new BadRequestException('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(data.newPassword, BCRYPT_ROUNDS);
    await this.authRepository.updatePassword(adminId, newHash);

    this.logger.log(`Password changed for admin: ${admin.email}`);
  }

  async getProfile(adminId: string): Promise<AuthenticatedAdmin> {
    const admin = await this.authRepository.findById(adminId);

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    return this.sanitizeAdmin(admin);
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  private generateTokenPair(admin: Admin): TokenPair {
  const payload: JwtPayload = {
    sub:        admin.id,
    email:      admin.email,
    role:       admin.role,
    businessId: admin.businessId ?? null,  
  };
 
  const expiresIn = 60 * 60 * 8; // 8 hours
 
  const accessToken = this.jwtService.sign(payload, {
    secret:    this.config.get<string>('JWT_SECRET'),
    expiresIn,
  });
 
  const refreshToken = this.jwtService.sign(payload, {
    secret:    this.config.get<string>('JWT_REFRESH_SECRET'),
    expiresIn: '30d',
  });
 
  return { accessToken, refreshToken, expiresIn };
}
 private sanitizeAdmin(admin: Admin): AuthenticatedAdmin {
  return {
    id:         admin.id,
    email:      admin.email,
    name:       admin.name,
    role:       admin.role,
    businessId: admin.businessId ?? null,  // ✅ include businessId
  };
}
}
