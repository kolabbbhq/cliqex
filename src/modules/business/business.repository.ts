import { Injectable } from '@nestjs/common';
import { Business, ServiceConfig } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';

export interface BusinessWithConfig extends Business {
  serviceConfig: ServiceConfig | null;
}

@Injectable()
export class BusinessRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<BusinessWithConfig | null> {
    return this.prisma.business.findUnique({
      where: { id },
      include: { serviceConfig: true },
    });
  }

  async findBySlug(slug: string): Promise<BusinessWithConfig | null> {
    return this.prisma.business.findUnique({
      where: { slug },
      include: { serviceConfig: true },
    });
  }

  async findByPhoneId(whatsappPhoneId: string): Promise<Business | null> {
    return this.prisma.business.findFirst({
      where: { whatsappPhoneId, isActive: true },
    });
  }


  async findAll(): Promise<Business[]> {
    return this.prisma.business.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    name: string;
    slug: string;
    plan?: string;
    logoUrl?: string;
    tagline?: string;
    primaryColor?: string;
  }): Promise<Business> {
    return this.prisma.business.create({ data: data as any });
  }


  async update(id: string, data: Partial<Business>): Promise<Business> {
    return this.prisma.business.update({ where: { id }, data: data as any });
  }

async upsertServiceConfig(
  businessId: string,
  data: {
    services?: any[];
    areas?: any[];
    welcomeText?: string;
    headerImageUrl?: string;
    serviceChargePercent?: number;
    vatPercent?: number;
  },
): Promise<ServiceConfig> {
  const existing = await this.prisma.serviceConfig.findUnique({ where: { businessId } });

  let mergedServices = data.services;
  if (data.services && existing?.services) {
    const existingArr = existing.services as any[];
    mergedServices = data.services.map((incoming) => {
      const prior = existingArr.find((e) => e.id === incoming.id);
      return { ...prior, ...incoming };
    });
  }

  const finalData = {
    ...data,
    ...(mergedServices && { services: mergedServices }),
  };

  return this.prisma.serviceConfig.upsert({
    where: { businessId },
    create: { businessId, ...finalData },
    update: { ...finalData },
  });
}


  async getServiceConfig(businessId: string): Promise<ServiceConfig | null> {
    return this.prisma.serviceConfig.findUnique({ where: { businessId } });
  }
}
