import { Module } from '@nestjs/common';
import { BusinessService } from '@modules/business/business.service';
import { BusinessController } from '@modules/business/business.controller';
import { BusinessRepository } from '@modules/business/business.repository';
import { BusinessHoursService } from '@modules/business/business-hours.service';

@Module({
  controllers: [BusinessController],
  providers: [BusinessService, BusinessRepository, BusinessHoursService],
  exports: [BusinessService, BusinessHoursService],
})
export class BusinessModule {}