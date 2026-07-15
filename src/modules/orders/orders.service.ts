

import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Order, OrderStatus } from '@prisma/client';

import { OrdersRepository } from './orders.repository';
import { CreateOrderInput, OrderWithItems, PaginatedOrders } from './orders.types';
import {
  ListOrdersInput,
  PriceAllItemsInput,
  CancelOrderInput,
  AssignBuddyInput,
  UpdateOrderNotesInput,
} from './schemas/orders.schema';
import { EVENTS, ORDER_TRANSITIONS } from '@common/events/events.constants';
import { PrismaService } from '@common/prisma/prisma.service';
import { FlowServiceDef } from '@modules/whatsapp/flows/flow-config.types';


@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  // ----------------------------------------------------------------
  // Create order
  // ----------------------------------------------------------------
  async create(input: CreateOrderInput): Promise<Order> {
    const order = await this.ordersRepository.create(input);
    this.eventEmitter.emit(EVENTS.ORDER_CREATED, { order });
    this.logger.log(`Order created: ${order.orderNumber} (${order.serviceType})`);
    return order;
  }

  // ----------------------------------------------------------------
  // Get single order
  // ----------------------------------------------------------------
  async findOne(id: string): Promise<OrderWithItems> {
    const order = await this.ordersRepository.findById(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  // ----------------------------------------------------------------
  // Get paginated orders
  // ----------------------------------------------------------------
  async findAll(input: ListOrdersInput): Promise<PaginatedOrders> {
    return this.ordersRepository.findAll(input);
  }

  async findInbox(input: ListOrdersInput): Promise<PaginatedOrders> {
  return this.ordersRepository.findInbox(input);
}

  // ----------------------------------------------------------------
  // Admin prices all items + sets delivery fee → sends quote
  // ----------------------------------------------------------------
  async priceItems(orderId: string, input: PriceAllItemsInput): Promise<OrderWithItems> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    this.assertTransition(order.status, 'QUOTED');

    await Promise.all(
      input.items.map((item) =>
        this.ordersRepository.updateItemPrice(item.itemId, item.unitPrice),
      ),
    );

    const orderItems = order.items;
    const subtotal = input.items.reduce((sum, priced) => {
      const item = orderItems.find((i) => i.id === priced.itemId);
      const qty = item ? parseInt(item.quantity, 10) || 1 : 1;
      return sum + priced.unitPrice * qty;
    }, 0);

    const serviceConfig = await this.prisma.serviceConfig.findUnique({
  where: { businessId: order.businessId },
  select: { services: true, serviceChargePercent: true, vatPercent: true },
});

const services = (serviceConfig?.services as unknown as FlowServiceDef[]) ?? [];
const serviceDef = services.find((s) => s.id === order.serviceType);
const rules = serviceDef?.chargeRules ?? {
  applyDeliveryFee: true,
  applyServiceCharge: true,
  applyVat: true,
};

const deliveryFee = rules.applyDeliveryFee !== false ? input.deliveryFee : 0;
const serviceChargePercent =
  rules.applyServiceCharge !== false ? (serviceConfig?.serviceChargePercent ?? 0) : 0;
const vatPercent = rules.applyVat !== false ? (serviceConfig?.vatPercent ?? 0) : 0;

const serviceCharge = (subtotal * serviceChargePercent) / 100;
const vatAmount = ((subtotal + serviceCharge) * vatPercent) / 100;

await this.ordersRepository.updatePricing(
  orderId,
  subtotal,
  deliveryFee,
  serviceCharge,
  vatAmount,
);

    await this.ordersRepository.updateStatus(orderId, OrderStatus.QUOTED);

    const updated = await this.ordersRepository.findById(orderId);

    this.eventEmitter.emit(EVENTS.ORDER_QUOTED, { order: updated });
    this.logger.log(
      `Order quoted: ${order.orderNumber} — subtotal ₦${subtotal} + delivery ₦${deliveryFee} + charge ₦${serviceCharge.toFixed(2)} + VAT ₦${vatAmount.toFixed(2)} = ₦${(subtotal + deliveryFee + serviceCharge + vatAmount).toFixed(2)}`,
    );

    return updated!;
  }

  // ----------------------------------------------------------------
  // Customer confirmed quote → AWAITING_PAYMENT
  // ----------------------------------------------------------------
  async confirmQuote(orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    this.assertTransition(order.status, 'AWAITING_PAYMENT');

    const updated = await this.ordersRepository.updateStatus(
      orderId,
      OrderStatus.AWAITING_PAYMENT,
    );

    this.eventEmitter.emit(EVENTS.ORDER_AWAITING_PAYMENT, { order: updated });
    return updated;
  }

  // ----------------------------------------------------------------
  // Payment confirmed → PAID then immediately PROCESSING
  //
  // PAID is a flash state — the system moves through it automatically.
  // onOrderPaid  → sends PDF receipt
  // onOrderProcessing → sends "Payment confirmed, we're on it!" text
  // Admin's next manual action is assigning a buddy.
  // ----------------------------------------------------------------
  async markPaid(orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    this.assertTransition(order.status, 'PAID');
    const paid = await this.ordersRepository.updateStatus(orderId, OrderStatus.PAID);
    this.eventEmitter.emit(EVENTS.ORDER_PAID, { order: paid });
    this.logger.log(`Order paid: ${order.orderNumber}`);

    // Immediately chain into PROCESSING — no admin click needed
    this.assertTransition(paid.status, 'PROCESSING');
    const processing = await this.ordersRepository.updateStatus(orderId, OrderStatus.PROCESSING);
    this.eventEmitter.emit(EVENTS.ORDER_PROCESSING, { order: processing });
    this.logger.log(`Order auto-processing: ${order.orderNumber}`);

    return processing;
  }

  // ----------------------------------------------------------------
  // Add items to order
  // ----------------------------------------------------------------
  async addItems(
    orderId: string,
    items: { name: string; nameLower: string; quantity: string }[],
  ): Promise<void> {
    await this.ordersRepository.addItems(orderId, items);
  }

  // ----------------------------------------------------------------
  // Mark processing — now only called internally via markPaid
  // Kept public in case it's needed for manual override/admin tooling
  // ----------------------------------------------------------------
  async markProcessing(orderId: string): Promise<Order> {
    return this.transition(orderId, OrderStatus.PROCESSING, EVENTS.ORDER_PROCESSING);
  }

  // ----------------------------------------------------------------
  // Assign buddy
  // ----------------------------------------------------------------
  async assignBuddy(orderId: string, input: AssignBuddyInput): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    this.assertTransition(order.status, 'ASSIGNED');

    await this.ordersRepository.assignBuddy(orderId, input.buddyId);

    const updated = await this.ordersRepository.updateStatus(orderId, OrderStatus.ASSIGNED);

    this.eventEmitter.emit(EVENTS.ORDER_ASSIGNED, { order: updated, buddyId: input.buddyId });
    this.logger.log(`Order ${order.orderNumber} assigned to buddy ${input.buddyId}`);

    return updated;
  }

  // ----------------------------------------------------------------
  // Mark in transit
  // ----------------------------------------------------------------
  async markInTransit(orderId: string): Promise<Order> {
    return this.transition(orderId, OrderStatus.IN_TRANSIT, EVENTS.ORDER_IN_TRANSIT);
  }

  // ----------------------------------------------------------------
  // Mark delivered
  // ----------------------------------------------------------------
  async markDelivered(orderId: string): Promise<Order> {
    const updated = await this.transition(orderId, OrderStatus.DELIVERED, EVENTS.ORDER_DELIVERED);
    this.logger.log(`Order delivered: ${orderId}`);
    return updated;
  }

  // ----------------------------------------------------------------
  // Cancel order
  // ----------------------------------------------------------------
  async cancel(orderId: string, input: CancelOrderInput): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
      throw new BadRequestException(`Order is already ${order.status.toLowerCase()}`);
    }

    const updated = await this.ordersRepository.updateStatus(orderId, OrderStatus.CANCELLED, {
      cancelReason: input.reason,
    });

    this.eventEmitter.emit(EVENTS.ORDER_CANCELLED, { order: updated });
    this.logger.log(`Order cancelled: ${order.orderNumber} — ${input.reason}`);

    return updated;
  }

  // ----------------------------------------------------------------
  // Update admin notes
  // ----------------------------------------------------------------
  async updateNotes(orderId: string, input: UpdateOrderNotesInput): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    return this.ordersRepository.updateNotes(orderId, input.notes);
  }

  // ----------------------------------------------------------------
  // Find latest active order for a customer
  // ----------------------------------------------------------------
  async findLatestActive(customerId: string) {
    return this.ordersRepository.findLatestActiveByCustomer(customerId);
  }

  async setAutoAck(orderId: string, value: boolean): Promise<void> {
    await this.ordersRepository.setAutoAck(orderId, value);
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------
  private async transition(
    orderId: string,
    newStatus: OrderStatus,
    event: string,
  ): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    this.assertTransition(order.status, newStatus);
    const updated = await this.ordersRepository.updateStatus(orderId, newStatus);
    this.eventEmitter.emit(event, { order: updated });
    return updated;
  }

  private assertTransition(current: OrderStatus, next: string): void {
    const allowed = ORDER_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Cannot move order from ${current} to ${next}. ` +
          `Allowed transitions: ${allowed.join(', ') || 'none'}`,
      );
    }
  }
  async exportCsv(query: ListOrdersInput): Promise<string> {
  return this.ordersRepository.exportCsv(query);
}

  // Order number is per-business using the business's orderPrefix: MK-0001, EB-0002 etc
  // private async generateOrderNumber(businessId: string): Promise<string> {
  //   const [count, business] = await Promise.all([
  //     this.prisma.order.count({ where: { businessId } }),
  //     this.prisma.business.findUnique({
  //       where: { id: businessId },
  //       select: { orderPrefix: true },
  //     }),
  //   ]);
  //   const prefix = business?.orderPrefix ?? 'EB';
  //   return `${prefix}-${String(count + 1).padStart(4, '0')}`;
  // }
}
