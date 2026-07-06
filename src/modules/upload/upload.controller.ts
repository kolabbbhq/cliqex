import {
  Controller, Post, Param,
  UseGuards, UseInterceptors,
  UploadedFile, Req, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { PrismaService } from '@common/prisma/prisma.service';

// ----------------------------------------------------------------
// UploadController
//
// Routes:
//   POST /api/v1/upload/logo             → upload business logo
//   POST /api/v1/upload/banner/:service  → upload service banner
//
// Both require multipart/form-data with a "file" field
// ----------------------------------------------------------------

@UseGuards(JwtGuard)
@Controller('upload')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly prisma:        PrismaService,
  ) {}

  // ----------------------------------------------------------------
  // Upload business logo
  // After upload, saves the URL to the business record automatically
  // ----------------------------------------------------------------
  @Post('logo')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },  // 5MB
    storage: undefined,                       // use memory storage (buffer)
  }))
  async uploadLogo(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded — send the image as "file" in form-data');

    const businessId = req.user.businessId;
    const result     = await this.uploadService.uploadLogo(businessId, file);

    // Auto-save URL to business record
    await this.prisma.business.update({
      where: { id: businessId },
      data:  { logoUrl: result.url },
    });

    return { message: 'Logo uploaded successfully', url: result.url };
  }

  // ----------------------------------------------------------------
  // Upload service banner image
  // :service = "GROCERY" | "ERRAND" | "CLEANING" | "header"
  // After upload, saves URL to serviceConfig.serviceBanners
  // ----------------------------------------------------------------
  @Post('banner/:service')

  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 5 * 1024 * 1024 },
  }))
  async uploadBanner(
    @Req() req: any,
    @Param('service') service: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded — send the image as "file" in form-data');

    const allowed = ['GROCERY', 'ERRAND', 'CLEANING', 'header'];
    if (!allowed.includes(service.toUpperCase()) && service !== 'header') {
      throw new BadRequestException(`service must be one of: ${allowed.join(', ')}`);
    }

    const businessId = req.user.businessId;
    const serviceKey = service.toUpperCase();
    const result     = await this.uploadService.uploadBanner(businessId, serviceKey, file);

    // Auto-save URL to serviceConfig.serviceBanners JSON
    const existing = await this.prisma.serviceConfig.findUnique({
      where:  { businessId },
      select: { serviceBanners: true },
    });

    const currentBanners = (existing?.serviceBanners as Record<string, string>) ?? {};
    const updatedBanners = { ...currentBanners, [serviceKey]: result.url };

    await this.prisma.serviceConfig.upsert({
      where:  { businessId },
      create: { businessId, serviceBanners: updatedBanners },
      update: { serviceBanners: updatedBanners },
    });

    return { message: `${serviceKey} banner uploaded successfully`, url: result.url };
  }
}
