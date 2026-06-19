import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { OrdersModule } from '@modules/orders/orders.module';
import { WhatsappModule } from '@modules/whatsapp/whatsapp.module';

@Module({
  imports: [OrdersModule, WhatsappModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
