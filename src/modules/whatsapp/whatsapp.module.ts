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

@Module({
  imports: [
    CustomersModule, // needs CustomersService.findOrCreate()
    OrdersModule, // needs OrdersService.create() + findOne()
    BusinessModule,
    UploadModule,
    FlowsModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappRepository, FlowsService],
  exports: [WhatsappService], // NotificationsModule will use sendText/sendButtons
})
export class WhatsappModule {}
