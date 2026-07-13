import {
  Logger,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException
} from '@nestjs/common';
import { Business, ServiceConfig } from '@prisma/client';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { BusinessRepository, BusinessWithConfig } from '@modules/business/business.repository';
import { ConfigService } from '@nestjs/config';
import { UpdateOperatingHoursSchema } from './schemas/business-hours.schema';
import { UpdateMessageTemplatesSchema } from './schemas/message-templates.schema';
import { UpdateDeliveryEstimatesSchema } from './schemas/delivery-estimates.schema';
import { CreateWhatsappTemplateSchema } from './schemas/whatsapp-template.schema';
import { Templates } from '@modules/whatsapp/templates/messages.template';
import axios from 'axios';

const GRAPH_API_VERSION = 'v20.0';

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);
  private phoneIdCache = new Map<string, { business: Business; cachedAt: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly businessRepo: BusinessRepository,
    private readonly tenant: TenantContext,
      private readonly config: ConfigService,   

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

async getMyBusiness(): Promise<BusinessWithConfig & { webhookUrl: string }> {
  const businessId = this.tenant.get();
  const business = await this.businessRepo.findById(businessId);

  if (!business) throw new NotFoundException('Business not found');

  const baseUrl = this.config.get<string>('PUBLIC_BASE_URL', 'https://cliqex-production.up.railway.app');

  return {
    ...business,
    webhookUrl: `${baseUrl}/api/v1/whatsapp/webhook`,
  };
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
  timezone?: string;
  operatingHours?: Record<string, { open: string; close: string; active: boolean }>;
  estimatedDeliveryMin?: number;
  estimatedDeliveryMax?: number;
  estimatedDeliveryUnit?: string;
}): Promise<Business> {
  const businessId = this.tenant.get();

  let operatingHours = data.operatingHours;
  if (operatingHours) {
    const result = UpdateOperatingHoursSchema.safeParse(operatingHours);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    operatingHours = result.data;
  }

  let deliveryEstimates:
    | { estimatedDeliveryMin: number; estimatedDeliveryMax: number; estimatedDeliveryUnit: string }
    | undefined;

  const wantsDeliveryUpdate =
    data.estimatedDeliveryMin !== undefined ||
    data.estimatedDeliveryMax !== undefined ||
    data.estimatedDeliveryUnit !== undefined;

  if (wantsDeliveryUpdate) {
    const result = UpdateDeliveryEstimatesSchema.safeParse({
      estimatedDeliveryMin: data.estimatedDeliveryMin,
      estimatedDeliveryMax: data.estimatedDeliveryMax,
      estimatedDeliveryUnit: data.estimatedDeliveryUnit,
    });
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    deliveryEstimates = result.data;
  }

  const updated = await this.businessRepo.update(businessId, {
    ...data,
    ...(operatingHours && { operatingHours }),
    ...(deliveryEstimates && deliveryEstimates),
  } as any);

  if (updated.whatsappPhoneId) {
    this.phoneIdCache.delete(updated.whatsappPhoneId);
  }

  return updated;
}

async getMessageTemplates(): Promise<{
  greeting: string;
  orderReceived: string;
  closedMessage: string;
  quoteFooter: string;
}> {
  const businessId = this.tenant.get();
  const business = await this.businessRepo.findById(businessId);
  if (!business) throw new NotFoundException('Business not found');

  const overrides = (business as any).messageTemplates ?? {};

  return {
    greeting: overrides.greeting ?? '',
    orderReceived:
      overrides.orderReceived ?? Templates.flowOrderReceived('{orderNumber}').body,
    closedMessage:
      overrides.closedMessage ?? Templates.closedMessage('{nextOpen}').body,
    quoteFooter: overrides.quoteFooter ?? '',
  };
}

async updateMessageTemplates(data: unknown): Promise<Business> {
  const result = UpdateMessageTemplatesSchema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }

  const businessId = this.tenant.get();
  const existing = await this.businessRepo.findById(businessId);

  const merged = { ...((existing?.messageTemplates as any) ?? {}), ...result.data };

  return this.businessRepo.update(businessId, { messageTemplates: merged as any });
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

  if (data.services) {
    const invalid = data.services.filter((s) => !s.id || typeof s.label !== 'string' || !s.label.trim());
    if (invalid.length) {
      throw new BadRequestException(
        `Cannot save service(s) missing a valid 'label': ${invalid.map((s) => s.id ?? '(no id)').join(', ')}`,
      );
    }
  }

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

  // ----------------------------------------------------------------
  // WhatsApp Templates — list + create, wraps Meta's Graph API so
  // business owners never touch Meta Business Manager or curl.
  // Always scoped to the logged-in admin's own business (this.tenant.get()),
  // same pattern as every other "me/..." method in this service.
  // ----------------------------------------------------------------

  async listTemplates(): Promise<any[]> {
    const businessId = this.tenant.get();
    const business = await this.businessRepo.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');

    if (!business.whatsappToken || !business.wabaId) {
      throw new BadRequestException(
        'WhatsApp Business Account not configured for this business — connect WhatsApp first',
      );
    }

    try {
      const res = await axios.get(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${business.wabaId}/message_templates`,
        { params: { access_token: business.whatsappToken } },
      );
      return res.data.data;
    } catch (err: any) {
      this.logger.error(
        `Failed to list WhatsApp templates for business ${businessId}: ${JSON.stringify(err.response?.data)}`,
      );
      throw new BadRequestException(
        err.response?.data?.error?.message ?? 'Failed to fetch templates from WhatsApp',
      );
    }
  }

  async createTemplate(data: unknown): Promise<{ id: string; status: string; category: string }> {
    const result = CreateWhatsappTemplateSchema.safeParse(data);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    const input = result.data;

    const businessId = this.tenant.get();
    const business = await this.businessRepo.findById(businessId);
    if (!business) throw new NotFoundException('Business not found');

    if (!business.whatsappToken || !business.wabaId) {
      throw new BadRequestException(
        'WhatsApp Business Account not configured for this business — connect WhatsApp first',
      );
    }

    const variableCount = (input.bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
    if (variableCount > 0 && (!input.bodyExampleValues || input.bodyExampleValues.length < variableCount)) {
      throw new BadRequestException(
        `Body text has ${variableCount} variable(s) (e.g. {{1}}) but only ${input.bodyExampleValues?.length ?? 0} example value(s) were given. ` +
        `Meta requires one example value per variable to review the template.`,
      );
    }

    const components: any[] = [
      {
        type: 'BODY',
        text: input.bodyText,
        ...(input.bodyExampleValues?.length
          ? { example: { body_text: [input.bodyExampleValues] } }
          : {}),
      },
    ];

    try {
      const res = await axios.post(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${business.wabaId}/message_templates`,
        {
          name: input.name,
          language: input.language,
          category: input.category,
          components,
        },
        { headers: { Authorization: `Bearer ${business.whatsappToken}` } },
      );

      this.logger.log(
        `WhatsApp template "${input.name}" submitted for business ${businessId} — status: ${res.data.status}`,
      );

      return res.data;
    } catch (err: any) {
      this.logger.error(
        `Failed to create WhatsApp template for business ${businessId}: ${JSON.stringify(err.response?.data)}`,
      );
      throw new BadRequestException(
        err.response?.data?.error?.error_data?.details ??
        err.response?.data?.error?.message ??
        'Failed to create template on WhatsApp',
      );
    }
  }
}