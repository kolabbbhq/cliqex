import {
  Get,
  Body,
  Post,
  Patch,
  Param,
  Query,
  HttpCode,
  UseGuards,
  HttpStatus,
  Controller,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';

import {
  CreateBuddyDto,
  UpdateBuddyDto,
  ListBuddiesDto,
  UpdateBuddyStatusDto,
} from '@modules/buddies/dto/buddies.dto';

import { Roles } from '@common/decorators/roles.decorator';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { BuddiesService } from '@modules/buddies/buddies.service';

@UseGuards(JwtGuard, RolesGuard)
@Controller('buddies')
export class BuddiesController {
  constructor(private readonly buddiesService: BuddiesService) {}

  @Get()
  async findAll(@Query() query: ListBuddiesDto) {
    return this.buddiesService.findAll(query);
  }

  @Get('available')
  async findAvailable(@Query('serviceType') serviceType?: string) {
    return this.buddiesService.findAvailable(serviceType);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.buddiesService.findOne(id);
  }

  @Post()
  @Roles(AdminRole.SUPER_ADMIN)
  async create(@Body() dto: CreateBuddyDto) {
    return this.buddiesService.create(dto);
  }

  @Patch(':id')
  @Roles(AdminRole.SUPER_ADMIN)
  async update(@Param('id') id: string, @Body() dto: UpdateBuddyDto) {
    return this.buddiesService.update(id, dto);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateBuddyStatusDto) {
    return this.buddiesService.updateStatus(id, dto);
  }
}
