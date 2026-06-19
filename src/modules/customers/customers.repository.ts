import { Injectable } from '@nestjs/common';

import { Customer } from '@prisma/client';
import {
  CustomerWithStats,
  FindOrCreateResult,
  PaginatedCustomers,
} from '@modules/customers/customers.types';
import {
  ListCustomersInput,
  UpdateCustomerInput,
} from '@modules/customers/schemas/customers.schema';

import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';

@Injectable()
export class CustomersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async findOrCreate(phone: string): Promise<FindOrCreateResult> {
    const businessId = this.tenant.get();

    const existing = await this.prisma.customer.findUnique({
      where: { businessId_phone: { businessId, phone } },
    });

    if (existing) return { customer: existing, isNew: false };

    const created = await this.prisma.customer.create({
      data: { phone, businessId },
    });

    return { customer: created, isNew: true };
  }

  async findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({
      where: { id, businessId: this.tenant.get() },
    });
  }

  async findByPhone(phone: string): Promise<Customer | null> {
    const businessId = this.tenant.get();
    return this.prisma.customer.findUnique({
      where: { businessId_phone: { businessId, phone } },
    });
  }

  async findWithStats(id: string): Promise<CustomerWithStats | null> {
    return this.prisma.customer.findFirst({
      where: { id, businessId: this.tenant.get() },
      include: {
        _count: { select: { orders: true } },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            total: true,
            createdAt: true,
          },
        },
      },
    }) as any;
  }

  async update(id: string, data: UpdateCustomerInput): Promise<Customer> {
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  async setBlocked(id: string, isBlocked: boolean): Promise<void> {
    await this.prisma.customer.update({
      where: { id },
      data: { isBlocked },
    });
  }

  async incrementStats(customerId: string, orderTotal: number): Promise<void> {
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        totalOrders: { increment: 1 },
        totalSpend: { increment: orderTotal },
      },
    });
  }

  async findAll(input: ListCustomersInput): Promise<PaginatedCustomers> {
    const businessId = this.tenant.get();
    const { page, limit } = input;
    const skip = (page - 1) * limit;

    const [raw, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where: { businessId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where: { businessId } }),
    ]);

    const data = raw.map((c) => ({
      ...c,
      totalSpend: c.totalSpend.toNumber(),
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
