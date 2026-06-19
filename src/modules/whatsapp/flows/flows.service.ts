import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@common/prisma/prisma.service';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class FlowsService implements OnApplicationBootstrap 
{  private readonly logger = new Logger(FlowsService.name);
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
  // Delay to ensure HTTP server is fully listening before Meta's health check
  setTimeout(() => this.initFlows(), 5000);
}

private async initFlows(): Promise<void> {
  try {
    const businesses = await this.prisma.business.findMany({
  where: {
    isActive: true,
    whatsappToken: { not: null },
    whatsappPhoneId: { not: null },
    flowId: null, // ✅ only register businesses that don't have one yet
  },
});

      if (!businesses.length) {
        this.logger.log('No businesses to register flows for');
        return;
      }

      this.logger.log(`Registering flows for ${businesses.length} businesses...`);

      for (const business of businesses) {
        try {
          await this.registerFlowForBusiness(
            business.id,
            business.whatsappToken!,
            business.name,
          );
        } catch (err) {
          this.logger.error(
            `Skipping flow for ${business.name}: ${err.message}`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Flow init failed: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------
  // GET FLOW
  // ----------------------------------------------------------------
  async getFlowIdForBusiness(businessId: string): Promise<string> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        flowId: true,
        whatsappToken: true,
        name: true,
      },
    });

    if (!business) throw new Error(`Business ${businessId} not found`);

    if (business.flowId) return business.flowId;

    if (!business.whatsappToken) {
      throw new Error('Missing WhatsApp token');
    }

    return this.registerFlowForBusiness(
      businessId,
      business.whatsappToken,
      business.name,
    );
  }

  // ----------------------------------------------------------------
  // REGISTER FLOW
  // ----------------------------------------------------------------
 async registerFlowForBusiness(
  businessId: string,
  token: string,
  name: string,
): Promise<string> {
  const wabaId = await this.getWabaIdSafe(businessId, token);
  if (!wabaId) {
    throw new Error(`Cannot resolve WABA ID for business ${businessId}`);
  }

  try {
    const createRes = await axios.post(
      `https://graph.facebook.com/${this.version}/${wabaId}/flows`,
      { name: `${name} Order Flow ${Date.now()}`, categories: ['OTHER'] },
      { headers: this.authHeaders(token) },
    );

    const flowId = createRes.data?.id;
    if (!flowId) throw new Error('Flow ID not returned by Meta');
    this.logger.log(`Flow created: ${flowId} (${name})`);

    this.logger.log(`Starting JSON upload for flow: ${flowId}`);
    await this.uploadFlowJson(flowId, token, businessId);
   this.logger.log(`Upload done, setting endpoint URI...`);

await axios.post(
  `https://graph.facebook.com/${this.version}/${flowId}`,
  { endpoint_uri: 'https://unhearing-hazard-repaying.ngrok-free.dev/api/v1/whatsapp/webhook' },
  { headers: this.authHeaders(token) },
);

this.logger.log(`Endpoint URI set, waiting 3s then publishing...`);

await new Promise(resolve => setTimeout(resolve, 3000));

await this.publishFlow(flowId, token);
    this.logger.log(`Published flow: ${flowId}`);

    await this.prisma.business.update({
      where: { id: businessId },
      data: { flowId },
    });

    // TEMP: verify it saved
    const check = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, flowId: true },
    });
    this.logger.log(`DB CHECK: ${JSON.stringify(check)}`);

    this.logger.log(`Flow registered for ${name}: ${flowId}`);
    return flowId;
  } catch (err: any) {
    const detail = err.response?.data ?? err.message;
    this.logger.error(`Flow registration failed for ${name}: ${JSON.stringify(detail)}`);
    return '';
  }
}
private async findExistingFlow(
  wabaId: string,
  token: string,
  name: string,
): Promise<string | null> {
  try {
    const res = await axios.get(
      `https://graph.facebook.com/${this.version}/${wabaId}/flows`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'id,name' },
      },
    );

    const targetName = `${name} Order Flow`;
    const match = (res.data?.data ?? []).find(
      (f: { id: string; name: string }) => f.name === targetName,
    );

    return match?.id ?? null;
  } catch (err: any) {
    this.logger.warn(
      `Could not list existing flows: ${JSON.stringify(err.response?.data ?? err.message)}`,
    );
    return null;
  }
}
  // ----------------------------------------------------------------
  // WABA RESOLUTION
  // ----------------------------------------------------------------
  private async getWabaIdSafe(
  businessId: string,
  token: string,
): Promise<string | null> {
  const business = await this.prisma.business.findUnique({
    where: { id: businessId },
    select: { wabaId: true, whatsappPhoneId: true },
  });

  if (business?.wabaId) return business.wabaId;

  if (!business?.whatsappPhoneId) {
    this.logger.error('No whatsappPhoneId set, cannot resolve WABA');
    return null;
  }

  try {
    // Phone number -> parent WABA via whatsapp_business_account field
    const res = await axios.get(
      `https://graph.facebook.com/v19.0/${business.whatsappPhoneId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'whatsapp_business_account' },
      },
    );

    const wabaId = res.data?.whatsapp_business_account?.id;

    if (!wabaId) {
      this.logger.error(
        `No WABA linked to phone: ${JSON.stringify(res.data)}`,
      );
      return null;
    }

    await this.prisma.business.update({
      where: { id: businessId },
      data: { wabaId },
    });

    return wabaId;
  } catch (err: any) {
    this.logger.error(
      `WABA fetch failed: ${JSON.stringify(err.response?.data ?? err.message)}`,
    );
    return null;
  }
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

  const uploadRes = await axios.post(
    `https://graph.facebook.com/${this.version}/${flowId}/assets`,
    form,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders(),
      },
    },
  );

  const validationErrors = uploadRes.data?.validation_errors ?? [];
  if (validationErrors.length) {
    this.logger.error(`Flow JSON validation errors: ${JSON.stringify(validationErrors)}`);
    throw new Error(`Flow JSON rejected by Meta: ${validationErrors[0]?.message}`);
  }

  this.logger.log(`Flow JSON uploaded: ${flowId}`);
  this.logger.log(`Upload response: ${JSON.stringify(uploadRes.data)}`);
}
private async buildFlowJson(businessId: string): Promise<string> {
  const jsonPath = path.join(__dirname, 'errandsbuddy.flow.json');
  const flow = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const serviceConfig = await this.prisma.serviceConfig.findUnique({
    where: { businessId },
    select: { serviceBanners: true },
  });

  const banners = (serviceConfig?.serviceBanners as Record<string, string>) ?? {};

  const FRAMER_IMAGE = 'https://framerusercontent.com/images/PJcmrxVhk65jGsb0BPRJrwq6ko.jpg';

  const DEFAULT_SERVICE_ICONS: Record<string, string> = {
    GROCERY: 'https://www.alleplnews.com/wp-content/uploads/2026/06/grocery-cart-1.png',
    ERRAND: 'https://www.alleplnews.com/wp-content/uploads/2026/06/bag.png',
    CLEANING: 'https://www.alleplnews.com/wp-content/uploads/2026/06/cleaning-1.png',
  };

  const screenBannerMap: Record<string, string> = {
    SCREEN_SERVICE: FRAMER_IMAGE,
    SCREEN_DETAILS_GROCERY: banners.GROCERY || FRAMER_IMAGE,
    SCREEN_DETAILS_ERRAND: banners.ERRAND || FRAMER_IMAGE,
    SCREEN_DETAILS_CLEANING: banners.CLEANING || FRAMER_IMAGE,
  };

  const base64Cache: Record<string, string | null> = {};

  // ==================== UNIFIED BANNER LOGIC ====================
  for (const screen of flow.screens) {
    if (screen.id === 'SCREEN_SUMMARY') continue;

    const bannerUrl = screenBannerMap[screen.id];
    if (!bannerUrl) continue;

    if (!(bannerUrl in base64Cache)) {
      base64Cache[bannerUrl] = await this.fetchImageAsBase64(bannerUrl);
    }

    const base64 = base64Cache[bannerUrl];
    if (!base64) {
      this.logger.warn(`No base64 image for ${screen.id} — skipping`);
      continue;
    }

    const imageChild = screen.layout.children.find((c: any) => c.type === 'Image');
    if (imageChild) {
      imageChild.src = base64;
      this.logger.log(`Replaced existing Image src in ${screen.id}`);
    } else {
      screen.layout.children.unshift({
        type: 'Image',
        src: base64,
        height: 130,
        'scale-type': 'cover',
      });
      this.logger.log(`Injected new Image into ${screen.id}`);
    }
  }
  // ============================================================

  // SERVICE ICONS (for SCREEN_SERVICE radio buttons)
  const serviceScreen = flow.screens.find((s: any) => s.id === 'SCREEN_SERVICE');
  if (serviceScreen) {
    const radioGroup = serviceScreen.layout.children.find(
      (c: any) => c.type === 'RadioButtonsGroup'
    );

    if (radioGroup) {
      radioGroup['media-size'] = 'large';

      for (const item of radioGroup['data-source']) {
        const iconUrl = DEFAULT_SERVICE_ICONS[item.id];
        if (!iconUrl) continue;

        if (!(iconUrl in base64Cache)) {
          base64Cache[iconUrl] = await this.fetchImageAsBase64(iconUrl, 100);
        }

        if (base64Cache[iconUrl]) {
          item.image = base64Cache[iconUrl];
          this.logger.log(`Injected icon for ${item.id}`);
        }
      }
    }
  }

  // Debug logs
  for (const screen of flow.screens) {
    const childTypes = screen.layout.children.map((c: any) => c.type);
    this.logger.log(`${screen.id} children: ${childTypes.join(', ')}`);
  }

  const summaryScreen = flow.screens.find((s: any) => s.id === 'SCREEN_SUMMARY');
  this.logger.log(`SCREEN_SUMMARY DATA BLOCK: ${JSON.stringify(summaryScreen?.data)}`);

  return JSON.stringify(flow);
}
// private async fetchImageAsBase64(
//   url: string,
//   maxKb = 300
// ): Promise<string | null> {
//   try {
//     const response = await axios.get(url, {
//       responseType: 'arraybuffer',
//       headers: {
//         'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
//         Accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1',
//       },
//     });

//     const buffer = Buffer.from(response.data);
//     const sizeKb = buffer.length / 1024;

//     this.logger.log(`Image fetched: ${url} (${sizeKb.toFixed(1)}KB)`);

//     if (buffer.length > maxKb * 1024) {
//       this.logger.warn(`Image too large (${sizeKb.toFixed(1)}KB) — skipping`);
//       return null;
//     }

//     // ✅ Raw base64 only — no data: prefix
//     return buffer.toString('base64');
//   } catch (err: any) {
//     this.logger.error(`Failed to fetch image: ${url} — ${err.message}`);
//     return null;
//   }
// }


private async fetchImageAsBase64(
  url: string,
  maxKb = 300,
  retries = 3,
): Promise<string | null> {
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
      const sizeKb = buffer.length / 1024;

      this.logger.log(`Image fetched: ${url} (${sizeKb.toFixed(1)}KB)`);

      if (buffer.length > maxKb * 1024) {
        this.logger.warn(`Image too large (${sizeKb.toFixed(1)}KB) — skipping`);
        return null;
      }

      return buffer.toString('base64');
    } catch (err: any) {
      this.logger.warn(`Image fetch attempt ${attempt}/${retries} failed: ${url} — ${err.message}`);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // 1s, 2s backoff
      }
    }
  }

  this.logger.error(`Failed to fetch image after ${retries} attempts: ${url}`);
  return null;
}
  // ----------------------------------------------------------------
  // PUBLISH FLOW
  // ----------------------------------------------------------------
  async publishFlow(flowId: string, token: string): Promise<void> {
    await axios.post(
      `https://graph.facebook.com/${this.version}/${flowId}/publish`,
      {},
      {
        headers: this.authHeaders(token),
      },
    );
  }

  async resyncFlowForBusiness(businessId: string): Promise<string> {
  const business = await this.prisma.business.findUnique({
    where: { id: businessId },
    select: { flowId: true, whatsappToken: true, name: true },
  });

  if (!business?.flowId) {
    throw new Error(`Business ${businessId} has no registered flowId yet`);
  }
  if (!business.whatsappToken) {
    throw new Error('Missing WhatsApp token');
  }

  await this.uploadFlowJson(business.flowId, business.whatsappToken, businessId);
  await this.publishFlow(business.flowId, business.whatsappToken);

  this.logger.log(`Flow re-synced for ${business.name}: ${business.flowId}`);
  return business.flowId;
}

  // ----------------------------------------------------------------
  // CRYPTO
  // ----------------------------------------------------------------
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

    const decipher = crypto.createDecipheriv(
      'aes-128-gcm',
      aesKeyBuffer,
      ivBuffer,
    );

    decipher.setAuthTag(tagBuffer);

    const decrypted = Buffer.concat([
      decipher.update(dataBuffer),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf-8'));
  }

  encryptFlowResponse(
    responseData: any,
    aesKeyBuffer: Buffer,
    ivBuffer: Buffer,
  ): string {
    const flippedIv = Buffer.alloc(ivBuffer.length);

    for (let i = 0; i < ivBuffer.length; i++) {
      flippedIv[i] = ~ivBuffer[i];
    }

    const cipher = crypto.createCipheriv(
      'aes-128-gcm',
      aesKeyBuffer,
      flippedIv,
    );

    const data = Buffer.from(JSON.stringify(responseData), 'utf-8');

    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final(),
      cipher.getAuthTag(),
    ]);

    return encrypted.toString('base64');
  }

  // ----------------------------------------------------------------
  // AUTH HEADERS
  // ----------------------------------------------------------------
  private authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }
}