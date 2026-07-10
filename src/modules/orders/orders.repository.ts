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
      deliveryFee: input.deliveryFee ?? 0,   // ✅ pre-fill from area
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
// Uses Postgres DISTINCT ON semantics via Prisma's `distinct` option:
// distinct: ['customerId'] + orderBy starting with customerId gives
// exactly one row per customer — the latest one, because we order
// by createdAt desc within each customer group.
// ----------------------------------------------------------------
async findInbox(input: ListOrdersInput): Promise<PaginatedOrders> {
  const businessId = this.tenant.get();
  const { page, limit, status, serviceType, search } = input;

  const where: Prisma.OrderWhereInput = {
    businessId,
    ...(status && { status }),
    ...(serviceType && { serviceType }),
    ...(search && { orderNumber: { contains: search, mode: 'insensitive' } }),
  };

  // Step 1: pull the latest order per customer.
  // NOTE: distinct requires customerId to be the FIRST orderBy key for
  // Postgres to correctly pick the "first row" (i.e. most recent) per
  // customer — this is Prisma's equivalent of `DISTINCT ON (customerId)`.
  const latestPerCustomer = await this.prisma.order.findMany({
    where,
    distinct: ['customerId'],
    orderBy: [{ customerId: 'asc' }, { createdAt: 'desc' }],
    include: {
      ...ORDER_INCLUDE,
      customer: { select: { id: true, phone: true, name: true, totalOrders: true } },
    },
  });

  // Step 2: re-sort by createdAt desc (distinct's orderBy above was
  // needed for correctness, not final display order) then paginate
  // in memory — this list is one-row-per-customer, not one-row-per-order,
  // so it can't be paginated at the DB level with a simple skip/take
  // on the orders table itself.
  const sorted = latestPerCustomer.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );

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
  serviceCharge: number,   // ✅
  vatAmount: number,       // ✅
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

  async findAll(input: ListOrdersInput): Promise<PaginatedOrders> {
    const businessId = this.tenant.get();
    const { page, limit, status, serviceType, customerId, search } = input;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      businessId,
      ...(status && { status }),
      ...(serviceType && { serviceType }),
      ...(customerId && { customerId }),
      ...(search && { orderNumber: { contains: search, mode: 'insensitive' } }),
    };

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

  // Order number is per-business: EB-0001, EB-0002 etc
  private async generateOrderNumber(businessId: string): Promise<string> {
    const count = await this.prisma.order.count({ where: { businessId } });
    return `EB-${String(count + 1).padStart(4, '0')}`;
  }

 private mapOrder(order: any): OrderWithItems {
  return {
    ...order,
    deliveryFee:    Number(order.deliveryFee),
    subtotal:       Number(order.subtotal),
    serviceCharge:  Number(order.serviceCharge),
    vatAmount:      Number(order.vatAmount),
    total:          Number(order.total),
    items: order.items.map((item: any) => ({
      ...item,
      unitPrice:        item.unitPrice        ? Number(item.unitPrice)        : null,
      aiSuggestedPrice: item.aiSuggestedPrice ? Number(item.aiSuggestedPrice) : null,
    })),
  };
}
}
