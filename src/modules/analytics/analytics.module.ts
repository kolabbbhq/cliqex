import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { PrismaModule } from '@common/prisma/prisma.module';
import { TenantModule } from '@common/tenant/tenant.module';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}