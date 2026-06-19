import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@common/prisma/prisma.service';
import { WhatsappService } from '@modules/whatsapp/whatsapp.service';
import { Templates } from '@modules/whatsapp/templates/messages.template';
import { EVENTS } from '@common/events/events.constants';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService,
  ) {}

  // ----------------------------------------------------------------
  // order.quoted → nothing to send, quote already sent by QuotesService
  // ----------------------------------------------------------------

  // ----------------------------------------------------------------
  // order.paid → "Payment confirmed, we're on it"
  // Sent automatically by PaymentsService — handler here for logging
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_PAID)
  async onOrderPaid(payload: { order: any }) {
    this.logger.log(`[NOTIFY] order.paid → ${payload.order.orderNumber}`);
  }

  // ----------------------------------------------------------------
  // order.assigned → "Your buddy X is assigned"
  // Fires when admin assigns a buddy from CRM
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_ASSIGNED)
  async onOrderAssigned(payload: { order: any; buddyId: string }) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true, name: true } },
          buddy: { select: { name: true, phone: true } },
        },
      });

      if (!order?.buddy) return;

      const template = Templates.buddyAssigned({
        orderNumber: order.orderNumber,
        buddyName: order.buddy.name,
        buddyPhone: order.buddy.phone,
        eta: '30–45 mins',
      });

      await this.whatsappService.sendButtons({
        to: order.customer.phone,
        body: template.body,
        buttons: template.buttons,
      });

      this.logger.log(`[NOTIFY] order.assigned → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.assigned failed: ${err}`);
    }
  }

  // ----------------------------------------------------------------
  // order.in_transit → "Buddy is on the way"
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_IN_TRANSIT)
  async onOrderInTransit(payload: { order: any }) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true } },
          buddy: { select: { name: true } },
        },
      });

      if (!order) return;

      const template = Templates.inTransit({
        orderNumber: order.orderNumber,
        buddyName: order.buddy?.name ?? 'Your Buddy',
      });

      await this.whatsappService.sendText({
        to: order.customer.phone,
        message: template.body,
      });

      this.logger.log(`[NOTIFY] order.in_transit → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.in_transit failed: ${err}`);
    }
  }

  // ----------------------------------------------------------------
  // order.delivered → "Delivered! How was your experience?"
  // Rating buttons allow 1-tap review
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_DELIVERED)
  async onOrderDelivered(payload: { order: any }) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true, name: true } },
        },
      });

      if (!order) return;

      const template = Templates.delivered(order.customer.name);

      await this.whatsappService.sendButtons({
        to: order.customer.phone,
        body: template.body,
        buttons: template.buttons,
      });

      this.logger.log(`[NOTIFY] order.delivered → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.delivered failed: ${err}`);
    }
  }

  // ----------------------------------------------------------------
  // order.cancelled → "Your order has been cancelled"
  // ----------------------------------------------------------------
  @OnEvent(EVENTS.ORDER_CANCELLED)
  async onOrderCancelled(payload: { order: any }) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: payload.order.id },
        include: {
          customer: { select: { phone: true } },
        },
      });

      if (!order) return;

      const template = Templates.orderCancelled(order.orderNumber);

      await this.whatsappService.sendText({
        to: order.customer.phone,
        message: template.body,
      });

      this.logger.log(`[NOTIFY] order.cancelled → ${order.orderNumber}`);
    } catch (err) {
      this.logger.error(`[NOTIFY] order.cancelled failed: ${err}`);
    }
  }
}
