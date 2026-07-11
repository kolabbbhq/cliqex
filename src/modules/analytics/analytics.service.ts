import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async getDashboardStats() {
    const businessId = this.tenant.get();

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // ── Run all queries in parallel ─────────────────────────────────
    const [
      totalOrders,
      todayOrders,
      weekOrders,
      ordersByStatus,
      needsAttentionOrders,
      revenueResults,
      deliveredCount,
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
      // Total orders
      this.prisma.order.count({ where: { businessId } }),

      // Today's orders
      this.prisma.order.count({
        where: { businessId, createdAt: { gte: startOfDay } },
      }),

      // This week's orders
      this.prisma.order.count({
        where: { businessId, createdAt: { gte: startOfWeek } },
      }),

      // Orders by status
      this.prisma.order.groupBy({
        by: ['status'],
        where: { businessId },
        _count: { status: true },
      }),

      // Needs attention — NEW orders with no quote, oldest first
      this.prisma.order.findMany({
        where: { businessId, status: 'NEW' },
        include: {
          items: { select: { id: true } },
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),

      // Revenue — confirmed this month, all time, pending
      Promise.all([
        this.prisma.order.aggregate({
          where: {
            businessId,
            status: { in: ['PAID', 'PROCESSING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'] },
            createdAt: { gte: startOfMonth },
          },
          _sum: { total: true },
        }),
        this.prisma.order.aggregate({
          where: {
            businessId,
            status: { in: ['PAID', 'PROCESSING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'] },
          },
          _sum: { total: true },
        }),
        this.prisma.order.aggregate({
          where: { businessId, status: 'AWAITING_PAYMENT' },
          _sum: { total: true },
        }),
      ]),

      // Delivered order count for average order value
      this.prisma.order.count({
        where: { businessId, status: 'DELIVERED' },
      }),

      // Total customers
      this.prisma.customer.count({ where: { businessId } }),

      // New customers today
      this.prisma.customer.count({
        where: { businessId, createdAt: { gte: startOfDay } },
      }),

      // New customers this week
      this.prisma.customer.count({
        where: { businessId, createdAt: { gte: startOfWeek } },
      }),

      // Top 5 customers by spend
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

      // Buddy counts by status
      this.prisma.buddy.groupBy({
        by: ['status'],
        where: { businessId, isActive: true },
        _count: { status: true },
      }),

      // Top 3 rated buddies
      this.prisma.buddy.findMany({
        where: { businessId, isActive: true, totalDeliveries: { gte: 1 } },
        orderBy: { rating: 'desc' },
        take: 3,
        select: { id: true, name: true, rating: true, totalDeliveries: true },
      }),

      // Review average and total
      this.prisma.review.aggregate({
        where: { order: { businessId } },
        _avg: { rating: true },
        _count: { rating: true },
      }),

      // Review breakdown by score
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { order: { businessId } },
        _count: { rating: true },
        orderBy: { rating: 'desc' },
      }),

      // Recent 10 orders with full detail
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

    // ── Build byStatus map ──────────────────────────────────────────
    const statusMap: Record<string, number> = {
      NEW: 0,
      QUOTED: 0,
      AWAITING_PAYMENT: 0,
      PAID: 0,
      PROCESSING: 0,
      ASSIGNED: 0,
      IN_TRANSIT: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };
    for (const s of ordersByStatus) {
      statusMap[s.status] = s._count.status;
    }

    // ── Needs attention ─────────────────────────────────────────────
    const needsAttention = needsAttentionOrders.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer.name,
      itemCount: o.items.length,
      waitingMinutes: Math.floor(
        (Date.now() - new Date(o.createdAt).getTime()) / 60000,
      ),
      createdAt: o.createdAt,
    }));

    // ── Revenue — all Number() conversions here ─────────────────────
    const confirmedThisMonth = Number(revenueResults[0]._sum.total ?? 0);
    const confirmedAllTime   = Number(revenueResults[1]._sum.total ?? 0);
    const pendingCollection  = Number(revenueResults[2]._sum.total ?? 0);
    const averageOrderValue  = deliveredCount > 0
      ? confirmedAllTime / deliveredCount
      : 0;

    // ── Buddy stats ─────────────────────────────────────────────────
    const buddyStatusMap: Record<string, number> = {
      AVAILABLE: 0,
      BUSY: 0,
      OFFLINE: 0,
    };
    for (const b of buddyStats) {
      buddyStatusMap[b.status] = b._count.status;
    }

    const totalBuddies = Object.values(buddyStatusMap).reduce((a, b) => a + b, 0);

    // ── Recent orders ───────────────────────────────────────────────
    const terminalStatuses = ['DELIVERED', 'CANCELLED'];
    const recentOrdersMapped = recentOrders.map((o) => {
      const lastMessage = o.messages[0];
      const isTerminal = terminalStatuses.includes(o.status);
      const hasUnreadMessage =
        !isTerminal && lastMessage?.direction === 'INBOUND';

      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        serviceType: o.serviceType,
        total: Number(o.total),           // ← Number() conversion
        createdAt: o.createdAt,
        customer: o.customer,
        buddy: o.buddy ?? null,
        itemCount: o.items.length,
        hasUnreadMessage,
      };
    });

    // ── Top customers ───────────────────────────────────────────────
    const topCustomersMapped = topCustomers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      totalOrders: c.totalOrders,
      totalSpend: Number(c.totalSpend),   // ← Number() conversion
    }));

    // ── Reviews ─────────────────────────────────────────────────────
    const reviewBreakdownMapped = reviewBreakdown.map((r) => ({
      rating: r.rating,
      count: r._count.rating,
    }));

    // ── Return ──────────────────────────────────────────────────────
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
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      },
      customers: {
        total: totalCustomers,
        newToday: newTodayCustomers,
        newThisWeek: newWeekCustomers,
        topCustomers: topCustomersMapped,
      },
      buddies: {
        total: totalBuddies,
        available: buddyStatusMap['AVAILABLE'],
        busy: buddyStatusMap['BUSY'],
        offline: buddyStatusMap['OFFLINE'],
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
}