import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@common/prisma/prisma.service';
import { WhatsappService } from '@modules/whatsapp/whatsapp.service';
import { PdfService } from '@modules/pdf/pdf.service';
import { UploadService } from '@modules/upload/upload.service';
import { EmailService } from '@modules/email/email.service';
import { Templates } from '@modules/whatsapp/templates/messages.template';
import { EVENTS } from '@common/events/events.constants';
import { TenantContext } from '@common/tenant/tenant-context.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly pdfService: PdfService,
    private readonly uploadService: UploadService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ----------------------------------------------------------------
  // ORDER_CREATED → email all active admins
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_CREATED)
  async onOrderCreated(payload: { order: any }): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { name: true, phone: true } },
          items: { select: { name: true, quantity: true } },
          business: { select: { name: true } },
        },
      });

      if (!order) return;

      const admins = await this.prisma.admin.findMany({
        where: { businessId: order.businessId, isActive: true },
        select: { email: true },
      });

      const adminEmails = admins.map((a) => a.email);
      if (!adminEmails.length) return;

      const crmUrl = this.config.get<string>('CRM_URL', 'https://your-crm.vercel.app');
      const areaLabel = (order.flowData as any)?.areaLabel ?? null;
      const serviceLabel = (order.flowData as any)?.serviceLabel ?? order.serviceType;

      // ✅ sendNewOrderAlert now returns true/false — only log success
      // if the email actually went out, instead of assuming it did.
      const sent = await this.emailService.sendNewOrderAlert({
        adminEmails,
        orderNumber: order.orderNumber,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        serviceType: order.serviceType,
        serviceLabel,
        items: order.items,
        areaLabel,
        businessName: order.business.name,
        crmUrl,
      });

      if (sent) {
        this.logger.log(`[NOTIFY] New order email sent for ${order.orderNumber}`);
      } else {
        this.logger.warn(
          `[NOTIFY] New order email FAILED for ${order.orderNumber} — see EmailService logs above for the reason`,
        );
      }
    } catch (err: any) {
      this.logger.error(`[NOTIFY] onOrderCreated email failed: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------
  // ORDER_PAID → generate & send PDF receipt ONLY
  // No text message here — that fires on ORDER_PROCESSING below
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_PAID)
  async onOrderPaid(payload: { order: any }): Promise<void> {
    this.logger.log(`[NOTIFY] order.paid → ${payload.order.orderNumber}`);

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          items: true,
          customer: { select: { id: true, phone: true, name: true } },
          business: true,
          payment: true,
        },
      });

      if (!order) {
        this.logger.error(`[NOTIFY] onOrderPaid: order ${payload.order.id} not found`);
        return;
      }

      this.tenantContext.set(order.businessId, false);

      if (!order.payment) {
        this.logger.warn(
          `[NOTIFY] onOrderPaid: no payment record for order ${order.orderNumber} — skipping PDF`,
        );
        return;
      }

      if (!order.business.whatsappToken || !order.business.whatsappPhoneId) {
        this.logger.warn(
          `[NOTIFY] onOrderPaid: business ${order.businessId} has no WhatsApp credentials — skipping`,
        );
        return;
      }

      const normalisedOrder = {
        ...order,
        subtotal: Number(order.subtotal),
        deliveryFee: Number(order.deliveryFee),
        serviceCharge: Number(order.serviceCharge),
        vatAmount: Number(order.vatAmount),
        total: Number(order.total),
        items: order.items.map((i) => ({
          ...i,
          unitPrice: i.unitPrice !== null ? Number(i.unitPrice) : null,
          aiSuggestedPrice:
            i.aiSuggestedPrice !== null ? Number(i.aiSuggestedPrice) : null,
        })),
      };

      this.logger.log(`[NOTIFY] Generating PDF receipt for ${order.orderNumber}`);

      const pdfBuffer = await this.pdfService.generateReceipt({
        order: normalisedOrder as any,
        business: order.business,
        payment: order.payment,
      });

      const filename = `Receipt-${order.orderNumber}`;

      const { url: pdfUrl } = await this.uploadService.uploadDocument(
        pdfBuffer,
        order.businessId,
        filename,
      );

      this.logger.log(`[NOTIFY] PDF uploaded: ${pdfUrl}`);

      const receiptTemplate = Templates.paymentReceipt(order.orderNumber);

      await this.whatsappService.sendDocument({
        to: order.customer.phone,
        documentUrl: pdfUrl,
        filename: `Receipt-${order.orderNumber}.pdf`,
        caption: receiptTemplate.body,
        token: order.business.whatsappToken,
        phoneId: order.business.whatsappPhoneId,
      });

      this.logger.log(
        `[NOTIFY] Receipt sent to ${order.customer.phone} for order ${order.orderNumber}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[NOTIFY] onOrderPaid failed for ${payload.order.orderNumber}: ${err.message}`,
      );
    }
  }

  // ----------------------------------------------------------------
  // ORDER_PROCESSING → "Payment confirmed" + "Order being prepared"
  // Fires automatically right after PAID (see OrdersService.markPaid).
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_PROCESSING)
  async onOrderProcessing(payload: { order: any }): Promise<void> {
    this.logger.log(`[NOTIFY] order.processing → ${payload.order.orderNumber}`);

    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true } },
          business: { select: { whatsappToken: true } },
        },
      });

      if (!order) return;

      this.tenantContext.set(payload.order.businessId, false);

      const token = order.business.whatsappToken
        ? { token: order.business.whatsappToken }
        : {};

      // Message 1: Payment confirmed
      const confirmedTemplate = Templates.paymentConfirmed(
        payload.order.orderNumber,
        payload.order.serviceType,
      );
      await this.whatsappService.sendText({
        to: order.customer.phone,
        message: confirmedTemplate.body,
        ...token,
      });

      // Message 2: Order being prepared
      const preparedTemplate = Templates.orderBeingPrepared();
      await this.whatsappService.sendText({
        to: order.customer.phone,
        message: preparedTemplate.body,
        ...token,
      });

      this.logger.log(`[NOTIFY] Processing messages sent → ${payload.order.orderNumber}`);
    } catch (err: any) {
      this.logger.error(`[NOTIFY] onOrderProcessing failed: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------
  // ORDER_ASSIGNED → "Your buddy X is assigned"
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_ASSIGNED)
  async onOrderAssigned(payload: { order: any; buddyId: string }): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true, name: true } },
          buddy: { select: { name: true } },
          business: {
            select: {
              whatsappToken: true,
              estimatedDeliveryMin: true,
              estimatedDeliveryMax: true,
              estimatedDeliveryUnit: true,
            },
          },
        },
      });

      if (!order?.buddy) return;

      this.tenantContext.set(payload.order.businessId, false);

      const unitLabel = order.business.estimatedDeliveryUnit === 'hours' ? 'hrs' : 'mins';
      const eta = `${order.business.estimatedDeliveryMin ?? 30}–${order.business.estimatedDeliveryMax ?? 60} ${unitLabel}`;

      const { body } = Templates.buddyAssigned({
        orderNumber: order.orderNumber,
        buddyName: order.buddy.name,
        eta,
        serviceType: order.serviceType,
      });

      await this.whatsappService.sendText({
        to: order.customer.phone,
        message: body,
        ...(order.business.whatsappToken && { token: order.business.whatsappToken }),
      });

      this.logger.log(`[NOTIFY] order.assigned → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.assigned failed: ${err}`);
    }
  }

  // ----------------------------------------------------------------
  // ORDER_IN_TRANSIT → "Buddy is on the way"
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_IN_TRANSIT)
  async onOrderInTransit(payload: { order: any }): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true } },
          buddy: { select: { name: true } },
          business: { select: { whatsappToken: true } },
        },
      });

      if (!order) return;

      this.tenantContext.set(payload.order.businessId, false);

      const template = Templates.inTransit({
        orderNumber: order.orderNumber,
        buddyName: order.buddy?.name ?? 'Your Buddy',
        serviceType: order.serviceType,
      });

      await this.whatsappService.sendText({
        to: order.customer.phone,
        message: template.body,
        ...(order.business.whatsappToken && { token: order.business.whatsappToken }),
      });

      this.logger.log(`[NOTIFY] order.in_transit → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.in_transit failed: ${err}`);
    }
  }

  // ----------------------------------------------------------------
  // ORDER_DELIVERED → "Delivered! How was your experience?"
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_DELIVERED)
  async onOrderDelivered(payload: { order: any }): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true, name: true } },
          business: { select: { whatsappToken: true } },
        },
      });

      if (!order) return;

      this.tenantContext.set(payload.order.businessId, false);

      const template = Templates.delivered(order.customer.name, order.serviceType);

      await this.whatsappService.sendButtons({
        to: order.customer.phone,
        body: template.body,
        buttons: template.buttons,
        ...(order.business.whatsappToken && { token: order.business.whatsappToken }),
      });

      this.logger.log(`[NOTIFY] order.delivered → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.delivered failed: ${err}`);
    }
  }

  // ----------------------------------------------------------------
  // PAYMENT_REJECTED → tell customer their proof was rejected,
  // ask them to resend a clearer screenshot
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.PAYMENT_REJECTED)
  async onPaymentRejected(payload: { payment: any; reason?: string }): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({
        where: { id: payload.payment.id },
        include: {
          customer: { select: { phone: true } },
          order: { select: { orderNumber: true, businessId: true } },
        },
      });

      if (!payment) return;

      this.tenantContext.set(payment.order.businessId, false);

      const business = await this.prisma.business.findUnique({
        where: { id: payment.order.businessId },
        select: { whatsappToken: true },
      });

      const reasonLine = payload.reason ? `\n\nReason: ${payload.reason}` : '';
      const message =
        `We could not verify your payment proof for order ${payment.order.orderNumber}. 😕${reasonLine}\n\n` +
        `Please send a clearer screenshot of your bank transfer, showing the amount, date, and reference.`;

      await this.whatsappService.sendText({
        to: payment.customer.phone,
        message,
        ...(business?.whatsappToken && { token: business.whatsappToken }),
      });

      this.logger.log(`[NOTIFY] payment.rejected → order ${payment.order.orderNumber}`);
    } catch (err: any) {
      this.logger.error(`[NOTIFY] onPaymentRejected failed: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------
  // ORDER_CANCELLED → "Your order has been cancelled"
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_CANCELLED)
  async onOrderCancelled(payload: { order: any }): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true } },
          business: { select: { whatsappToken: true } },
        },
      });

      if (!order) return;

      this.tenantContext.set(payload.order.businessId, false);

      const template = Templates.orderCancelled(order.orderNumber);

      await this.whatsappService.sendText({
        to: order.customer.phone,
        message: template.body,
        ...(order.business.whatsappToken && { token: order.business.whatsappToken }),
      });

      this.logger.log(`[NOTIFY] order.cancelled → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.cancelled failed: ${err}`);
    }
  }
}