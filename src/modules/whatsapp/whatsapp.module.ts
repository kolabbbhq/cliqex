import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { WhatsappRepository } from './whatsapp.repository';
import { CustomersModule } from '@modules/customers/customers.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { FlowsService } from './flows/flows.service';
import { BusinessModule } from '@modules/business/business.module';
import { UploadModule } from '@modules/upload/upload.module';
import { FlowsModule } from './flows/flows.module';
import { EmailModule } from '@modules/email/email.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';

@Module({
  imports: [
    CustomersModule,  // CustomersService.findOrCreate()
    OrdersModule,     // OrdersService.create() + findOne()
    BusinessModule,
    UploadModule,
    FlowsModule,
    EmailModule,      // ← Task 10: email admins on payment proof
    PrismaModule, 
    ReviewsModule, 
        PaymentsModule,   // ← PaymentsService.initiatePaystack()
   // ← Task 10: query admins + upsert payment record
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappRepository, FlowsService],
  exports: [WhatsappService],
})
export class WhatsappModule {}