import { Module } from '@nestjs/common';
import { CustomersService } from '@modules/customers/customers.service';
import { CustomersController } from '@modules/customers/customers.controller';
import { CustomersRepository } from '@modules/customers/customers.repository';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, CustomersRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
