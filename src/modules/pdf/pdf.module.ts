import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { UploadModule } from '@modules/upload/upload.module';

// ----------------------------------------------------------------
// PdfModule
//
// Provides PdfService for in-memory PDF generation.
// Imports UploadModule so callers can upload the resulting buffer.
// Import this module into any module that needs PDF receipts
// (e.g. NotificationsModule).
// ----------------------------------------------------------------
@Module({
  imports: [UploadModule],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}