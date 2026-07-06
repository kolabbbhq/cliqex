import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { OrdersModule } from '@modules/orders/orders.module';
import { CustomersModule } from '@modules/customers/customers.module';

@Module({
  imports: [OrdersModule, CustomersModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService],
})
export class PaymentsModule {}
