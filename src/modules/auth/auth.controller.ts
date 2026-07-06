
import { AuthService } from '@modules/auth/auth.service';
import { Public } from '@common/decorators/public.decorator';
import { JwtGuard, LocalGuard } from '@modules/auth/guards/auth.guards';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { LoginDto, RefreshTokenDto, ChangePasswordDto } from '@modules/auth/dto/auth.dto';
import { AuthenticatedAdmin, LoginResponse, RefreshResponse } from '@modules/auth/auth.types';
import { Get, Body, Post, HttpCode, UseGuards, HttpStatus, Controller } from '@nestjs/common';


import { Admin } from '@prisma/client';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(LocalGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() _dto: LoginDto, @CurrentAdmin() admin: Admin): Promise<LoginResponse> {
    return this.authService.login(admin);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto): Promise<RefreshResponse> {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtGuard)
  @Get('me')
  async getProfile(@CurrentAdmin() admin: AuthenticatedAdmin): Promise<AuthenticatedAdmin> {
    return this.authService.getProfile(admin.id);
  }

  @UseGuards(JwtGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(admin.id, dto);
    return { message: 'Password changed successfully' };
  }
}
