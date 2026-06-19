import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from '@modules/auth/auth.service';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { AuthController } from '@modules/auth/auth.controller';
import { AuthRepository } from '@modules/auth/auth.repository';
import { JwtStrategy } from '@modules/auth/strategies/jwt.strategy';

import { LocalStrategy } from '@modules/auth/strategies/local.strategy';
import { JwtGuard, LocalGuard } from '@modules/auth/guards/auth.guards';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtGuard,
    LocalGuard,
    RolesGuard,
    AuthService,
    JwtStrategy,
    LocalStrategy,
    AuthRepository,
  ],
  exports: [AuthService, JwtGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
