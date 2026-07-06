import { Module } from '@nestjs/common';
import { PublicMenuController } from './public.controller';
import { PrismaModule } from '@common/prisma/prisma.module';
import { TenantModule } from '@common/tenant/tenant.module';
import { BusinessHoursService } from '@modules/business/business-hours.service';
import { OrdersModule } from '@modules/orders/orders.module';

@Module({
  imports: [PrismaModule, TenantModule, OrdersModule],
  controllers: [PublicMenuController],
  providers: [BusinessHoursService],
})
export class PublicModule {}
