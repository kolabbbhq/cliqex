import { Module } from '@nestjs/common';
import { BusinessService } from '@modules/business/business.service';
import { BusinessController } from '@modules/business/business.controller';
import { BusinessRepository } from '@modules/business/business.repository';

@Module({
  controllers: [BusinessController],
  providers: [BusinessService, BusinessRepository],
  exports: [BusinessService],
})
export class BusinessModule {}
