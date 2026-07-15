import { Injectable } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { Payment, PaymentStatus } from '@prisma/client';
import { ListPaymentsInput } from './schemas/payments.schema';
import { PaginatedPayments, CreatePaymentInput, PaymentView } from './payments.types';

@Injectable()
export class PaymentsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async create(data: CreatePaymentInput): Promise<Payment> {
    return this.prisma.payment.create({
      data: { ...data, businessId: this.tenant.get() },   // ✅
    });
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { orderId, businessId: this.tenant.get() },
    });
  }

  async findByPaystackRef(paystackRef: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { paystackRef } });
  }

  async confirm(id: string, adminId?: string, proofUrl?: string): Promise<Payment> {
    return this.prisma.payment.update({
      where: { id },
      data: {
        status:      PaymentStatus.CONFIRMED,
        confirmedBy: adminId,
        confirmedAt: new Date(),
        ...(proofUrl && { proofUrl }),
      },
    });
  }

  async reject(id: string, adminId: string, reason?: string): Promise<Payment> {
    return this.prisma.payment.update({
      where: { id },
      data: {
        status:          PaymentStatus.REJECTED,
        rejectedBy:      adminId,
        rejectedAt:      new Date(),
        rejectionReason: reason ?? null,
      },
    });
  }
  async findAllForExport(filters: {
  status?: string;
  method?: string;
  startDate?: string;
  endDate?: string;
}) {
  const businessId = this.tenant.get();
  const where: any = { businessId };

  if (filters.status) where.status = filters.status;
  if (filters.method) where.method = filters.method;
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
    if (filters.endDate) where.createdAt.lte = new Date(filters.endDate);
  }

  return this.prisma.payment.findMany({
    where,
    include: {
      customer: { select: { name: true, phone: true } },
      order: { select: { orderNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

 async findAll(input: ListPaymentsInput): Promise<PaginatedPayments> {
  const businessId = this.tenant.get();
  const { page, limit, status, method, startDate, endDate } = input;
  const skip = (page - 1) * limit;

  const where: any = { businessId };
  if (status) where.status = status;
  if (method) where.method = method;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [raw, total] = await this.prisma.$transaction([
    this.prisma.payment.findMany({
      where,
      include: {
        customer: { select: { name: true, phone: true } },
        order: { select: { orderNumber: true } },
      },
      skip, take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    this.prisma.payment.count({ where }),
  ]);

  const data: PaymentView[] = raw.map(p => ({
    id:            p.id,
    orderId:       p.orderId,
    orderNumber:   p.order.orderNumber,
    customerName:  p.customer.name,
    customerPhone: p.customer.phone,
    method:        p.method,
    status:        p.status,
    amount:        p.amount.toNumber(),
    paystackRef:   p.paystackRef,
    paystackLink:  p.paystackLink,
    proofUrl:      p.proofUrl,
    confirmedAt:   p.confirmedAt,
    createdAt:     p.createdAt,
  }));

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}
}