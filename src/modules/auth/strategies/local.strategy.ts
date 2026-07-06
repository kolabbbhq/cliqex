import { Admin } from '@prisma/client';
import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { AuthService } from '@modules/auth/auth.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
    });
  }

  async validate(email: string, password: string): Promise<Admin> {
    const admin = await this.authService.validateAdmin(email, password);

    if (!admin) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return admin;
  }
}
