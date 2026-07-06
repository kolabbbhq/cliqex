import {
  Get,
  Body,
  Post,
  Param,
  Query,
  HttpCode,
  UseGuards,
  HttpStatus,
  Controller,
} from '@nestjs/common';

import { Roles } from '@common/decorators/roles.decorator';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { AdminRole, CampaignAudience } from '@prisma/client';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { AuthenticatedAdmin } from '@modules/auth/auth.types';
import { CampaignsService } from '@modules/campaigns/campaigns.service';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { CreateCampaignDto, ListCampaignsDto } from '@modules/campaigns/dto/campaigns.dto';

@UseGuards(JwtGuard, RolesGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  async findAll(@Query() query: ListCampaignsDto) {
    return this.campaignsService.findAll(query);
  }

  @Get('audience-preview')
  async previewAudience(@Query('audience') audience: CampaignAudience) {
    return this.campaignsService.previewAudience(audience);
  }

  @Post()
  @Roles(AdminRole.SUPER_ADMIN)
  async create(@Body() dto: CreateCampaignDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.campaignsService.create(dto, admin.id);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Roles(AdminRole.SUPER_ADMIN)
  async send(@Param('id') id: string) {
    return this.campaignsService.send(id);
  }
}
