import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@common/prisma/prisma.service';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import {
  FlowFieldDef,
  FlowServiceDef,
  FlowAreaDef,
  RESERVED_FIELD_NAMES,
} from './flow-config.types';

const DEFAULT_BANNER_URL =
  'https://framerusercontent.com/images/PJcmrxVhk65jGsb0BPRJrwq6ko.jpg';

// ----------------------------------------------------------------
// Retry helper — exponential backoff, skip 4xx
// ----------------------------------------------------------------
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  logger: Logger,
  maxAttempts = 3,
): Promise<T> {
  const delays = [2000, 4000, 8000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = (err as AxiosError)?.response?.status;

      // 4xx errors — bad credentials / bad config — retrying won't help
      if (status && status >= 400 && status < 500) {
        logger.error(`[${label}] 4xx error (${status}) — not retrying`);
        throw err;
      }

      if (attempt === maxAttempts) {
        logger.error(`[${label}] Failed after ${maxAttempts} attempts`);
        throw err;
      }

      const delay = delays[attempt - 1];
      logger.warn(`[${label}] Attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // TypeScript unreachable — loop always throws or returns
  throw new Error(`[${label}] Retry loop exhausted`);
}

@Injectable()
export class FlowsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FlowsService.name);
  private readonly version: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.version = this.config.get('WHATSAPP_API_VERSION', 'v19.0');
  }

  // ----------------------------------------------------------------
  // SAFE INIT (never crash app)
  // ----------------------------------------------------------------
  async onApplicationBootstrap(): Promise<void> {
    setTimeout(() => this.initFlows(), 5000);
  }

  private async initFlows(): Promise<void> {
    try {
      // ✅ Also retry FAILED businesses that haven't hit the 3-attempt cap
      const businesses = await this.prisma.business.findMany({
        where: {
          isActive: true,
          whatsappToken: { not: null },
          whatsappPhoneId: { not: null },
          OR: [
            { flowId: null },
            {
              flowRegistrationStatus: 'FAILED',
              flowRegistrationRetries: { lt: 3 },
            },
          ],
        },
      });

      if (!businesses.length) {
        this.logger.log('No businesses need flow registration');
        return;
      }

      this.logger.log(`Registering/retrying flows for ${businesses.length} businesses...`);

      for (const business of businesses) {
        try {
          await this.registerFlowForBusiness(business.id, business.whatsappToken!, business.name);
        } catch (err: any) {
          this.logger.error(`Skipping flow for ${business.name}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Flow init failed: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------
  // GET FLOW ID — returns null instead of throwing if not registered
  // ----------------------------------------------------------------
  async getFlowIdForBusiness(businessId: string): Promise<string | null> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { flowId: true, whatsappToken: true, name: true },
    });

    if (!business) throw new Error(`Business ${businessId} not found`);
    if (business.flowId) return business.flowId;
    if (!business.whatsappToken) return null;

    try {
      return await this.registerFlowForBusiness(businessId, business.whatsappToken, business.name);
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------
  // REGISTER FLOW — with status tracking + retry + admin notification
  // ----------------------------------------------------------------
  async registerFlowForBusiness(businessId: string, token: string, name: string): Promise<string> {
    // Mark as PENDING and increment attempt counter
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        flowRegistrationStatus: 'PENDING',
        flowRegistrationError: null,
        lastFlowAttemptAt: new Date(),
        flowRegistrationRetries: { increment: 1 },
      },
    });

    try {
      const serviceConfig = await this.prisma.serviceConfig.findUnique({
        where: { businessId },
        select: { services: true },
      });

      const activeServices = (
        (serviceConfig?.services as unknown as FlowServiceDef[]) ?? []
      ).filter((s) => s.active !== false);

      if (!activeServices.length) {
        throw new Error(`Business ${businessId} has no active services`);
      }

      const baseUrl = this.config.get<string>('PUBLIC_BASE_URL');
      if (!baseUrl) throw new Error('PUBLIC_BASE_URL not configured');

      const wabaId = await withRetry(
        () => this.getWabaIdSafe(businessId, token),
        `getWabaId(${name})`,
        this.logger,
      );
      if (!wabaId) throw new Error(`Cannot resolve WABA ID for business ${businessId}`);

      // Step 1 — Create flow on Meta
      const createRes = await withRetry(
        () =>
          axios.post(
            `https://graph.facebook.com/${this.version}/${wabaId}/flows`,
            { name: `${name} Order Flow ${Date.now()}`, categories: ['OTHER'] },
            { headers: this.authHeaders(token) },
          ),
        `createFlow(${name})`,
        this.logger,
      );

      const flowId = createRes.data?.id;
      if (!flowId) throw new Error('Flow ID not returned by Meta');
      this.logger.log(`Flow created: ${flowId} (${name})`);

      // Step 2 — Upload JSON
      await withRetry(
        () => this.uploadFlowJson(flowId, token, businessId),
        `uploadFlowJson(${name})`,
        this.logger,
      );

      // Step 3 — Set endpoint URI
      await withRetry(
        () =>
          axios.post(
            `https://graph.facebook.com/${this.version}/${flowId}`,
            { endpoint_uri: `${baseUrl}/api/v1/whatsapp/webhook/flow/${businessId}` },
            { headers: this.authHeaders(token) },
          ),
        `setEndpoint(${name})`,
        this.logger,
      );

      // ✅ Save flowId and mark SUCCESS before publish attempt
      await this.prisma.business.update({
        where: { id: businessId },
        data: {
          flowId,
          flowRegistrationStatus: 'SUCCESS',
          flowRegistrationError: null,
        },
      });
      this.logger.log(`Flow saved for ${name}: ${flowId}`);

      await new Promise((resolve) => setTimeout(resolve, 5000));

      try {
        await withRetry(
          () => this.publishFlow(flowId, token),
          `publishFlow(${name})`,
          this.logger,
        );
        this.logger.log(`Flow published for ${name}: ${flowId}`);
      } catch (err: any) {
        const detail = err.response?.data ?? err.message;
        this.logger.warn(
          `Flow publish failed for ${name} — flow saved but not published yet. ` +
            `Use /api/v1/flows/resync once your endpoint is stable. ` +
            `Error: ${JSON.stringify(detail)}`,
        );
        // Don't rethrow — flowId is saved, greeting will still work in DRAFT mode
      }

      return flowId;
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message ?? err.message;
      this.logger.error(`Flow registration FAILED for ${name}: ${errorMessage}`);

      // ✅ Mark as FAILED with error details
      await this.prisma.business.update({
        where: { id: businessId },
        data: {
          flowRegistrationStatus: 'FAILED',
          flowRegistrationError: errorMessage,
        },
      });

      // ✅ Notify business owner via WhatsApp
      await this.notifyAdminOfFlowFailure(businessId, name, errorMessage);

      throw err;
    }
  }

  // ----------------------------------------------------------------
  // ADMIN NOTIFICATION — uses platform-level credentials
  // ----------------------------------------------------------------
  private async notifyAdminOfFlowFailure(
    businessId: string,
    businessName: string,
    errorMessage: string,
  ): Promise<void> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { businessPhone: true, flowRegistrationRetries: true },
    });

    if (!business?.businessPhone) {
      this.logger.warn(
        `Flow registration failed for "${businessName}" but businessPhone is not set — cannot send admin notification`,
      );
      return;
    }

    const platformToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const platformPhoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');

    if (!platformToken || !platformPhoneId) {
      this.logger.warn('Platform WhatsApp credentials not configured — skipping admin notification');
      return;
    }

    const message =
      `⚠️ *Flow Registration Failed*\n\n` +
      `Business: *${businessName}*\n` +
      `Attempts: ${business.flowRegistrationRetries ?? 1}/3\n` +
      `Error: ${errorMessage}\n\n` +
      `To retry, fix your WhatsApp credentials and call:\n` +
      `POST /api/v1/flows/register`;

    try {
      await axios.post(
        `https://graph.facebook.com/${this.version}/${platformPhoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: business.businessPhone,
          type: 'text',
          text: { preview_url: false, body: message },
        },
        {
          headers: {
            Authorization: `Bearer ${platformToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`Admin notification sent to ${business.businessPhone} for "${businessName}"`);
    } catch (notifyErr: any) {
      this.logger.warn(
        `Could not send admin notification for "${businessName}": ${notifyErr.message}`,
      );
    }
  }

  // ----------------------------------------------------------------
  // TRIGGER REGISTRATION (for the POST /flows/register endpoint)
  // ----------------------------------------------------------------
  async triggerRegistrationForBusiness(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { whatsappToken: true, name: true },
    });

    if (!business?.whatsappToken) {
      throw new Error(`Business ${businessId} has no whatsappToken configured`);
    }

    // Reset retry counter so a manual trigger always gets a full 3 attempts
    await this.prisma.business.update({
      where: { id: businessId },
      data: { flowRegistrationRetries: 0, flowId: null },
    });

    return this.registerFlowForBusiness(businessId, business.whatsappToken, business.name);
  }

  // ----------------------------------------------------------------
  // WABA RESOLUTION
  // ----------------------------------------------------------------
  private async getWabaIdSafe(businessId: string, token: string): Promise<string | null> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { wabaId: true, whatsappPhoneId: true },
    });

    if (business?.wabaId) return business.wabaId;

    if (!business?.whatsappPhoneId) {
      this.logger.error('No whatsappPhoneId set, cannot resolve WABA');
      return null;
    }

    const res = await axios.get(
      `https://graph.facebook.com/${this.version}/${business.whatsappPhoneId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'whatsapp_business_account' },
      },
    );

    const wabaId = res.data?.whatsapp_business_account?.id;
    if (!wabaId) {
      this.logger.error(`No WABA linked to phone: ${JSON.stringify(res.data)}`);
      return null;
    }

    await this.prisma.business.update({ where: { id: businessId }, data: { wabaId } });
    return wabaId;
  }

  // ----------------------------------------------------------------
  // FLOW JSON UPLOAD
  // ----------------------------------------------------------------
  async uploadFlowJson(flowId: string, token: string, businessId: string): Promise<void> {
    const FormData = require('form-data');
    const content = await this.buildFlowJson(businessId);

    const form = new FormData();
    form.append('name', 'flow.json');
    form.append('asset_type', 'FLOW_JSON');
    form.append('file', Buffer.from(content), {
      filename: 'flow.json',
      contentType: 'application/json',
    });

    let uploadRes;
    try {
      uploadRes = await axios.post(
        `https://graph.facebook.com/${this.version}/${flowId}/assets`,
        form,
        { headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() } },
      );
    } catch (err: any) {
      this.logger.error(
        `Flow JSON upload request failed: ${JSON.stringify(err.response?.data ?? err.message)}`,
      );
      throw err;
    }

    const validationErrors = uploadRes.data?.validation_errors ?? [];
    if (validationErrors.length) {
      this.logger.error(`Flow JSON validation errors: ${JSON.stringify(validationErrors)}`);
      throw new Error(`Flow JSON rejected by Meta: ${validationErrors[0]?.message}`);
    }

    this.logger.log(`Flow JSON uploaded: ${flowId}`);
  }

  // ----------------------------------------------------------------
  // RESYNC
  // ----------------------------------------------------------------
  async resyncFlowForBusiness(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { flowId: true, whatsappToken: true, name: true },
    });

    if (!business?.flowId) throw new Error(`Business ${businessId} has no registered flowId yet`);
    if (!business.whatsappToken) throw new Error('Missing WhatsApp token');

    const statusRes = await axios.get(
      `https://graph.facebook.com/${this.version}/${business.flowId}`,
      { headers: this.authHeaders(business.whatsappToken), params: { fields: 'status' } },
    );
    const currentStatus = statusRes.data?.status;
    this.logger.log(`Current flow status for ${business.name}: ${currentStatus}`);

    if (currentStatus !== 'DRAFT') {
      this.logger.warn(
        `Flow ${business.flowId} is ${currentStatus} — can't edit, creating a new flow instead`,
      );
      await this.prisma.business.update({
        where: { id: businessId },
        data: { flowId: null, flowRegistrationRetries: 0 },
      });
      return this.registerFlowForBusiness(businessId, business.whatsappToken, business.name);
    }

    await this.uploadFlowJson(business.flowId, business.whatsappToken, businessId);

    const baseUrl = this.config.get<string>('PUBLIC_BASE_URL');
    if (baseUrl) {
      await axios.post(
        `https://graph.facebook.com/${this.version}/${business.flowId}`,
        { endpoint_uri: `${baseUrl}/api/v1/whatsapp/webhook/flow/${businessId}` },
        { headers: this.authHeaders(business.whatsappToken) },
      );
    }

    try {
      await this.publishFlow(business.flowId, business.whatsappToken);
      this.logger.log(`Flow published for ${business.name}: ${business.flowId}`);
    } catch (err: any) {
      this.logger.warn(
        `Flow publish failed — JSON updated but flow remains in DRAFT. ` +
          `Error: ${err.response?.data?.error?.error_user_msg ?? err.message}`,
      );
    }

    this.logger.log(`Flow re-synced for ${business.name}: ${business.flowId}`);
    return business.flowId;
  }

  // ----------------------------------------------------------------
  // BUILD FLOW JSON, SCREEN BUILDERS, CRYPTO — unchanged, kept in full
  // ----------------------------------------------------------------

  private async buildFlowJson(businessId: string): Promise<string> {
    const serviceConfig = await this.prisma.serviceConfig.findUnique({
      where: { businessId },
      select: {
        services: true,
        areas: true,
        welcomeText: true,
        headerImageUrl: true,
        servicePageImageUrl: true, 
        serviceBanners: true,
      },
    });

    if (!serviceConfig) {
      throw new Error(`No ServiceConfig found for business ${businessId} — cannot build flow`);
    }

    const services = ((serviceConfig.services as unknown as FlowServiceDef[]) ?? [])
      .filter((s) => s.active !== false)
      .map((s) => ({ ...s, fields: s.fields ?? [] }));

    if (!services.length) {
      throw new Error(`Business ${businessId} has no active services configured`);
    }

    const areas = (serviceConfig.areas as unknown as FlowAreaDef[]) ?? [];
    const banners = (serviceConfig.serviceBanners as Record<string, string>) ?? {};

    const serviceScreen = this.buildServiceSelectScreen(services);
    const detailScreens = services.map((s) => this.buildServiceDetailScreen(s, areas));

    const allFieldNames = Array.from(
      new Set([
        'service_type',
        'customer_name',
        'delivery_address',
        'phone_number',
        'additional_info',
        ...(areas.length ? ['area'] : []),
        ...services.flatMap((s) => s.fields.map((f) => f.name)),
      ]),
    );
    const summaryScreen = this.buildSummaryScreen(allFieldNames);

    const routing_model: Record<string, string[]> = {
      SCREEN_SERVICE: detailScreens.map((s) => s.id),
    };
    for (const s of detailScreens) routing_model[s.id] = ['SCREEN_SUMMARY'];
    routing_model['SCREEN_SUMMARY'] = [];

    const flow: any = {
      version: '7.3',
      data_api_version: '3.0',
      routing_model,
      screens: [serviceScreen, ...detailScreens, summaryScreen],
    };

    const base64Cache: Record<string, string | null> = {};
  const screenBannerMap: Record<string, string> = {
  SCREEN_SERVICE: serviceConfig.servicePageImageUrl || serviceConfig.headerImageUrl || DEFAULT_BANNER_URL,
};
    for (const s of services) {
      screenBannerMap[`SCREEN_DETAILS_${s.id}`] = banners[s.id] || DEFAULT_BANNER_URL;
    }

    for (const screen of flow.screens) {
      if (screen.id === 'SCREEN_SUMMARY') continue;

      const bannerUrl = screenBannerMap[screen.id];
      if (!bannerUrl) continue;

      if (!(bannerUrl in base64Cache)) {
        base64Cache[bannerUrl] = await this.fetchImageAsBase64(bannerUrl);
      }

      const base64 = base64Cache[bannerUrl];
      if (!base64) {
        this.logger.warn(`No base64 image for ${screen.id} — skipping banner`);
        continue;
      }

      screen.layout.children.unshift({
        type: 'Image',
        src: base64,
        height: screen.id === 'SCREEN_SERVICE' ? 130 : 160,
        'scale-type': 'cover',
      });
    }

    const radioGroup = serviceScreen.layout.children.find(
      (c: any) => c.type === 'RadioButtonsGroup',
    );
    if (radioGroup) {
      let anyIcon = false;
      for (const item of radioGroup['data-source']) {
        const service = services.find((s) => s.id === item.id);
        if (!service?.icon) continue;

        if (!(service.icon in base64Cache)) {
          base64Cache[service.icon] = await this.fetchImageAsBase64(service.icon, 100);
        }
        if (base64Cache[service.icon]) {
          item.image = base64Cache[service.icon];
          anyIcon = true;
        }
      }
      if (anyIcon) radioGroup['media-size'] = 'large';
    }

    this.logger.log(
      `Flow built for ${businessId}: ${services.length} services (${services.map((s) => s.id).join(', ')}), ${areas.length} areas`,
    );

    return JSON.stringify(flow);
  }

  private buildServiceSelectScreen(services: FlowServiceDef[]): any {
    return {
      id: 'SCREEN_SERVICE',
      title: 'Select a Service',
      terminal: false,
      data: {
        customer_name: { type: 'string', __example__: '' },
        delivery_address: { type: 'string', __example__: '' },
        phone_number: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
         { type: 'TextSubheading', text: "What's on your to-do list today?" },
{ type: 'TextBody', text: 'Choose a service and let your Buddy handle it.' },
          {
            type: 'RadioButtonsGroup',
            name: 'service_type',
            label: 'Select a Service',
            required: true,
            'data-source': services.map((s) => ({
              id: s.id,
              title: s.label,
              ...(s.description ? { description: s.description } : {}),
            })),
          },
          {
            type: 'Footer',
            label: 'Continue →',
            'on-click-action': {
              name: 'data_exchange',
              payload: {
                service_type: '${form.service_type}',
                customer_name: '${data.customer_name}',
                delivery_address: '${data.delivery_address}',
                phone_number: '${data.phone_number}',
              },
            },
          },
        ],
      },
    };
  }

  private buildServiceDetailScreen(service: FlowServiceDef, areas: FlowAreaDef[]): any {
    const screenId = `SCREEN_DETAILS_${service.id}`;
    const hideDeliveryAddress = service.overrideStandardFields?.hideDeliveryAddress ?? false;

    const customFields = service.fields.filter((f) => {
      if (RESERVED_FIELD_NAMES.has(f.name)) {
        this.logger.warn(
          `Service "${service.id}" field "${f.name}" collides with reserved — skipping`,
        );
        return false;
      }
      return true;
    });

    const customFieldChildren = customFields.map((f) => this.renderFieldComponent(f));

    const standardChildren: any[] = [
      { type: 'TextSubheading', text: '📍 Your Details' },
      this.renderFieldComponent(
        {
          name: 'customer_name',
          label: 'Your Full Name',
          type: 'text',
          required: true,
          helperText: 'Enter your full name',
        },
        'customer_name',
      ),
    ];

    if (!hideDeliveryAddress) {
      standardChildren.push(
        this.renderFieldComponent(
          {
            name: 'delivery_address',
            label: 'Delivery Address',
            type: 'textarea',
            required: true,
            maxLength: 300,
            helperText: 'House/flat number, street, estate, nearest landmark',
          },
          'delivery_address',
        ),
      );
    }

    if (areas.length) {
      standardChildren.push(
        this.renderFieldComponent({
          name: 'area',
          label: 'Area',
          type: 'dropdown',
          required: true,
          options: areas.map((a) => ({ id: a.id, title: a.label })),
        }),
      );
    }

    standardChildren.push(
      this.renderFieldComponent(
        {
          name: 'phone_number',
          label: 'Phone Number',
          type: 'phone',
          required: true,
          helperText: 'We may contact you on this number',
        },
        'phone_number',
      ),
      this.renderFieldComponent({
        name: 'additional_info',
        label: 'Additional Notes (Optional)',
        type: 'textarea',
        required: false,
        maxLength: 400,
        helperText: 'Anything else we should know?',
      }),
    );

    const footerPayload: Record<string, string> = { service_type: service.id };
    for (const f of customFields) footerPayload[f.name] = `\${form.${f.name}}`;
    footerPayload.customer_name = '${form.customer_name}';
    if (!hideDeliveryAddress) footerPayload.delivery_address = '${form.delivery_address}';
    if (areas.length) footerPayload.area = '${form.area}';
    footerPayload.phone_number = '${form.phone_number}';
    footerPayload.additional_info = '${form.additional_info}';

    return {
      id: screenId,
      title: service.label,
      terminal: false,
      data: {
        service_type: { type: 'string', __example__: service.id },
        customer_name: { type: 'string', __example__: '' },
        delivery_address: { type: 'string', __example__: '' },
        phone_number: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: service.label },
          ...(service.description ? [{ type: 'TextBody', text: service.description }] : []),
          ...customFieldChildren,
          ...standardChildren,
          {
            type: 'Footer',
            label: 'Review →',
            'on-click-action': { name: 'data_exchange', payload: footerPayload },
          },
        ],
      },
    };
  }

  private buildSummaryScreen(allFieldNames: string[]): any {
    const dataSchema: Record<string, any> = {
      summary_table: {
        type: 'string',
        __example__: '## Review\n\n| Field | Details |\n| --- | --- |',
      },
    };
    for (const name of allFieldNames) dataSchema[name] = { type: 'string', __example__: '' };

    const completionPayload: Record<string, string> = {};
    for (const name of allFieldNames) completionPayload[name] = `\${data.${name}}`;

    return {
      id: 'SCREEN_SUMMARY',
      title: 'Review & Submit',
      terminal: true,
      data: dataSchema,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'RichText', text: '${data.summary_table}' },
          {
            type: 'Footer',
            label: 'Confirm & Submit',
            'on-click-action': { name: 'complete', payload: completionPayload },
          },
        ],
      },
    };
  }

  private renderFieldComponent(field: FlowFieldDef, initFromKey?: string): any {
    const base: any = {
      label: field.label,
      name: field.name,
      required: field.required ?? false,
    };
    if (field.helperText) base['helper-text'] = field.helperText;
    if (initFromKey) base['init-value'] = `\${data.${initFromKey}}`;

    switch (field.type) {
      case 'textarea':
        return {
          type: 'TextArea',
          ...base,
          ...(field.maxLength ? { 'max-length': field.maxLength } : {}),
        };
      case 'phone':
        return { type: 'TextInput', ...base, 'input-type': 'phone' };
      case 'number':
        return { type: 'TextInput', ...base, 'input-type': 'number' };
      case 'dropdown':
        return {
          type: 'Dropdown',
          ...base,
          'data-source': (field.options ?? []).map((o) => ({ id: o.id, title: o.title })),
        };
      case 'radio':
        return {
          type: 'RadioButtonsGroup',
          ...base,
          'data-source': (field.options ?? []).map((o) => ({
            id: o.id,
            title: o.title,
            ...(o.description ? { description: o.description } : {}),
          })),
        };
      case 'text':
      default:
        return {
          type: 'TextInput',
          ...base,
          ...(field.maxLength ? { 'max-length': field.maxLength } : {}),
          'input-type': 'text',
        };
    }
  }

  private async fetchImageAsBase64(url: string, maxKb = 700, retries = 3)
: Promise<string | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1',
          },
          timeout: 10000,
        });

        const buffer = Buffer.from(response.data);
        if (buffer.length > maxKb * 1024) {
          this.logger.warn(`Image too large (${(buffer.length / 1024).toFixed(1)}KB) — skipping: ${url}`);
          return null;
        }

        return buffer.toString('base64');
      } catch (err: any) {
        this.logger.warn(`Image fetch attempt ${attempt}/${retries} failed: ${url} — ${err.message}`);
        if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    this.logger.error(`Failed to fetch image after ${retries} attempts: ${url}`);
    return null;
  }

  async publishFlow(flowId: string, token: string): Promise<void> {
    await axios.post(
      `https://graph.facebook.com/${this.version}/${flowId}/publish`,
      {},
      { headers: this.authHeaders(token) },
    );
  }

  decryptFlowPayload(
    encryptedBody: string,
    encryptedAesKey: string,
    initialVector: string,
    privateKeyPem: string,
  ): any {
    const aesKeyBuffer = crypto.privateDecrypt(
      {
        key: privateKeyPem,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(encryptedAesKey, 'base64'),
    );

    const ivBuffer = Buffer.from(initialVector, 'base64');
    const bodyBuffer = Buffer.from(encryptedBody, 'base64');
    const tagBuffer = bodyBuffer.slice(-16);
    const dataBuffer = bodyBuffer.slice(0, -16);

    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKeyBuffer, ivBuffer);
    decipher.setAuthTag(tagBuffer);

    const decrypted = Buffer.concat([decipher.update(dataBuffer), decipher.final()]);
    return JSON.parse(decrypted.toString('utf-8'));
  }

  encryptFlowResponse(responseData: any, aesKeyBuffer: Buffer, ivBuffer: Buffer): string {
    const flippedIv = Buffer.alloc(ivBuffer.length);
    for (let i = 0; i < ivBuffer.length; i++) flippedIv[i] = ~ivBuffer[i];

    const cipher = crypto.createCipheriv('aes-128-gcm', aesKeyBuffer, flippedIv);
    const data = Buffer.from(JSON.stringify(responseData), 'utf-8');
    const encrypted = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);

    return encrypted.toString('base64');
  }

  private authHeaders(token: string) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }
}