import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { WhatsappModule } from '@modules/whatsapp/whatsapp.module';
import { PdfModule } from '@modules/pdf/pdf.module';
import { UploadModule } from '@modules/upload/upload.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { TenantModule } from '@common/tenant/tenant.module';
import { EmailModule } from '@modules/email/email.module';

@Module({
  imports: [
    ConfigModule,
    TenantModule,
    WhatsappModule,
    PdfModule,
    UploadModule,
    PrismaModule,
    EmailModule,
  ],
  providers: [NotificationsService],
})
export class NotificationsModule {}