import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

// ----------------------------------------------------------------
// EmailModule
//
// Provides EmailService for sending transactional emails via SMTP.
// Import into any module that needs email notifications
// (e.g. WhatsappModule for payment proof alerts).
// ----------------------------------------------------------------
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}