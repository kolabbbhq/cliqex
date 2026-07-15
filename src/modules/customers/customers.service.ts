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
import { CustomersRepository } from '@modules/customers/customers.repository';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { TenantContext } from '@common/tenant/tenant-context.service';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async findOrCreate(phone: string): Promise<FindOrCreateResult> {
    const result = await this.customersRepository.findOrCreate(phone);
    if (result.isNew) {
      this.logger.log(`New customer created: ${phone}`);
    }
    return result;
  }

  async findAll(input: ListCustomersInput): Promise<PaginatedCustomers> {
    return this.customersRepository.findAll(input);
  }

  async findOne(id: string): Promise<CustomerWithStats> {
    const customer = await this.customersRepository.findWithStats(id);
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }
  async exportCsv(query: {
  isVip?: string | boolean;
  isBlocked?: string | boolean;
  startDate?: string;
  endDate?: string;
  search?: string;
}): Promise<string> {
  const businessId = this.tenant.get();
  const where: any = { businessId };

  if (query.isBlocked !== undefined) {
    where.isBlocked = query.isBlocked === true || query.isBlocked === 'true';
  }
  if (query.isVip === true || query.isVip === 'true') {
    where.totalOrders = { gte: 5 };
  }
  if (query.startDate || query.endDate) {
    where.createdAt = {};
    if (query.startDate) where.createdAt.gte = new Date(query.startDate);
    if (query.endDate) where.createdAt.lte = new Date(query.endDate);
  }
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const customers = await this.prisma.customer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  const esc = (val: unknown): string => {
    const str = String(val ?? '');
    return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const rows = customers.map((c) =>
    [
      c.name ?? '',
      c.phone,
      c.totalOrders,
      c.totalSpend.toString(),
      c.totalOrders >= 5,
      c.isBlocked,
      c.createdAt.toISOString(),
    ]
      .map(esc)
      .join(','),
  );

  return [
    'Name,Phone,Total Orders,Total Spend,VIP,Blocked,Joined Date',
    ...rows,
  ].join('\n');
}

  async update(id: string, data: UpdateCustomerInput): Promise<Customer> {
    const exists = await this.customersRepository.findById(id);
    if (!exists) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return this.customersRepository.update(id, data);
  }

  async block(id: string): Promise<void> {
    const customer = await this.customersRepository.findById(id);
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    if (customer.isBlocked) throw new BadRequestException('Customer is already blocked');
    await this.customersRepository.setBlocked(id, true);
    this.logger.log(`Customer blocked: ${customer.phone}`);
  }

  async unblock(id: string): Promise<void> {
    const customer = await this.customersRepository.findById(id);
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);
    if (!customer.isBlocked) throw new BadRequestException('Customer is not blocked');
    await this.customersRepository.setBlocked(id, false);
    this.logger.log(`Customer unblocked: ${customer.phone}`);
  }

  async incrementStats(customerId: string, orderTotal: number): Promise<void> {
    await this.customersRepository.incrementStats(customerId, orderTotal);
  }

  // ----------------------------------------------------------------
  // getThread
  // Returns all messages for a customer ordered chronologically.
  // Works for customers with no orders — queries by customerId only,
  // not by orderId. This is what the CRM uses when admin opens a
  // customer who has never placed an order.
  // ----------------------------------------------------------------
  async getThread(customerId: string): Promise<any[]> {
    const businessId = this.tenant.get();

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId },
    });

    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    return this.prisma.message.findMany({
      where: { customerId, businessId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        direction: true,
        type: true,
        content: true,
        mediaUrl: true,
        buttonPayload: true,
        status: true,
        createdAt: true,
        orderId: true,
      },
    });
  }

  // ----------------------------------------------------------------
  // sendMessage
  // Admin sends a direct WhatsApp message to a customer from the CRM.
  // Works for customers with no orders — does not require an orderId.
  // Saves the outbound message to the Message table so it appears
  // in the thread view immediately.
  // ----------------------------------------------------------------
  async sendMessage(customerId: string, message: string): Promise<void> {
    const businessId = this.tenant.get();

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId },
      include: {
        business: {
          select: {
            whatsappToken: true,
            whatsappPhoneId: true,
          },
        },
      },
    });

    if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

    if (!customer.business.whatsappToken || !customer.business.whatsappPhoneId) {
      throw new BadRequestException('WhatsApp is not connected for this business');
    }

    // Send via Meta API
    const url = `https://graph.facebook.com/v19.0/${customer.business.whatsappPhoneId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${customer.business.whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: customer.phone,
        type: 'text',
        text: { body: message },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      this.logger.error(`Failed to send message to ${customer.phone}: ${JSON.stringify(error)}`);
      throw new BadRequestException('Failed to send WhatsApp message — check your credentials');
    }

    const result = await response.json() as any;
    const waMessageId = result?.messages?.[0]?.id ?? `manual-${Date.now()}`;

    // Save to message thread so it appears in the CRM immediately
    await this.prisma.message.create({
      data: {
        waMessageId,
        businessId,
        customerId,
        direction: 'OUTBOUND',
        type: 'TEXT',
        content: message,
        status: 'SENT',
      },
    });

    this.logger.log(`Admin sent direct message to ${customer.phone}`);
  }
}