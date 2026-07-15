import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac } from 'crypto';
import axios from 'axios';

import { PaymentsRepository } from './payments.repository';
import { OrdersService } from '@modules/orders/orders.service';
import { CustomersService } from '@modules/customers/customers.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { EVENTS } from '@common/events/events.constants';
import {
  InitiatePaymentInput,
  ConfirmBankTransferInput,
  RejectBankTransferInput,
  ListPaymentsInput,
} from './schemas/payments.schema';
import { PaystackInitResponse, PaystackWebhookEvent, PaginatedPayments } from './payments.types';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly paystackSecret: string;
  private readonly paystackBaseUrl = 'https://api.paystack.co';

  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly ordersService: OrdersService,
    private readonly customersService: CustomersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContext,
  ) {
    this.paystackSecret = this.config.get<string>('PAYSTACK_SECRET_KEY')!;
  }

  // ----------------------------------------------------------------
  // Initiate payment — creates payment record + Paystack link
  // ----------------------------------------------------------------
  async initiatePaystack(orderId: string): Promise<PaystackInitResponse> {
    const order = await this.ordersService.findOne(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (order.status !== 'AWAITING_PAYMENT') {
      throw new BadRequestException(`Order must be in AWAITING_PAYMENT status to initiate payment`);
    }

    const existing = await this.paymentsRepository.findByOrderId(orderId);
    if (existing && existing.status === 'CONFIRMED') {
      throw new BadRequestException('Order is already paid');
    }

    const reference = `EB-${order.orderNumber}-${Date.now()}`;
    const amountKobo = Math.round(Number(order.total) * 100);

    const response = await this.callPaystack('POST', '/transaction/initialize', {
      amount: amountKobo,
      email: `${order.customer.phone}@errandsbuddy.com`,
      reference,
      channels: ['card', 'bank_transfer', 'ussd'], // customer picks on Paystack's page
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        phone: order.customer.phone,
      },
      callback_url: `${this.config.get('APP_URL')}/api/v1/payments/verify/${reference}`,
    });

    const { authorization_url, access_code } = response.data;

    await this.paymentsRepository.create({
      orderId,
      customerId: order.customerId,
      method: 'PAYSTACK',
      amount: Number(order.total),
      paystackRef: reference,
      paystackLink: authorization_url,
    });

    this.logger.log(`Paystack payment initiated: ${reference} — ₦${order.total}`);

    return {
      authorizationUrl: authorization_url,
      accessCode: access_code,
      reference,
    };
  }

  // ----------------------------------------------------------------
  // Handle Paystack webhook
  // Fires ORDER_PAID event — NotificationsService handles everything
  // ----------------------------------------------------------------
  async handlePaystackWebhook(rawBody: Buffer, signature: string): Promise<void> {
    this.verifyPaystackSignature(rawBody, signature);

    const event: PaystackWebhookEvent = JSON.parse(rawBody.toString());

    if (event.event !== 'charge.success') return;

    const { reference, status } = event.data;

    if (status !== 'success') return;

    await this.confirmPaystackPayment(reference);
  }

  // ----------------------------------------------------------------
  // Verify a Paystack payment directly (fallback for the customer's
  // browser redirect after paying — the webhook is the source of
  // truth, but it can lag or occasionally not arrive, and the
  // customer is sitting on a blank screen waiting).
  //
  // No JWT guard on this route (it's @Public), so there is no tenant
  // context yet — we resolve businessId from the payment record
  // itself and set it explicitly before touching any tenant-scoped
  // service, same pattern WhatsappService.handleWebhook already uses.
  // ----------------------------------------------------------------
  async verifyAndConfirmPaystack(reference: string): Promise<{
    status: 'PAID' | 'PENDING' | 'FAILED';
    orderNumber?: string;
  }> {
    const payment = await this.paymentsRepository.findByPaystackRef(reference);
    if (!payment) {
      throw new NotFoundException(`No payment found for reference ${reference}`);
    }

    this.tenantContext.set(payment.businessId, false);

    const order = await this.ordersService.findOne(payment.orderId);

    if (payment.status === 'CONFIRMED') {
      return { status: 'PAID', orderNumber: order.orderNumber };
    }

    const result = await this.callPaystack('GET', `/transaction/verify/${reference}`);
    const paystackStatus = result?.data?.status;

    if (paystackStatus === 'success') {
      await this.confirmPaystackPayment(reference);
      return { status: 'PAID', orderNumber: order.orderNumber };
    }

    if (paystackStatus === 'failed' || paystackStatus === 'abandoned') {
      return { status: 'FAILED', orderNumber: order.orderNumber };
    }

    return { status: 'PENDING', orderNumber: order.orderNumber };
  }

  // ----------------------------------------------------------------
  // Shared confirm logic — used by both the webhook and the
  // browser-redirect verify fallback. Idempotent. Also sets tenant
  // context itself since the webhook path has no JWT either.
  // ----------------------------------------------------------------
  private async confirmPaystackPayment(reference: string): Promise<void> {
    const payment = await this.paymentsRepository.findByPaystackRef(reference);

    if (!payment) {
      this.logger.warn(`confirmPaystackPayment: payment not found for ref ${reference}`);
      return;
    }

    this.tenantContext.set(payment.businessId, false);

    if (payment.status === 'CONFIRMED') {
      this.logger.log(`confirmPaystackPayment: ${reference} already confirmed — skipping`);
      return;
    }

    await this.paymentsRepository.confirm(payment.id);

    // markPaid auto-chains to markProcessing — events fire in sequence
    await this.ordersService.markPaid(payment.orderId);

    await this.customersService.incrementStats(payment.customerId, Number(payment.amount));

    this.eventEmitter.emit(EVENTS.PAYMENT_CONFIRMED, { payment });
    this.logger.log(`Payment confirmed: ${reference}`);
  }

  // ----------------------------------------------------------------
  // Admin manually confirms bank transfer
  // ----------------------------------------------------------------
  async confirmBankTransfer(
    orderId: string,
    adminId: string,
    input: ConfirmBankTransferInput,
  ): Promise<void> {
    const order = await this.ordersService.findOne(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (order.status !== 'AWAITING_PAYMENT') {
      throw new BadRequestException(`Order is not awaiting payment`);
    }

    let payment = await this.paymentsRepository.findByOrderId(orderId);

    const proofUrl = payment?.proofUrl ?? input.proofUrl ?? undefined;

    if (!payment) {
      payment = await this.paymentsRepository.create({
        orderId,
        customerId: order.customerId,
        method: 'BANK_TRANSFER',
        amount: Number(order.total),
        proofUrl,
      });
    }

    if (payment.status === 'CONFIRMED') {
      throw new BadRequestException('Payment already confirmed');
    }

    if (payment.status === 'REJECTED') {
      throw new BadRequestException('Payment was rejected — ask customer to resend proof');
    }

    if (!proofUrl) {
      this.logger.warn(
        `Confirming bank transfer for order ${order.orderNumber} with no proof on file — admin ${adminId}`,
      );
    }

    await this.paymentsRepository.confirm(payment.id, adminId, proofUrl);

    await this.ordersService.markPaid(orderId);

    await this.customersService.incrementStats(order.customerId, Number(order.total));

    this.eventEmitter.emit(EVENTS.PAYMENT_CONFIRMED, { payment });
    this.logger.log(`Bank transfer confirmed by admin ${adminId} for order ${order.orderNumber}`);
  }

  // ----------------------------------------------------------------
  // Admin manually rejects a bank transfer proof
  // ----------------------------------------------------------------
  async rejectBankTransfer(
    orderId: string,
    adminId: string,
    input: RejectBankTransferInput,
  ): Promise<void> {
    const order = await this.ordersService.findOne(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const payment = await this.paymentsRepository.findByOrderId(orderId);
    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);

    if (payment.status === 'CONFIRMED') {
      throw new BadRequestException('Payment already confirmed — cannot reject');
    }

    if (payment.status === 'REJECTED') {
      throw new BadRequestException('Payment already rejected');
    }

    await this.paymentsRepository.reject(payment.id, adminId, input.reason);

    this.eventEmitter.emit(EVENTS.PAYMENT_REJECTED, { payment, reason: input.reason });
    this.logger.log(
      `Bank transfer rejected by admin ${adminId} for order ${order.orderNumber}` +
        (input.reason ? ` — reason: ${input.reason}` : ''),
    );
  }

  // ----------------------------------------------------------------
  // Get paginated payments
  // ----------------------------------------------------------------
  async findAll(input: ListPaymentsInput): Promise<PaginatedPayments> {
    return this.paymentsRepository.findAll(input);
  }

  // ----------------------------------------------------------------
  // Preview bank transfer
  // ----------------------------------------------------------------
  async previewBankTransfer(orderId: string) {
    const order = await this.ordersService.findOne(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const payment = await this.paymentsRepository.findByOrderId(orderId);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      customer: order.customer,
      expectedAmount: Number(order.total),
      payment: payment
        ? {
            id: payment.id,
            method: payment.method,
            status: payment.status,
            proofUrl: payment.proofUrl ?? null,
            amount: Number(payment.amount),
          }
        : null,
    };
  }

  // ----------------------------------------------------------------
  // Get payment for a specific order
  // ----------------------------------------------------------------
  async findByOrder(orderId: string) {
    const payment = await this.paymentsRepository.findByOrderId(orderId);
    if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);
    return { ...payment, amount: Number(payment.amount) };
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------
  private verifyPaystackSignature(rawBody: Buffer, signature: string): void {
    const hash = createHmac('sha512', this.paystackSecret).update(rawBody).digest('hex');
    if (hash !== signature) {
      this.logger.error('Invalid Paystack webhook signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
  async exportCsv(filters: {
  status?: string;
  method?: string;
  startDate?: string;
  endDate?: string;
}): Promise<string> {
  const payments = await this.paymentsRepository.findAllForExport(filters);

  const esc = (val: unknown): string => {
    const str = String(val ?? '');
    return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const rows = payments.map((p) =>
    [
      p.order.orderNumber,
      p.customer.name ?? '',
      p.customer.phone,
      p.amount.toString(),
      p.method,
      p.status,
      p.createdAt.toISOString(),
    ]
      .map(esc)
      .join(','),
  );

  return [
    'Order Number,Customer Name,Customer Phone,Amount,Method,Status,Date',
    ...rows,
  ].join('\n');
}

  private async callPaystack(
    method: 'GET' | 'POST',
    path: string,
    data?: Record<string, any>,
  ): Promise<any> {
    try {
      const response = await axios({
        method,
        url: `${this.paystackBaseUrl}${path}`,
        data,
        headers: {
          Authorization: `Bearer ${this.paystackSecret}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data ?? error.message;
      this.logger.error(`Paystack API error: ${JSON.stringify(detail)}`);
      throw new BadRequestException('Payment provider error — please try again');
    }
  }
}