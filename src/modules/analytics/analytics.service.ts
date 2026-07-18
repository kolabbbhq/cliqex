import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, BuddyStatus } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';

const CONFIRMED_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.ASSIGNED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.DELIVERED,
];

const TERMINAL_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async getDashboardStats() {
    const businessId = this.tenant.get();
    const { startOfDay, startOfWeek, startOfMonth } = this.getDateBoundaries();

    const [
      totalOrders,
      todayOrders,
      weekOrders,
      ordersByStatus,
      needsAttentionOrders,
      revenueResults,
      deliveredStats,
      totalCustomers,
      newTodayCustomers,
      newWeekCustomers,
      topCustomers,
      buddyStats,
      topBuddies,
      reviewSummary,
      reviewBreakdown,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count({ where: { businessId } }),

      this.prisma.order.count({
        where: { businessId, createdAt: { gte: startOfDay } },
      }),

      this.prisma.order.count({
        where: { businessId, createdAt: { gte: startOfWeek } },
      }),

      this.prisma.order.groupBy({
        by: ['status'],
        where: { businessId },
        _count: { status: true },
      }),

      this.prisma.order.findMany({
        where: { businessId, status: OrderStatus.NEW },
        include: {
          items: { select: { id: true } },
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),

      Promise.all([
        this.prisma.order.aggregate({
          where: {
            businessId,
            status: { in: CONFIRMED_STATUSES },
            createdAt: { gte: startOfMonth },
          },
          _sum: { total: true },
        }),
        this.prisma.order.aggregate({
          where: { businessId, status: { in: CONFIRMED_STATUSES } },
          _sum: { total: true },
        }),
        this.prisma.order.aggregate({
          where: { businessId, status: OrderStatus.AWAITING_PAYMENT },
          _sum: { total: true },
        }),
      ]),

      this.prisma.order.aggregate({
        where: { businessId, status: OrderStatus.DELIVERED },
        _sum: { total: true },
        _count: { id: true },
      }),

      this.prisma.customer.count({ where: { businessId } }),

      this.prisma.customer.count({
        where: { businessId, createdAt: { gte: startOfDay } },
      }),

      this.prisma.customer.count({
        where: { businessId, createdAt: { gte: startOfWeek } },
      }),

      this.prisma.customer.findMany({
        where: { businessId },
        orderBy: { totalSpend: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          phone: true,
          totalOrders: true,
          totalSpend: true,
        },
      }),

      this.prisma.buddy.groupBy({
        by: ['status'],
        where: { businessId, isActive: true },
        _count: { status: true },
      }),

      this.prisma.buddy.findMany({
        where: { businessId, isActive: true, totalDeliveries: { gte: 1 } },
        orderBy: { rating: 'desc' },
        take: 3,
        select: { id: true, name: true, rating: true, totalDeliveries: true },
      }),

      this.prisma.review.aggregate({
        where: { order: { businessId } },
        _avg: { rating: true },
        _count: { rating: true },
      }),

      this.prisma.review.groupBy({
        by: ['rating'],
        where: { order: { businessId } },
        _count: { rating: true },
        orderBy: { rating: 'desc' },
      }),

      this.prisma.order.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          customer: { select: { name: true, phone: true } },
          buddy: { select: { name: true, phone: true } },
          items: { select: { id: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { direction: true },
          },
        },
      }),
    ]);

    const statusMap = this.buildEnumCountMap(OrderStatus, ordersByStatus);
    const buddyStatusMap = this.buildEnumCountMap(BuddyStatus, buddyStats);
    const totalBuddies = Object.values(buddyStatusMap).reduce(
      (sum, count) => sum + count,
      0,
    );

    const needsAttention = needsAttentionOrders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer.name,
      itemCount: o.items.length,
      waitingMinutes: Math.floor((Date.now() - o.createdAt.getTime()) / 60000),
      createdAt: o.createdAt,
    }));

    const confirmedThisMonth = Number(revenueResults[0]._sum.total ?? 0);
    const confirmedAllTime = Number(revenueResults[1]._sum.total ?? 0);
    const pendingCollection = Number(revenueResults[2]._sum.total ?? 0);

    const deliveredRevenue = Number(deliveredStats._sum.total ?? 0);
    const deliveredCount = deliveredStats._count.id;
    const averageOrderValue =
      deliveredCount > 0 ? deliveredRevenue / deliveredCount : 0;

    const recentOrdersMapped = recentOrders.map((o) => {
      const isTerminal = TERMINAL_STATUSES.includes(o.status);
      const hasUnreadMessage =
        !isTerminal && o.messages[0]?.direction === 'INBOUND';

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        serviceType: o.serviceType,
        total: Number(o.total),
        createdAt: o.createdAt,
        customer: o.customer,
        buddy: o.buddy ?? null,
        itemCount: o.items.length,
        hasUnreadMessage,
      };
    });

    const topCustomersMapped = topCustomers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      totalOrders: c.totalOrders,
      totalSpend: Number(c.totalSpend),
    }));

    const reviewBreakdownMapped = reviewBreakdown.map((r) => ({
      rating: r.rating,
      count: r._count.rating,
    }));

    return {
      orders: {
        total: totalOrders,
        today: todayOrders,
        thisWeek: weekOrders,
        byStatus: statusMap,
        needsAttention,
      },
      revenue: {
        confirmedThisMonth,
        confirmedAllTime,
        pendingCollection,
        averageOrderValue: this.roundMoney(averageOrderValue),
      },
      customers: {
        total: totalCustomers,
        newToday: newTodayCustomers,
        newThisWeek: newWeekCustomers,
        topCustomers: topCustomersMapped,
      },
      buddies: {
        total: totalBuddies,
        available: buddyStatusMap[BuddyStatus.AVAILABLE],
        busy: buddyStatusMap[BuddyStatus.BUSY],
        offline: buddyStatusMap[BuddyStatus.OFFLINE],
        topRated: topBuddies,
      },
      reviews: {
        averageRating: Math.round((reviewSummary._avg.rating ?? 0) * 10) / 10,
        totalReviews: reviewSummary._count.rating,
        breakdown: reviewBreakdownMapped,
      },
      recentOrders: recentOrdersMapped,
    };
  }

  async getNotificationCounts() {
    const businessId = this.tenant.get();

    const [newOrders, pendingPayments, activeOrders] = await Promise.all([
      this.prisma.order.count({
        where: { businessId, status: OrderStatus.NEW },
      }),
      this.prisma.payment.count({
        where: { businessId, status: 'PENDING' },
      }),
      this.prisma.order.findMany({
        where: {
          businessId,
          status: { notIn: TERMINAL_STATUSES },
        },
        select: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { direction: true },
          },
        },
      }),
    ]);

    const unreadMessages = activeOrders.filter(
      (o) => o.messages[0]?.direction === 'INBOUND',
    ).length;

    return {
      newOrders,
      pendingPayments,
      unreadMessages,
      total: newOrders + pendingPayments + unreadMessages,
    };
  }

  private getDateBoundaries() {
    const now = new Date();

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    return { startOfDay, startOfWeek, startOfMonth };
  }

  private buildEnumCountMap<T extends string>(
    enumObject: Record<string, T>,
    grouped: Array<{ status: T; _count: { status: number } }>,
  ): Record<T, number> {
    const map = Object.fromEntries(
      Object.values(enumObject).map((value) => [value, 0]),
    ) as Record<T, number>;

    for (const row of grouped) {
      map[row.status] = row._count.status;
    }

    return map;
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }
}