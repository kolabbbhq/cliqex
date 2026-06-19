import { Controller, Post, Get, Body, UseGuards, Req, UsePipes } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { Public } from '@common/decorators/public.decorator';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { ZodValidationPipe } from 'nestjs-zod';

import {
  SignupSchema,
  ConnectWhatsAppSchema,
  ConfigureServicesSchema,
  UpdatePaymentDetailsSchema,
  SignupInput,
  ConnectWhatsAppInput,
  ConfigureServicesInput,
  UpdatePaymentInput,
} from './schemas/onboarding.schema';

@ApiTags('Onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  // ----------------------------------------------------------------
  // Step 1 — Public signup
  // Validates with SignupSchema before hitting the service
  // ----------------------------------------------------------------
  @Public()
  @Post('signup')
  @UsePipes(new ZodValidationPipe(SignupSchema))
  @ApiOperation({ summary: 'Create a new business account' })
  signup(@Body() body: SignupInput) {
    return this.onboardingService.signup(body);
  }

  // ----------------------------------------------------------------
  // Step 2 — Connect WhatsApp
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Post('whatsapp')
  @UsePipes(new ZodValidationPipe(ConnectWhatsAppSchema))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Connect WhatsApp phone number' })
  connectWhatsApp(@Req() req: any, @Body() body: ConnectWhatsAppInput) {
    return this.onboardingService.connectWhatsApp(req.user.businessId, body);
  }

  // ----------------------------------------------------------------
  // Step 3 — Configure services, areas, bank details
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Post('services')
  @UsePipes(new ZodValidationPipe(ConfigureServicesSchema))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Configure services, areas and payment details' })
  configureServices(@Req() req: any, @Body() body: ConfigureServicesInput) {
    return this.onboardingService.configureServices(req.user.businessId, body);
  }

  // ----------------------------------------------------------------
  // Step 4 — Update payment details (separate endpoint)
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Post('payment')
  @UsePipes(new ZodValidationPipe(UpdatePaymentDetailsSchema))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add or update bank account details' })
  updatePayment(@Req() req: any, @Body() body: UpdatePaymentInput) {
    return this.onboardingService.updatePaymentDetails(req.user.businessId, body);
  }

  // ----------------------------------------------------------------
  // Get onboarding status — checklist shown on dashboard
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get onboarding checklist progress' })
  getStatus(@Req() req: any) {
    return this.onboardingService.getOnboardingStatus(req.user.businessId);
  }
}
