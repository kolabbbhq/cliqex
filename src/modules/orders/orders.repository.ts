import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { Order, OrderItem, OrderStatus, Prisma } from '@prisma/client';
import { CreateOrderInput, PaginatedOrders, OrderWithItems } from './orders.types';
import { ListOrdersInput } from './schemas/orders.schema';

const ORDER_INCLUDE = {
  customer: { select: { id: true, phone: true, name: true } },
  items: { orderBy: { sort: 'asc' as const } },
};

@Injectable()
export class OrdersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async create(input: CreateOrderInput): Promise<Order> {
    const businessId = this.tenant.get();
    const orderNumber = await this.generateOrderNumber(businessId);

    return this.prisma.order.create({
      data: {
        orderNumber,
        businessId,
        customerId: input.customerId,
        serviceType: input.serviceType,
        sourceType: input.sourceType,
        rawText: input.rawText,
        rawMediaUrl: input.rawMediaUrl,
        deliveryAddress: input.deliveryAddress,
        deliveryFee: input.deliveryFee ?? 0,
        scheduledAt: input.scheduledAt,
        flowData: (input.flowData as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        items: input.items?.length ? { create: input.items } : undefined,
      },
    });
  }

  async setAutoAck(orderId: string, value: boolean): Promise<void> {
    await this.prisma.order.update({ where: { id: orderId }, data: { autoAckSent: value } });
  }

  async findById(id: string): Promise<OrderWithItems | null> {
    const order = await this.prisma.order.findFirst({
      where: { id, businessId: this.tenant.get() },
      include: ORDER_INCLUDE,
    });
    return order ? this.mapOrder(order) : null;
  }

  async findByOrderNumber(orderNumber: string): Promise<OrderWithItems | null> {
    const businessId = this.tenant.get();
    const order = await this.prisma.order.findUnique({
      where: { businessId_orderNumber: { businessId, orderNumber } },
      include: ORDER_INCLUDE,
    });
    return order ? this.mapOrder(order) : null;
  }

  async findLatestActiveByCustomer(customerId: string): Promise<Order | null> {
    return this.prisma.order.findFirst({
      where: {
        customerId,
        businessId: this.tenant.get(),
        status: { notIn: ['DELIVERED', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ----------------------------------------------------------------
  // findInbox — ONE ROW PER CUSTOMER, showing their most recent order.
  // distinct: ['customerId'] with customerId as the first orderBy key
  // gives Postgres DISTINCT ON semantics — the latest row per customer.
  // ----------------------------------------------------------------
  async findInbox(input: ListOrdersInput): Promise<PaginatedOrders> {
    const where = this.buildWhere(input);

    const latestPerCustomer = await this.prisma.order.findMany({
      where,
      distinct: ['customerId'],
      orderBy: [{ customerId: 'asc' }, { createdAt: 'desc' }],
      include: {
        ...ORDER_INCLUDE,
        customer: { select: { id: true, phone: true, name: true, totalOrders: true } },
      },
    });

    // distinct's orderBy above was needed for correctness, not display
    // order — re-sort by createdAt desc, then paginate in memory since
    // this is one-row-per-customer, not one-row-per-order.
    const sorted = latestPerCustomer.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    const { page, limit } = input;
    const total = sorted.length;
    const skip = (page - 1) * limit;
    const paged = sorted.slice(skip, skip + limit);

    return {
      data: paged.map(this.mapOrder),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findAll(input: ListOrdersInput): Promise<PaginatedOrders> {
    const { page, limit } = input;
    const skip = (page - 1) * limit;
    const where = this.buildWhere(input);

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map(this.mapOrder),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async exportCsv(input: ListOrdersInput): Promise<string> {
    const where = this.buildWhere(input);

    const orders = await this.prisma.order.findMany({
      where,
      include: { customer: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const esc = (val: unknown): string => {
      const str = String(val ?? '');
      return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = orders.map((o) =>
      [
        o.orderNumber,
        o.customer?.name ?? '',
        o.customer?.phone ?? '',
        o.serviceType,
        o.status,
        o.subtotal.toString(),
        o.deliveryFee.toString(),
        o.serviceCharge.toString(),
        o.vatAmount.toString(),
        o.total.toString(),
        o.createdAt.toISOString(),
      ].map(esc).join(','),
    );

    return [
      'Order Number,Customer Name,Customer Phone,Service Type,Status,Subtotal,Delivery Fee,Service Charge,VAT,Total,Created At',
      ...rows,
    ].join('\n');
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    extra?: Partial<Prisma.OrderUpdateInput>,
  ): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: { status, ...extra },
    });
  }

  async updatePricing(
    orderId: string,
    subtotal: number,
    deliveryFee: number,
    serviceCharge: number,
    vatAmount: number,
  ): Promise<Order> {
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        subtotal,
        deliveryFee,
        serviceCharge,
        vatAmount,
        total: subtotal + deliveryFee + serviceCharge + vatAmount,
      },
    });
  }

  async updateItemPrice(itemId: string, unitPrice: number): Promise<OrderItem> {
    return this.prisma.orderItem.update({
      where: { id: itemId },
      data: { unitPrice },
    });
  }

  async addItems(orderId: string, items: CreateOrderInput['items']): Promise<void> {
    if (!items?.length) return;
    await this.prisma.orderItem.createMany({
      data: items.map((item) => ({ ...item, orderId })),
    });
    await this.prisma.order.update({
      where: { id: orderId },
      data: { aiExtracted: true },
    });
  }

  async updateNotes(id: string, notes: string): Promise<Order> {
    return this.prisma.order.update({ where: { id }, data: { notes } });
  }

  async assignBuddy(orderId: string, buddyId: string): Promise<Order> {
    return this.prisma.order.update({ where: { id: orderId }, data: { buddyId } });
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  // Shared filter builder — findAll, findInbox, and exportCsv all
  // filter orders the same way. Single source of truth so a typo
  // here doesn't have to be fixed in three places.
  private buildWhere(input: ListOrdersInput): Prisma.OrderWhereInput {
    const businessId = this.tenant.get();
    const { status, serviceType, customerId, search, startDate, endDate } = input;

    return {
      businessId,
      ...(status && { status }),
      ...(serviceType && { serviceType }),
      ...(customerId && { customerId }),
      ...(search && { orderNumber: { contains: search, mode: 'insensitive' } }),
      ...((startDate || endDate) && {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      }),
    };
  }

  // Order number is per-business: EB-0001, EB-0002 etc
 private async generateOrderNumber(businessId: string): Promise<string> {
  const [count, business] = await Promise.all([
    this.prisma.order.count({ where: { businessId } }),
    this.prisma.business.findUnique({
      where: { id: businessId },
      select: { orderPrefix: true },
    }),
  ]);
  const prefix = business?.orderPrefix ?? 'EB';
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

  private mapOrder(order: any): OrderWithItems {
    return {
      ...order,
      deliveryFee: Number(order.deliveryFee),
      subtotal: Number(order.subtotal),
      serviceCharge: Number(order.serviceCharge),
      vatAmount: Number(order.vatAmount),
      total: Number(order.total),
      items: order.items.map((item: any) => ({
        ...item,
        unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
        aiSuggestedPrice: item.aiSuggestedPrice ? Number(item.aiSuggestedPrice) : null,
      })),
    };
  }
}