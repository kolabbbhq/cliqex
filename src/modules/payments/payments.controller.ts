import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Headers,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { PaymentsService } from './payments.service';
import { ConfirmBankTransferDto, ListPaymentsDto } from './dto/payments.dto';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '@modules/auth/auth.types';
import { Public } from '@common/decorators/public.decorator';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ----------------------------------------------------------------
  // POST /api/v1/payments/webhook/paystack
  // Public — Paystack POSTs here when payment succeeds
  // Needs raw body for signature verification
  // ----------------------------------------------------------------
  @Public()
  @Post('webhook/paystack')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paystack payment webhook — do not call manually' })
  async paystackWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    await this.paymentsService.handlePaystackWebhook(req.rawBody!, signature);
    return { status: 'ok' };
  }

  // ----------------------------------------------------------------
  // GET /api/v1/payments?status=PENDING&page=1
  // Protected — CRM payments tab
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all payments — CRM payments tab' })
  async findAll(@Query() query: ListPaymentsDto) {
    return this.paymentsService.findAll(query);
  }

  // ----------------------------------------------------------------
  // GET /api/v1/payments/order/:orderId
  // Protected — get payment for a specific order
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Get('order/:orderId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payment record for an order' })
  async findByOrder(@Param('orderId') orderId: string) {
    return this.paymentsService.findByOrder(orderId);
  }

  // ----------------------------------------------------------------
  // POST /api/v1/payments/order/:orderId/confirm-transfer
  // Protected — admin manually confirms bank transfer
  // ----------------------------------------------------------------
  @UseGuards(JwtGuard)
  @Post('order/:orderId/confirm-transfer')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin manually confirms bank transfer payment' })
  async confirmBankTransfer(
    @Param('orderId') orderId: string,
    @Body() dto: ConfirmBankTransferDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.paymentsService.confirmBankTransfer(orderId, admin.id, dto);
    return { message: 'Payment confirmed successfully' };
  }
}
