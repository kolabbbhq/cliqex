import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

// ----------------------------------------------------------------
// UploadService
//
// Handles image uploads for business logos, banner images,
// customer media (payment proofs), and PDF documents (receipts).
// Uses Cloudinary — install with: npm install cloudinary
//
// Required .env vars:
//   CLOUDINARY_CLOUD_NAME=xxx
//   CLOUDINARY_API_KEY=xxx
//   CLOUDINARY_API_SECRET=xxx
// ----------------------------------------------------------------
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  // ----------------------------------------------------------------
  // uploadLogo — uploads a business logo
  // Returns the public URL
  // ----------------------------------------------------------------
  async uploadLogo(businessId: string, file: Express.Multer.File): Promise<{ url: string }> {
    this.validateImage(file);

    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: `errandsbuddy/businesses/${businessId}`,
            public_id: 'logo',
            overwrite: true,
            transformation: [
              { width: 400, height: 400, crop: 'fit' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        )
        .end(file.buffer);
    });

    this.logger.log(`Logo uploaded for business ${businessId}: ${result.secure_url}`);
    return { url: result.secure_url };
  }

  // ----------------------------------------------------------------
  // uploadBanner — uploads a service banner image
  // serviceKey is "GROCERY", "ERRAND", "CLEANING" or "header"
  // ----------------------------------------------------------------
  async uploadBanner(
    businessId: string,
    serviceKey: string,
    file: Express.Multer.File,
  ): Promise<{ url: string }> {
    this.validateImage(file);

    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: `errandsbuddy/businesses/${businessId}/banners`,
            public_id: serviceKey.toLowerCase(),
            overwrite: true,
            transformation: [
              { width: 800, height: 400, crop: 'fill', gravity: 'center' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        )
        .end(file.buffer);
    });

    this.logger.log(`Banner uploaded for ${businessId}/${serviceKey}: ${result.secure_url}`);
    return { url: result.secure_url };
  }

  // ----------------------------------------------------------------
  // uploadCustomerMedia — uploads a payment proof image sent by a
  // customer via WhatsApp (already resolved from Meta CDN)
  // ----------------------------------------------------------------
  async uploadCustomerMedia(buffer: Buffer, businessId: string): Promise<{ url: string }> {
    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: `errandsbuddy/businesses/${businessId}/customer-media`,
            resource_type: 'auto',
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        )
        .end(buffer);
    });

    this.logger.log(`Customer media uploaded for ${businessId}: ${result.secure_url}`);
    return { url: result.secure_url };
  }

  // ----------------------------------------------------------------
  // uploadDocument — uploads a PDF buffer as a raw Cloudinary asset
  //
  // resource_type: 'raw' is required for PDFs so Cloudinary serves
  // the file with the correct Content-Type rather than treating it
  // as an image.
  //
  // Folder: errandsbuddy/businesses/{businessId}/receipts
  // ----------------------------------------------------------------
  async uploadDocument(
    buffer: Buffer,
    businessId: string,
    filename: string,
  ): Promise<{ url: string }> {
    const result = await new Promise<any>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: `errandsbuddy/businesses/${businessId}/receipts`,
            public_id: filename.replace(/\.pdf$/i, ''),  // Cloudinary adds extension via format
            resource_type: 'raw',                         // required for PDFs
            format: 'pdf',
            overwrite: true,
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        )
        .end(buffer);
    });

    this.logger.log(`Receipt PDF uploaded for ${businessId}: ${result.secure_url}`);
    return { url: result.secure_url };
  }

  // ----------------------------------------------------------------
  // Validate file is an image and within size limit
  // ----------------------------------------------------------------
  private validateImage(file: Express.Multer.File): void {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const maxSizeBytes = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG and WebP images are allowed');
    }

    if (file.size > maxSizeBytes) {
      throw new BadRequestException('Image must be under 5MB');
    }
  }
}