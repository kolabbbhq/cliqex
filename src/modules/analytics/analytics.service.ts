import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async getDashboard() {
    const businessId = this.tenant.get();

    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const CONFIRMED_STATUSES = ['PAID', 'PROCESSING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'];

    const [
      totalOrders,
      ordersThisWeek,
      ordersToday,
      ordersByStatus,
      needsAttentionRaw,
      confirmedRevenueThisMonth,
      confirmedRevenueAllTime,
      pendingRevenue,
      deliveredCount,
      totalCustomers,
      newCustomersToday,
      newCustomersThisWeek,
      topCustomers,
      buddyStats,
      topRatedBuddies,
      reviewStats,
      recentOrdersRaw,
    ] = await Promise.all([
      // ── Orders ──────────────────────────────────────────────────
      this.prisma.order.count({ where: { businessId } }),

      this.prisma.order.count({
        where: { businessId, createdAt: { gte: startOfWeek } },
      }),

      this.prisma.order.count({
        where: { businessId, createdAt: { gte: startOfToday } },
      }),

      this.prisma.order.groupBy({
        by: ['status'],
        where: { businessId },
        _count: { status: true },
      }),

      this.prisma.order.findMany({
        where: { businessId, status: 'NEW' },
        include: {
          customer: { select: { name: true } },
          items: { select: { id: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),

      // ── Revenue ──────────────────────────────────────────────────
      this.prisma.order.aggregate({
        where: {
          businessId,
          status: { in: CONFIRMED_STATUSES as any },
          createdAt: { gte: startOfMonth },
        },
        _sum: { total: true },
      }),

      this.prisma.order.aggregate({
        where: {
          businessId,
          status: { in: CONFIRMED_STATUSES as any },
        },
        _sum: { total: true },
      }),

      this.prisma.order.aggregate({
        where: { businessId, status: 'AWAITING_PAYMENT' },
        _sum: { total: true },
      }),

      this.prisma.order.count({
        where: { businessId, status: 'DELIVERED' },
      }),

      // ── Customers ────────────────────────────────────────────────
      this.prisma.customer.count({ where: { businessId } }),

      this.prisma.customer.count({
        where: { businessId, createdAt: { gte: startOfToday } },
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

      // ── Buddies ──────────────────────────────────────────────────
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

      // ── Reviews ──────────────────────────────────────────────────
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { businessId },
        _count: { rating: true },
      }),

      // ── Recent orders ─────────────────────────────────────────────
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

    // ── Shape: orders.byStatus ─────────────────────────────────────
    const allStatuses = [
      'NEW', 'QUOTED', 'AWAITING_PAYMENT', 'PAID',
      'PROCESSING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED',
    ];
    const byStatus = Object.fromEntries(
      allStatuses.map((s) => [
        s,
        ordersByStatus.find((r) => r.status === s)?._count.status ?? 0,
      ]),
    ) as Record<string, number>;

    // ── Shape: orders.needsAttention ──────────────────────────────
    const needsAttention = needsAttentionRaw.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer.name,
      itemCount: o.items.length,
      waitingMinutes: Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000),
      createdAt: o.createdAt,
    }));

    // ── Shape: revenue ────────────────────────────────────────────
    const confirmedAllTime = Number(confirmedRevenueAllTime._sum.total ?? 0);
    const revenue = {
      confirmedThisMonth: Number(confirmedRevenueThisMonth._sum.total ?? 0),
      confirmedAllTime,
      pendingCollection: Number(pendingRevenue._sum.total ?? 0),
      averageOrderValue: deliveredCount > 0 ? confirmedAllTime / deliveredCount : 0,
    };

    // ── Shape: customers ──────────────────────────────────────────
    const customers = {
      total: totalCustomers,
      newToday: newCustomersToday,
      newThisWeek: newCustomersThisWeek,
      topCustomers: topCustomers.map((c) => ({
        ...c,
        totalSpend: Number(c.totalSpend),
      })),
    };

    // ── Shape: buddies ────────────────────────────────────────────
    const buddyStatusMap = Object.fromEntries(
      buddyStats.map((r) => [r.status, r._count.status]),
    );
    const buddies = {
      total: (buddyStatusMap['AVAILABLE'] ?? 0) + (buddyStatusMap['BUSY'] ?? 0) + (buddyStatusMap['OFFLINE'] ?? 0),
      available: buddyStatusMap['AVAILABLE'] ?? 0,
      busy: buddyStatusMap['BUSY'] ?? 0,
      offline: buddyStatusMap['OFFLINE'] ?? 0,
      topRated: topRatedBuddies,
    };

    // ── Shape: reviews ────────────────────────────────────────────
    const totalReviews = reviewStats.reduce((sum, r) => sum + r._count.rating, 0);
    const weightedSum = reviewStats.reduce((sum, r) => sum + r.rating * r._count.rating, 0);
    const reviews = {
      averageRating: totalReviews > 0 ? Math.round((weightedSum / totalReviews) * 10) / 10 : 0,
      totalReviews,
      breakdown: reviewStats
        .map((r) => ({ rating: r.rating, count: r._count.rating }))
        .sort((a, b) => b.rating - a.rating),
    };

    // ── Shape: recentOrders ───────────────────────────────────────
    const TERMINAL = ['DELIVERED', 'CANCELLED'];
    const recentOrders = recentOrdersRaw.map((o) => {
      const lastMessage = o.messages[0]; // already ordered desc, take:1
      const isTerminal = TERMINAL.includes(o.status);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        serviceType: o.serviceType,
        total: Number(o.total),
        createdAt: o.createdAt,
        customer: o.customer,
        buddy: o.buddy,
        itemCount: o.items.length,
        hasUnreadMessage: !isTerminal && lastMessage?.direction === 'INBOUND',
      };
    });

    return {
      orders: { total: totalOrders, thisWeek: ordersThisWeek, today: ordersToday, byStatus, needsAttention },
      revenue,
      customers,
      buddies,
      reviews,
      recentOrders,
    };
  }
}