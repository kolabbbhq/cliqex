import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtGuard } from '@modules/auth/guards/auth.guards';
import { Public } from '@common/decorators/public.decorator';
import { PaymentsService } from './payments.service';
import {
  ConfirmBankTransferInput,
  ListPaymentsInput,
} from './schemas/payments.schema';

@Controller('payments')
export class PaymentsController {
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
    await this.paymentsService.handlePaystackWebhook(req.body as Buffer, signature);
    return { received: true };
  }

  @UseGuards(JwtGuard)
  @Post(':orderId/bank-transfer/confirm')
  async confirmBankTransfer(
    @Param('orderId') orderId: string,
    @Req() req: Request & { user: { id: string } },
    @Body() input: ConfirmBankTransferInput,
  ) {
    await this.paymentsService.confirmBankTransfer(orderId, req.user.id, input);
    return { message: 'Bank transfer confirmed' };
  }

  @UseGuards(JwtGuard)
  @Get()
  async findAll(@Query() query: ListPaymentsInput) {
    return this.paymentsService.findAll(query);
  }

  @UseGuards(JwtGuard)
  @Get(':orderId')
  async findByOrder(@Param('orderId') orderId: string) {
    return this.paymentsService.findByOrder(orderId);
  }
}
