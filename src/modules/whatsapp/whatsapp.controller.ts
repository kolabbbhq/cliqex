import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Res,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  RawBodyRequest,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from '@modules/upload/upload.service';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { WhatsappService } from './whatsapp.service';
import { WhatsAppWebhookPayload, WhatsAppFlowWebhookPayload } from './whatsapp.types';
import { Public } from '@common/decorators/public.decorator';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly config: ConfigService,
      private readonly uploadService: UploadService,

  ) {}

  // ----------------------------------------------------------------
  // GET /api/v1/whatsapp/webhook
  // Meta calls this once to verify your webhook URL
  // ----------------------------------------------------------------
  @Public()
  @Get('webhook')
  @ApiOperation({ summary: 'Meta webhook verification' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = this.whatsappService.verifyWebhook(mode, token, challenge);
    if (result) return res.status(200).send(result);
    return res.sendStatus(403);
  }

  // ----------------------------------------------------------------
  // POST /api/v1/whatsapp/webhook
  // Meta sends every customer message here.
  // Verified with HMAC-SHA256 signature before processing.
  // ----------------------------------------------------------------
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive inbound WhatsApp messages from Meta' })
  async receiveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string,
    @Res() res: Response,
  ) {
    // ✅ Reject immediately if signature header is missing
    if (!signature) {
      this.logger.warn('Missing x-hub-signature-256 header — rejecting webhook');
      return res.sendStatus(403);
    }

    const appSecret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      this.logger.error('WHATSAPP_APP_SECRET not configured — cannot verify webhook');
      return res.sendStatus(500);
    }

    // ✅ Verify HMAC-SHA256 signature against raw body
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.error('Raw body not available — ensure rawBody: true in NestFactory.create()');
      return res.sendStatus(500);
    }

    const expectedSignature =
      'sha256=' +
      crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

 const sigBuf      = Buffer.from(signature);
const expectedBuf = Buffer.from(expectedSignature);

if (sigBuf.length !== expectedBuf.length) {
  this.logger.warn(`Signature length mismatch — rejecting`);
  return res.sendStatus(403);
}

const isValid = crypto.timingSafeEqual(sigBuf, expectedBuf);

    if (!isValid) {
      this.logger.warn(
        `Invalid webhook signature — got: ${signature} expected: ${expectedSignature}`,
      );
      return res.sendStatus(403);
    }

    // ✅ Signature valid — process async, return 200 immediately
    const payload = JSON.parse(rawBody.toString('utf-8')) as WhatsAppWebhookPayload;
    this.whatsappService.handleWebhook(payload).catch((err) => {
      this.logger.error(`Webhook processing error: ${err.message}`, err.stack);
    });

    return res.json({ status: 'ok' });
  }

  // ----------------------------------------------------------------
  // POST /api/v1/whatsapp/webhook/flow/:businessId
  // Meta Flow data exchange endpoint — no signature check here,
  // payload is encrypted with AES-128-GCM + RSA key pair already.
  // ----------------------------------------------------------------
  @Public()
  @Post('webhook/flow/:businessId')
  async flowWebhook(
    @Param('businessId') businessId: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    const responseB64 = await this.whatsappService.handleFlowWebhook(body, businessId);
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(responseB64);
  }

  // ----------------------------------------------------------------
  // GET /api/v1/whatsapp/thread/:orderId
  // Protected — CRM loads the chat thread for an order
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Get('thread/:orderId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp conversation thread for an order' })
  async getOrderThread(@Param('orderId') orderId: string) {
    return this.whatsappService.getOrderThread(orderId);
  }

  // ----------------------------------------------------------------
  // POST /api/v1/whatsapp/thread/:orderId/reply
  // Protected — admin sends a manual WhatsApp reply
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Post('thread/:orderId/reply')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin sends a manual WhatsApp message for this order' })
  async replyToOrder(
    @Param('orderId') orderId: string,
    @Body() dto: { message: string },
  ) {
    await this.whatsappService.sendManualReply(orderId, dto.message);
    return { message: 'Reply sent' };
  }
@UseGuards(JwtGuard)
@Post('thread/:orderId/reply/image')
@HttpCode(HttpStatus.OK)
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
async sendImageReply(
  @Param('orderId') orderId: string,
  @UploadedFile() file: Express.Multer.File,
  @Body('caption') caption: string | undefined,
  @Req() req: any,
) {
  if (!file) throw new BadRequestException('No file uploaded');
  const businessId = req.user.businessId;
  const { url } = await this.uploadService.uploadCustomerMedia(file.buffer, businessId);
  await this.whatsappService.sendManualImageReply(orderId, url, caption);
  return { message: 'Image sent' };
}
  
}