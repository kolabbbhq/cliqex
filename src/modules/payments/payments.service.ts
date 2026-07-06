// import {
//   Injectable,
//   NotFoundException,
//   BadRequestException,
//   Logger,
//   UnauthorizedException,
// } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { EventEmitter2 } from '@nestjs/event-emitter';
// import { createHmac } from 'crypto';
// import axios from 'axios';

// import { PaymentsRepository } from './payments.repository';
// import { OrdersService } from '@modules/orders/orders.service';
// import { CustomersService } from '@modules/customers/customers.service';
// import { WhatsappService } from '@modules/whatsapp/whatsapp.service';
// import { Templates } from '@modules/whatsapp/templates/messages.template';
// import { EVENTS } from '@common/events/events.constants';
// import {
//   InitiatePaymentInput,
//   ConfirmBankTransferInput,
//   ListPaymentsInput,
// } from './schemas/payments.schema';
// import { PaystackInitResponse, PaystackWebhookEvent, PaginatedPayments } from './payments.types';

// @Injectable()
// export class PaymentsService {
//   private readonly logger = new Logger(PaymentsService.name);
//   private readonly paystackSecret: string;
//   private readonly paystackBaseUrl = 'https://api.paystack.co';

//   constructor(
//     private readonly paymentsRepository: PaymentsRepository,
//     private readonly ordersService: OrdersService,
//     private readonly customersService: CustomersService,
//     private readonly whatsappService: WhatsappService,
//     private readonly eventEmitter: EventEmitter2,
//     private readonly config: ConfigService,
//   ) {
//     this.paystackSecret = this.config.get<string>('PAYSTACK_SECRET_KEY')!;
//   }

//   // ----------------------------------------------------------------
//   // Initiate payment — creates payment record + Paystack link
//   // Called by WhatsappModule when customer chooses "Pay online"
//   // ----------------------------------------------------------------
//   async initiatePaystack(orderId: string): Promise<PaystackInitResponse> {
//     const order = await this.ordersService.findOne(orderId);

//     if (!order) throw new NotFoundException(`Order ${orderId} not found`);

//     if (order.status !== 'AWAITING_PAYMENT') {
//       throw new BadRequestException(`Order must be in AWAITING_PAYMENT status to initiate payment`);
//     }

//     // Check no payment already exists
//     const existing = await this.paymentsRepository.findByOrderId(orderId);
//     if (existing && existing.status === 'CONFIRMED') {
//       throw new BadRequestException('Order is already paid');
//     }

//     // Initialize with Paystack API
//     const reference = `EB-${order.orderNumber}-${Date.now()}`;
//     const amountKobo = Math.round(Number(order.total) * 100);

//     const response = await this.callPaystack('POST', '/transaction/initialize', {
//       amount: amountKobo,
//       email: `${order.customer.phone}@errandsbuddy.com`, // placeholder email
//       reference,
//       metadata: {
//         orderId: order.id,
//         orderNumber: order.orderNumber,
//         phone: order.customer.phone,
//       },
//       callback_url: `${this.config.get('APP_URL')}/payments/verify/${reference}`,
//     });

//     const { authorization_url, access_code } = response.data;

//     // Save payment record
//     await this.paymentsRepository.create({
//       orderId,
//       customerId: order.customerId,
//       method: 'PAYSTACK',
//       amount: Number(order.total),
//       paystackRef: reference,
//       paystackLink: authorization_url,
//     });

//     this.logger.log(`Paystack payment initiated: ${reference} — ₦${order.total}`);

//     return {
//       authorizationUrl: authorization_url,
//       accessCode: access_code,
//       reference,
//     };
//   }

//   // ----------------------------------------------------------------
//   // Handle Paystack webhook — called by Paystack when payment succeeds
//   // This is fully automatic — no admin needed
//   // ----------------------------------------------------------------
//   async handlePaystackWebhook(rawBody: Buffer, signature: string): Promise<void> {
//     // Verify the webhook is genuinely from Paystack
//     this.verifyPaystackSignature(rawBody, signature);

//     const event: PaystackWebhookEvent = JSON.parse(rawBody.toString());

//     if (event.event !== 'charge.success') return;

//     const { reference, status } = event.data;

//     if (status !== 'success') return;

//     const payment = await this.paymentsRepository.findByPaystackRef(reference);

//     if (!payment) {
//       this.logger.warn(`Paystack webhook: payment not found for ref ${reference}`);
//       return;
//     }

//     if (payment.status === 'CONFIRMED') {
//       this.logger.log(`Paystack webhook: payment ${reference} already confirmed — skipping`);
//       return;
//     }

//     // Confirm the payment
//     await this.paymentsRepository.confirm(payment.id);

//     // Move order to PAID
//     await this.ordersService.markPaid(payment.orderId);

//     // Update customer lifetime stats
//     await this.customersService.incrementStats(payment.customerId, Number(payment.amount));

//     // Get updated order for notification
//     const order = await this.ordersService.findOne(payment.orderId);

//     // Send WhatsApp confirmation to customer
//     const template = Templates.paymentConfirmed(order.orderNumber);
//     await this.whatsappService.sendText({
//       to: order.customer.phone,
//       message: template.body,
//     });

//     this.eventEmitter.emit(EVENTS.PAYMENT_CONFIRMED, { payment, order });
//     this.logger.log(`Payment confirmed: ${reference} for order ${order.orderNumber}`);
//   }

//   // ----------------------------------------------------------------
//   // Admin manually confirms bank transfer
//   // Used when customer sends transfer receipt via WhatsApp
//   // ----------------------------------------------------------------
//   async confirmBankTransfer(
//     orderId: string,
//     adminId: string,
//     input: ConfirmBankTransferInput,
//   ): Promise<void> {
//     const order = await this.ordersService.findOne(orderId);

//     if (!order) throw new NotFoundException(`Order ${orderId} not found`);

//     if (order.status !== 'AWAITING_PAYMENT') {
//       throw new BadRequestException(`Order is not awaiting payment`);
//     }

//     // Find or create payment record for bank transfer
//     let payment = await this.paymentsRepository.findByOrderId(orderId);

//     if (!payment) {
//       payment = await this.paymentsRepository.create({
//         orderId,
//         customerId: order.customerId,
//         method: 'BANK_TRANSFER',
//         amount: Number(order.total),
//         proofUrl: input.proofUrl,
//       });
//     }

//     if (payment.status === 'CONFIRMED') {
//       throw new BadRequestException('Payment already confirmed');
//     }

//     // Confirm payment
//     await this.paymentsRepository.confirm(payment.id, adminId, input.proofUrl);

//     // Move order to PAID
//     await this.ordersService.markPaid(orderId);

//     // Update customer stats
//     await this.customersService.incrementStats(order.customerId, Number(order.total));
//     // Send WhatsApp confirmation to customer
//     const template = Templates.paymentConfirmed(order.orderNumber);
//     await this.whatsappService.sendText({
//       to: order.customer.phone,
//       message: template.body,
//     });

//     this.eventEmitter.emit(EVENTS.PAYMENT_CONFIRMED, { payment, order });
//     this.logger.log(`Bank transfer confirmed by admin ${adminId} for order ${order.orderNumber}`);
//   }

//   // ----------------------------------------------------------------
//   // Get paginated payments — CRM payments tab
//   // ----------------------------------------------------------------
//   async findAll(input: ListPaymentsInput): Promise<PaginatedPayments> {
//     return this.paymentsRepository.findAll(input);
//   }

//   // ----------------------------------------------------------------
//   // Get payment for a specific order
//   // ----------------------------------------------------------------
//   async findByOrder(orderId: string) {
//     const payment = await this.paymentsRepository.findByOrderId(orderId);

//     if (!payment) throw new NotFoundException(`No payment found for order ${orderId}`);

//     return { ...payment, amount: Number(payment.amount) };
//   }

//   // ----------------------------------------------------------------
//   // Private: verify Paystack webhook signature
//   // Prevents fake webhooks from hitting our endpoint
//   // ----------------------------------------------------------------
//   private verifyPaystackSignature(rawBody: Buffer, signature: string): void {
//     const hash = createHmac('sha512', this.paystackSecret).update(rawBody).digest('hex');

//     if (hash !== signature) {
//       this.logger.error('Invalid Paystack webhook signature');
//       throw new UnauthorizedException('Invalid webhook signature');
//     }
//   }

//   // ----------------------------------------------------------------
//   // Private: call Paystack REST API
//   // ----------------------------------------------------------------
//   private async callPaystack(
//     method: 'GET' | 'POST',
//     path: string,
//     data?: Record<string, any>,
//   ): Promise<any> {
//     try {
//       const response = await axios({
//         method,
//         url: `${this.paystackBaseUrl}${path}`,
//         data,
//         headers: {
//           Authorization: `Bearer ${this.paystackSecret}`,
//           'Content-Type': 'application/json',
//         },
//       });

//       return response.data;
//     } catch (error: any) {
//       const detail = error.response?.data ?? error.message;
//       this.logger.error(`Paystack API error: ${JSON.stringify(detail)}`);
//       throw new BadRequestException('Payment provider error — please try again');
//     }
//   }
// }



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
import { EVENTS } from '@common/events/events.constants';
import {
  InitiatePaymentInput,
  ConfirmBankTransferInput,
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
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        phone: order.customer.phone,
      },
      callback_url: `${this.config.get('APP_URL')}/payments/verify/${reference}`,
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

    const payment = await this.paymentsRepository.findByPaystackRef(reference);

    if (!payment) {
      this.logger.warn(`Paystack webhook: payment not found for ref ${reference}`);
      return;
    }

    if (payment.status === 'CONFIRMED') {
      this.logger.log(`Paystack webhook: payment ${reference} already confirmed — skipping`);
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

    if (!payment) {
      payment = await this.paymentsRepository.create({
        orderId,
        customerId: order.customerId,
        method: 'BANK_TRANSFER',
        amount: Number(order.total),
        proofUrl: input.proofUrl,
      });
    }

    if (payment.status === 'CONFIRMED') {
      throw new BadRequestException('Payment already confirmed');
    }

    await this.paymentsRepository.confirm(payment.id, adminId, input.proofUrl);

    // markPaid auto-chains to markProcessing — events fire in sequence
    await this.ordersService.markPaid(orderId);

    await this.customersService.incrementStats(order.customerId, Number(order.total));

    this.eventEmitter.emit(EVENTS.PAYMENT_CONFIRMED, { payment });
    this.logger.log(`Bank transfer confirmed by admin ${adminId} for order ${order.orderNumber}`);
  }

  // ----------------------------------------------------------------
  // Get paginated payments
  // ----------------------------------------------------------------
  async findAll(input: ListPaymentsInput): Promise<PaginatedPayments> {
    return this.paymentsRepository.findAll(input);
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