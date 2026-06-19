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
      data: { ...data, businessId: this.tenant.get() }, // ✅
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
        status: PaymentStatus.CONFIRMED,
        confirmedBy: adminId,
        confirmedAt: new Date(),
        ...(proofUrl && { proofUrl }),
      },
    });
  }

  async findAll(input: ListPaymentsInput): Promise<PaginatedPayments> {
    const businessId = this.tenant.get();
    const { page, limit } = input;
    const skip = (page - 1) * limit;

    const [raw, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where: { businessId },
        include: {
          customer: { select: { name: true, phone: true } },
          order: { select: { orderNumber: true } }, // need orderNumber too
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.payment.count({ where: { businessId } }),
    ]);

    // Fix: flatten nested customer/order into the PaymentView shape
    const data: PaymentView[] = raw.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      orderNumber: p.order.orderNumber,
      customerName: p.customer.name,
      customerPhone: p.customer.phone,
      method: p.method,
      status: p.status,
      amount: p.amount.toNumber(),
      paystackRef: p.paystackRef,
      paystackLink: p.paystackLink,
      proofUrl: p.proofUrl,
      confirmedAt: p.confirmedAt,
      createdAt: p.createdAt,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
