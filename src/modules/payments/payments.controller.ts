import {
  Controller,
  Get,
  Res,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Req,
  Logger,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { Public } from '@common/decorators/public.decorator';
import { PaymentsService } from './payments.service';

import {
  ListPaymentsDto,
  ConfirmBankTransferDto,
  RejectBankTransferDto,
} from './schemas/payments.schema';

@Controller('payments')
export class PaymentsController {
    private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtGuard)
  @Post(':orderId/paystack/initiate')
  async initiatePaystack(@Param('orderId') orderId: string) {
    return this.paymentsService.initiatePaystack(orderId);
  }

  @Public()
  @Post('paystack/webhook')
  @HttpCode(HttpStatus.OK)
  async paystackWebhook(
    @Req() req: Request,
    @Headers('x-paystack-signature') signature: string,
  ) {
await this.paymentsService.handlePaystackWebhook((req as any).rawBody as Buffer, signature);
    return { received: true };
  }

  @Public()
  @Get('verify/:reference')
  @HttpCode(HttpStatus.OK)
  async verifyPaystack(
    @Param('reference') reference: string,
    @Res() res: Response,
  ) {
    let result: { status: 'PAID' | 'PENDING' | 'FAILED'; orderNumber?: string };

    try {
      result = await this.paymentsService.verifyAndConfirmPaystack(reference);
    } catch (err: any) {
      this.logger.error(`verifyPaystack failed for ${reference}: ${err.message}`);
      result = { status: 'FAILED' };
    }

    res.setHeader('Content-Type', 'text/html');
    res.send(this.renderVerifyPage(result));
  }

  private renderVerifyPage(result: {
    status: 'PAID' | 'PENDING' | 'FAILED';
    orderNumber?: string;
  }): string {
    const copy = {
      PAID: {
        emoji: '✅',
        color: '#1a8a5e',
        title: 'Payment successful!',
        message: result.orderNumber
          ? `Your order <strong>${result.orderNumber}</strong> is confirmed. You can close this tab and go back to WhatsApp — we've sent you a confirmation there.`
          : `Your payment is confirmed. You can close this tab and go back to WhatsApp.`,
      },
      PENDING: {
        emoji: '⏳',
        color: '#c98a1d',
        title: 'Payment processing',
        message: `We're still confirming this with Paystack. Go back to WhatsApp — we'll message you there the moment it's confirmed.`,
      },
      FAILED: {
        emoji: '❌',
        color: '#c0392b',
        title: 'Payment not completed',
        message: `We couldn't confirm this payment. Go back to WhatsApp and try again, or choose bank transfer instead.`,
      },
    }[result.status];

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${copy.title}</title>
  <style>
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#f5f6f8; display:flex; align-items:center; justify-content:center;
      min-height:100vh; padding:24px; box-sizing:border-box; }
    .card { background:#fff; border-radius:16px; padding:40px 28px; max-width:380px; width:100%;
      text-align:center; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
    .emoji { font-size:48px; margin-bottom:16px; }
    h1 { font-size:20px; color:${copy.color}; margin:0 0 12px; }
    p { font-size:15px; color:#444; line-height:1.5; margin:0 0 24px; }
    a.btn { display:inline-block; background:#25D366; color:#fff; text-decoration:none;
      padding:12px 28px; border-radius:999px; font-weight:600; font-size:15px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">${copy.emoji}</div>
    <h1>${copy.title}</h1>
    <p>${copy.message}</p>
    <a class="btn" href="https://wa.me/">Return to WhatsApp</a>
  </div>
</body>
</html>`;
  }

  @UseGuards(JwtGuard)
  @Post('order/:orderId/confirm-transfer')
  async confirmBankTransfer(
    @Param('orderId') orderId: string,
    @Req() req: Request & { user: { id: string } },
    @Body() input: ConfirmBankTransferDto,
  ) {
    await this.paymentsService.confirmBankTransfer(orderId, req.user.id, input);
    return { message: 'Bank transfer confirmed' };
  }

  @UseGuards(JwtGuard)
  @Post('order/:orderId/reject-transfer')
  async rejectBankTransfer(
    @Param('orderId') orderId: string,
    @Req() req: Request & { user: { id: string } },
    @Body() input: RejectBankTransferDto,
  ) {
    await this.paymentsService.rejectBankTransfer(orderId, req.user.id, input);
    return { message: 'Bank transfer rejected' };
  }

  @UseGuards(JwtGuard)
  @Get('order/:orderId/preview')
  async previewBankTransfer(@Param('orderId') orderId: string) {
    return this.paymentsService.previewBankTransfer(orderId);
  }

  @UseGuards(JwtGuard)
  @Get()
  async findAll(@Query() query: ListPaymentsDto) {
    return this.paymentsService.findAll(query);
  }

  @UseGuards(JwtGuard)
  @Get(':orderId')
  async findByOrder(@Param('orderId') orderId: string) {
    return this.paymentsService.findByOrder(orderId);
  }
}