import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { OrdersModule } from '@modules/orders/orders.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { WhatsappModule } from '@modules/whatsapp/whatsapp.module';

@Module({
  imports: [OrdersModule, CustomersModule, WhatsappModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService],
})
export class PaymentsModule {}
