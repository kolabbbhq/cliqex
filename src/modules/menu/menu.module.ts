import { Module } from '@nestjs/common';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { PrismaModule } from '@common/prisma/prisma.module';
import { TenantModule } from '@common/tenant/tenant.module';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
