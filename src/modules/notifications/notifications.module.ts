import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { WhatsappModule } from '@modules/whatsapp/whatsapp.module';

@Module({
  imports: [WhatsappModule],
  providers: [NotificationsService],
})
export class NotificationsModule {}
