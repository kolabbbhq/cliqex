import {
  Logger,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Business, ServiceConfig } from '@prisma/client';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { BusinessRepository, BusinessWithConfig } from '@modules/business/business.repository';

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);
  private phoneIdCache = new Map<string, { business: Business; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly businessRepo: BusinessRepository,
    private readonly tenant: TenantContext,
  ) {}

  async resolveByPhoneId(phoneId: string): Promise<Business | null> {
    const cached = this.phoneIdCache.get(phoneId);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.business;
    }

    const business = await this.businessRepo.findByPhoneId(phoneId);

    if (business) {
      this.phoneIdCache.set(phoneId, { business, cachedAt: Date.now() });
    }

    return business;
  }

  async getMyBusiness(): Promise<BusinessWithConfig> {
    const businessId = this.tenant.get();
    const business = await this.businessRepo.findById(businessId);

    if (!business) throw new NotFoundException('Business not found');

    return business;
  }

  async getById(id: string): Promise<BusinessWithConfig> {
    const business = await this.businessRepo.findById(id);
    if (!business) throw new NotFoundException(`Business ${id} not found`);
    return business;
  }

  async getAllBusinesses(): Promise<Business[]> {
    if (!this.tenant.getIsSuperAdmin()) {
      throw new ForbiddenException('Only super admins can list all businesses');
    }
    return this.businessRepo.findAll();
  }

  async updateMyBusiness(data: {
    name?: string;
    tagline?: string;
    logoUrl?: string;
    primaryColor?: string;
    bankName?: string;
    bankAccountNumber?: string;
    bankAccountName?: string;
  }): Promise<Business> {
    const businessId = this.tenant.get();
    const updated = await this.businessRepo.update(businessId, data as any);

    // Invalidate cache for this business's phone
    if (updated.whatsappPhoneId) {
      this.phoneIdCache.delete(updated.whatsappPhoneId);
    }

    return updated;
  }
async connectWhatsApp(data: {
  whatsappPhoneId: string;
  whatsappToken: string;
  whatsappVerifyToken: string;
  wabaId?: string;
}): Promise<Business> {
  const businessId = this.tenant.get();

  const existing = await this.businessRepo.findByPhoneId(data.whatsappPhoneId);
  if (existing && existing.id !== businessId) {
    throw new ConflictException('This WhatsApp number is already connected to another business');
  }

  const updated = await this.businessRepo.update(businessId, data as any);

  this.phoneIdCache.set(data.whatsappPhoneId, {
    business: updated,
    cachedAt: Date.now(),
  });

  this.logger.log(`WhatsApp connected for business ${businessId}: ${data.whatsappPhoneId}`);
  return updated;
}

  async updateServiceConfig(data: {
    services?: any[];
    areas?: any[];
    welcomeText?: string;
    headerImageUrl?: string;
    serviceChargePercent?: number;
    vatPercent?: number;
  }): Promise<ServiceConfig> {
    const businessId = this.tenant.get();
    return this.businessRepo.upsertServiceConfig(businessId, data);
  }

  async getServiceConfig(businessId: string): Promise<ServiceConfig | null> {
    return this.businessRepo.getServiceConfig(businessId);
  }

  async createBusiness(data: {
    name: string;
    slug: string;
    plan?: string;
    logoUrl?: string;
    tagline?: string;
    primaryColor?: string;
  }): Promise<Business> {
    const existing = await this.businessRepo.findBySlug(data.slug);
    if (existing) {
      throw new ConflictException(`Slug "${data.slug}" is already taken`);
    }

    const business = await this.businessRepo.create(data);
    this.logger.log(`New business created: ${business.name} (${business.id})`);
    return business;
  }
}
