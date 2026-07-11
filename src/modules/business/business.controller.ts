import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { BusinessService } from '@modules/business/business.service';
import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';


@UseGuards(JwtGuard, RolesGuard)
@Controller('business')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}


  @Get('me')
  getMyBusiness() {
    return this.businessService.getMyBusiness();
  }

@Patch('me')
updateMyBusiness(
  @Body()
  body: {
    name?: string;
    tagline?: string;
    logoUrl?: string;
    primaryColor?: string;
    bankName?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
    timezone?: string;
    operatingHours?: Record<string, { open: string; close: string; active: boolean }>;
    estimatedDeliveryMin?: number;
    estimatedDeliveryMax?: number;
    estimatedDeliveryUnit?: string;
  },
) {
  return this.businessService.updateMyBusiness(body);
}
@Patch('me/messages')
updateMessageTemplates(@Body() body: unknown) {
  return this.businessService.updateMessageTemplates(body);
}

@Patch('me/whatsapp')
connectWhatsApp(
  @Body()
  body: {
    whatsappPhoneId: string;
    whatsappToken: string;
    whatsappVerifyToken: string;
    wabaId?: string;
  },
) {
  return this.businessService.connectWhatsApp(body);
}

  @Patch('me/services')
  updateServiceConfig(
    @Body()
    body: {
      services?: any[];
      areas?: any[];
      welcomeText?: string;
      headerImageUrl?: string;
      serviceChargePercent?: number;
      vatPercent?: number;
    },
  ) {
    return this.businessService.updateServiceConfig(body);
  }

  // ---- Super admin routes ----

  @Get()
  @Roles('SUPER_ADMIN')
  getAllBusinesses() {
    return this.businessService.getAllBusinesses();
  }

  @Post()
  @Roles('SUPER_ADMIN')
  createBusiness(
    @Body()
    body: {
      name: string;
      slug: string;
      plan?: string;
      logoUrl?: string;
      tagline?: string;
      primaryColor?: string;
    },
  ) {
    return this.businessService.createBusiness(body);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN')
  getById(@Param('id') id: string) {
    return this.businessService.getById(id);
  }
}
