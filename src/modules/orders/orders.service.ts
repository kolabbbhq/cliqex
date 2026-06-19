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

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ----------------------------------------------------------------
  // Create order — called by WhatsappModule on new list message
  // ----------------------------------------------------------------
  async create(input: CreateOrderInput): Promise<Order> {
    const order = await this.ordersRepository.create(input);

    this.eventEmitter.emit(EVENTS.ORDER_CREATED, { order });
    this.logger.log(`Order created: ${order.orderNumber} (${order.serviceType})`);

    return order;
  }

  // ----------------------------------------------------------------
  // Get single order — CRM order detail view
  // ----------------------------------------------------------------
  async findOne(id: string): Promise<OrderWithItems> {
    const order = await this.ordersRepository.findById(id);

    if (!order) throw new NotFoundException(`Order ${id} not found`);

    return order;
  }

  // ----------------------------------------------------------------
  // Get paginated orders — CRM orders inbox
  // ----------------------------------------------------------------
  async findAll(input: ListOrdersInput): Promise<PaginatedOrders> {
    return this.ordersRepository.findAll(input);
  }

  // ----------------------------------------------------------------
  // Admin prices all items + sets delivery fee → sends quote
  // This is the main admin action from the CRM quote builder
  // ----------------------------------------------------------------
  async priceItems(orderId: string, input: PriceAllItemsInput): Promise<OrderWithItems> {
    const order = await this.ordersRepository.findById(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    this.assertTransition(order.status, 'QUOTED');

    // Update each item price
    await Promise.all(
      input.items.map((item) => this.ordersRepository.updateItemPrice(item.itemId, item.unitPrice)),
    );

    // Calculate subtotal from all items
    const subtotal = input.items.reduce((sum, item) => sum + item.unitPrice, 0);

    // Update order totals
    await this.ordersRepository.updatePricing(orderId, subtotal, input.deliveryFee);

    // Move to QUOTED status
    await this.ordersRepository.updateStatus(orderId, OrderStatus.QUOTED);

    const updated = await this.ordersRepository.findById(orderId);

    this.eventEmitter.emit(EVENTS.ORDER_QUOTED, { order: updated });
    this.logger.log(`Order quoted: ${order.orderNumber} — total ₦${subtotal + input.deliveryFee}`);

    return updated!;
  }

  // ----------------------------------------------------------------
  // Customer confirmed quote → move to AWAITING_PAYMENT
  // Called by WhatsappModule when customer taps "Confirm order"
  // ----------------------------------------------------------------
  async confirmQuote(orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    this.assertTransition(order.status, 'AWAITING_PAYMENT');

    const updated = await this.ordersRepository.updateStatus(orderId, OrderStatus.AWAITING_PAYMENT);

    this.eventEmitter.emit(EVENTS.ORDER_AWAITING_PAYMENT, { order: updated });

    return updated;
  }

  // ----------------------------------------------------------------
  // Payment confirmed → move to PAID
  // Called by PaymentsModule after Paystack webhook or manual confirm
  // ----------------------------------------------------------------
  async markPaid(orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    this.assertTransition(order.status, 'PAID');

    const updated = await this.ordersRepository.updateStatus(orderId, OrderStatus.PAID);

    this.eventEmitter.emit(EVENTS.ORDER_PAID, { order: updated });
    this.logger.log(`Order paid: ${order.orderNumber}`);

    return updated;
  }
  async addItems(
  orderId: string,
  items: { name: string; nameLower: string; quantity: string }[],
): Promise<void> {
  await this.ordersRepository.addItems(orderId, items);
}

  // ----------------------------------------------------------------
  // Mark processing — admin starts shopping
  // ----------------------------------------------------------------
  async markProcessing(orderId: string): Promise<Order> {
    return this.transition(orderId, OrderStatus.PROCESSING, EVENTS.ORDER_PROCESSING);
  }

  // ----------------------------------------------------------------
  // Assign buddy — admin picks a rider from CRM
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
  // Mark in transit — buddy picked up the order
  // ----------------------------------------------------------------
  async markInTransit(orderId: string): Promise<Order> {
    return this.transition(orderId, OrderStatus.IN_TRANSIT, EVENTS.ORDER_IN_TRANSIT);
  }

  // ----------------------------------------------------------------
  // Mark delivered — admin confirms delivery
  // ----------------------------------------------------------------
  async markDelivered(orderId: string): Promise<Order> {
    const updated = await this.transition(orderId, OrderStatus.DELIVERED, EVENTS.ORDER_DELIVERED);
    this.logger.log(`Order delivered: ${orderId}`);
    return updated;
  }

  // ----------------------------------------------------------------
  // Cancel order — allowed from any non-terminal status
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
  // Update admin notes — internal only, not shown to customer
  // ----------------------------------------------------------------
  async updateNotes(orderId: string, input: UpdateOrderNotesInput): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    return this.ordersRepository.updateNotes(orderId, input.notes);
  }

  // ----------------------------------------------------------------
  // Find latest active order for a customer
  // Called by WhatsappModule to link messages to the right order
  // ----------------------------------------------------------------
  async findLatestActive(customerId: string) {
    return this.ordersRepository.findLatestActiveByCustomer(customerId);
  }
  async setAutoAck(orderId: string, value: boolean): Promise<void> {
  await this.ordersRepository.setAutoAck(orderId, value);
}

  // ----------------------------------------------------------------
  // Private: reusable status transition helper
  // ----------------------------------------------------------------
  private async transition(orderId: string, newStatus: OrderStatus, event: string): Promise<Order> {
    const order = await this.ordersRepository.findById(orderId);

    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    this.assertTransition(order.status, newStatus);

    const updated = await this.ordersRepository.updateStatus(orderId, newStatus);

    this.eventEmitter.emit(event, { order: updated });

    return updated;
  }

  // ----------------------------------------------------------------
  // Private: enforce the state machine — no illegal transitions
  // ----------------------------------------------------------------
  private assertTransition(current: OrderStatus, next: string): void {
    const allowed = ORDER_TRANSITIONS[current] ?? [];

    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Cannot move order from ${current} to ${next}. ` +
          `Allowed transitions: ${allowed.join(', ') || 'none'}`,
      );
    }
  }
}
