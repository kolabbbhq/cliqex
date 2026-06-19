import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthRepository } from '@modules/auth/auth.repository';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtPayload, AuthenticatedAdmin } from '@modules/auth/auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly authRepository: AuthRepository,
    config: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedAdmin> {
    const admin = await this.authRepository.findById(payload.sub);

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Admin not found or deactivated');
    }

    // Fix: include businessId which AuthenticatedAdmin requires
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      businessId: admin.businessId ?? null,
    };
  }
}
