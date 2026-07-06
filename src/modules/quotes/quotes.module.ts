import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { OrdersModule } from '@modules/orders/orders.module';
import { WhatsappModule } from '@modules/whatsapp/whatsapp.module';
import { PdfModule } from '@modules/pdf/pdf.module';
import { UploadModule } from '@modules/upload/upload.module';
import { BusinessModule } from '@modules/business/business.module';

@Module({
  imports: [OrdersModule, WhatsappModule, PdfModule, UploadModule, BusinessModule],
  controllers: [QuotesController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}