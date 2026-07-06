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
import { Roles } from '@common/decorators/roles.decorator';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { RolesGuard } from '@modules/auth/guards/roles.guard';
import { CustomersService } from '@modules/customers/customers.service';
import { UpdateCustomerDto, ListCustomersDto } from '@modules/customers/dto/customers.dto';

@UseGuards(JwtGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async findAll(@Query() query: ListCustomersDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @Roles(AdminRole.SUPER_ADMIN)
  async block(@Param('id') id: string) {
    await this.customersService.block(id);
    return { message: 'Customer blocked' };
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  @Roles(AdminRole.SUPER_ADMIN)
  async unblock(@Param('id') id: string) {
    await this.customersService.unblock(id);
    return { message: 'Customer unblocked' };
  }
}
