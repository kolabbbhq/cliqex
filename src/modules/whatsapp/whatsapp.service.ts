import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { MessageDirection, MessageType, ServiceType } from '@prisma/client';

import { WhatsappRepository } from './whatsapp.repository';
import { CustomersService } from '@modules/customers/customers.service';
import { OrdersService } from '@modules/orders/orders.service';
import { FlowsService } from './flows/flows.service';
import { BusinessService } from '@modules/business/business.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { Templates } from './templates/messages.template';
import { UploadService } from '@modules/upload/upload.service';

import {
  ParsedInboundMessage,
  SendTextPayload,
  SendButtonsPayload,
  SendFlowPayload,
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  FlowSubmissionPayload,
} from './whatsapp.types';

import * as crypto from 'crypto';
const AREA_LABELS: Record<string, string> = {
  ASOKORO: 'Asokoro',
  MAITAMA: 'Maitama',
  WUSE: 'Wuse',
  WUSE_2: 'Wuse 2',
  GARKI: 'Garki',
  GARKI_2: 'Garki 2',
  GWARINPA: 'Gwarinpa',
  JABI: 'Jabi',
  UTAKO: 'Utako',
  KUBWA: 'Kubwa',
  LIFECAMP: 'Life Camp',
  KADO: 'Kado',
  DURUMI: 'Durumi',
  LUGBE: 'Lugbe',
  GALADIMAWA: 'Galadimawa',
  LOKOGOMA: 'Lokogoma',
  NBORA: 'Nbora',
  DAWAKI: 'Dawaki',
  KARMO: 'Karmo',
  KARU: 'Karu',
  NYANYA: 'Nyanya',
  MPAPE: 'Mpape',
  KATAMPE: 'Katampe',
  CENTRAL_AREA: 'Central Area',
  OTHER: 'Other',
};

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly version: string;

  constructor(
    private readonly whatsappRepository: WhatsappRepository,
    private readonly customersService: CustomersService,
    private readonly ordersService: OrdersService,
    private readonly flowsService: FlowsService,
    private readonly businessService: BusinessService, // ✅ NEW
    private readonly tenantContext: TenantContext, // ✅ NEW
    private readonly config: ConfigService,
      private readonly uploadService: UploadService, // ✅ NEW

  ) {
    this.version = this.config.get('WHATSAPP_API_VERSION', 'v19.0');
  }

  // ----------------------------------------------------------------
  // verifyWebhook
  //
  // Meta calls GET /webhook?hub.verify_token=xxx to verify setup.
  // In multi-tenant, each business has their own verify token.
  // We try to match against any active business.
  // ----------------------------------------------------------------
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    // For simplicity, use a single platform-level verify token
    // Businesses use the same webhook URL but their own tokens
    const platformToken = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === platformToken) {
      this.logger.log('WhatsApp webhook verified ✅');
      return challenge;
    }
    return null;
  }

  // ----------------------------------------------------------------
  // handleWebhook — MAIN ENTRY POINT
  //
  // This is where multi-tenancy happens at the WhatsApp level.
  //
  // Meta sends all messages to ONE webhook URL regardless of which
  // business phone number received the message. We use the
  // phone_number_id in the metadata to identify the business,
  // then set TenantContext before processing.
  // ----------------------------------------------------------------
  async handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    const changes = payload.entry?.flatMap((e) => e.changes) ?? [];

    for (const change of changes) {
      const value = change.value;
      const phoneId = value.metadata?.phone_number_id;

      // ✅ Look up which business owns this phone number
      const business = await this.businessService.resolveByPhoneId(phoneId);

      if (!business) {
        this.logger.warn(`No business found for phoneId: ${phoneId} — ignoring`);
        continue;
      }

      // ✅ Set TenantContext for all processing in this change
      this.tenantContext.set(business.id, false);

      const messages = value.messages ?? [];
      const statuses = value.statuses ?? [];

      for (const status of statuses) {
        await this.whatsappRepository.updateMessageStatus(
          status.id,
          status.status.toUpperCase() as any,
        );
      }

      for (const message of messages) {
        await this.processMessage(
          message,
          value.contacts?.[0]?.profile?.name ?? null,
          business.whatsappToken!, // ✅ use this business's token
          business.id,
        );
      }
    }
  }
private parseGroceryItems(
  itemListText: string,
): { name: string; nameLower: string; quantity: string }[] {
  return itemListText
    .split(/\n|,/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const match = segment.match(/^(.*?)\s*x\s*(\d+)$/i); 
      const name = match ? match[1].trim() : segment;
      const quantity = match ? match[2] : '1';
      return { name, nameLower: name.toLowerCase().trim(), quantity };
    });
}

private async resolveMediaUrl(
  mediaId: string,
  token: string,
  businessId: string,
): Promise<string | undefined> {
  try {
    const metaRes = await axios.get(
      `https://graph.facebook.com/${this.version}/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const tempUrl = metaRes.data?.url;
    if (!tempUrl) return undefined;

    const fileRes = await axios.get(tempUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });

    const { url } = await this.uploadService.uploadCustomerMedia(
      Buffer.from(fileRes.data),
      businessId,
    );
    return url;
  } catch (err: any) {
    this.logger.error(`Media resolve failed for ${mediaId}: ${err.message}`);
    return undefined;
  }
}
  // ----------------------------------------------------------------
  // processMessage
  // ----------------------------------------------------------------
  private async processMessage(
  raw: WhatsAppMessage,
  contactName: string | null,
  token: string,
  businessId: string,
): Promise<void> {
  const alreadyProcessed = await this.whatsappRepository.messageExists(raw.id);
  if (alreadyProcessed) return;

  const parsed = this.parseMessage(raw, contactName);
  const { customer, isNew } = await this.customersService.findOrCreate(parsed.phone);

  if (isNew && parsed.contactName) {
    await this.customersService.update(customer.id, { name: parsed.contactName });
  }

  if (customer.isBlocked) {
    this.logger.warn(`Blocked customer: ${customer.phone}`);
    return;
  }

  // ✅ Show typing indicator immediately after receiving message
  const business = await this.businessService.getById(businessId);
  if (business.whatsappPhoneId) {
    await this.sendTypingIndicator(parsed.phone, raw.id, token, business.whatsappPhoneId);
  }

  const activeOrder = await this.ordersService.findLatestActive(customer.id);

  let mediaUrl: string | undefined;
  if (parsed.mediaId) {
    mediaUrl = await this.resolveMediaUrl(parsed.mediaId, token, businessId);
  }

  await this.whatsappRepository.saveMessage({
    waMessageId: parsed.waMessageId,
    customerId: customer.id,
    orderId: activeOrder?.id,
    direction: MessageDirection.INBOUND,
    type: this.mapMessageType(parsed.type),
    content: parsed.text ?? undefined,
    mediaUrl,
    buttonPayload: parsed.buttonPayload ?? undefined,
  });

  await this.routeMessage(parsed, customer.id, token, businessId, activeOrder?.id, customer);
}
  // ----------------------------------------------------------------
  // routeMessage
  // ----------------------------------------------------------------
  // private async routeMessage(
  //   msg: ParsedInboundMessage,
  //   customerId: string,
  //   token: string,
  //   businessId: string,
  //   activeOrderId?: string,
  // ): Promise<void> {
  //   const phone = msg.phone;
  //   const payload = msg.buttonPayload?.toUpperCase();

  //   if (msg.flowPayload) {
  //     return this.handleFlowSubmission(phone, customerId, msg.flowPayload, token);
  //   }

  //   if (payload === 'CONFIRM_ORDER' && activeOrderId) {
  //     return this.handleConfirmOrder(phone, activeOrderId, token);
  //   }
  //   if (payload === 'CANCEL_ORDER' && activeOrderId) {
  //     return this.handleCancelOrder(phone, activeOrderId, token);
  //   }
  //   if (payload === 'PAY_TRANSFER' && activeOrderId) {
  //     return this.handlePayTransfer(phone, activeOrderId, token);
  //   }
  //   if (payload === 'PAY_ONLINE' && activeOrderId) {
  //     return this.handlePayOnline(phone, activeOrderId, token);
  //   }
  //   if (payload?.startsWith('RATING_') && activeOrderId) {
  //     return this.handleRating(phone, activeOrderId, payload, token);
  //   }

  //   if (msg.type === 'text' || msg.type === 'image' || msg.type === 'audio') {
  //     if (activeOrderId) return; // saved to thread for admin
  // return this.sendGreeting(phone, businessId, token, customer);
  //   }

  //   await this.sendFallback(phone, token);
  // }
  private async routeMessage(
  msg: ParsedInboundMessage,
  customerId: string,
  token: string,
  businessId: string,
  activeOrderId?: string,
  customer?: any,
): Promise<void> {
  const phone = msg.phone;
  const payload = msg.buttonPayload?.toUpperCase();

  if (msg.flowPayload) {
    return this.handleFlowSubmission(phone, customerId, msg.flowPayload, token);
  }

  if (payload === 'CONFIRM_ORDER' && activeOrderId) {
    return this.handleConfirmOrder(phone, activeOrderId, token);
  }
  if (payload === 'CANCEL_ORDER' && activeOrderId) {
    return this.handleCancelOrder(phone, activeOrderId, token);
  }
  if (payload === 'PAY_TRANSFER' && activeOrderId) {
    return this.handlePayTransfer(phone, activeOrderId, token);
  }
  // if (payload === 'PAY_ONLINE' && activeOrderId) {
  //   return this.handlePayOnline(phone, activeOrderId, token);
  // }
  if (payload?.startsWith('RATING_') && activeOrderId) {
    return this.handleRating(phone, activeOrderId, payload, token);
  }

  if (msg.type === 'text' || msg.type === 'image' || msg.type === 'audio') {
    if (activeOrderId) {
      return this.sendAutoAckIfNeeded(phone, activeOrderId, token);   // ← REPLACED "if (activeOrderId) return;"
    }
    return this.sendGreeting(phone, businessId, token, customer);
  }

  await this.sendFallback(phone, token);
}
  // ----------------------------------------------------------------
  // sendGreeting — uses this business's Flow ID and welcome text
  // ----------------------------------------------------------------
 async sendGreeting(
  phone: string,
  businessId: string,
  token: string,
  customer?: any,               // ← added
): Promise<void> {
  const [business, config, flowId] = await Promise.all([
    this.businessService.getById(businessId),
    this.businessService.getServiceConfig(businessId),
    this.flowsService.getFlowIdForBusiness(businessId),
  ]);

  const welcomeText =
    config?.welcomeText ??
    'Your one-stop solution for everyday needs. 🛒\n\nTap *Proceed* to place your order.';

  await this.sendFlow({
    to: phone,
    flowId,
    flowToken: uuidv4(),
    headerImage: config?.headerImageUrl || undefined,
    body: welcomeText,
    footer: 'Powered by Cliqex',
    ctaText: 'Proceed',
    token,
    phoneId: business.whatsappPhoneId!,
    prefill: {                                      // ← prefill object
      customer_name: customer?.name ?? '',
      delivery_address: customer?.address ?? '',
      phone_number: phone,
    },
  });

  this.logger.log(`Sending flow with flowId: ${flowId} to ${phone}`);
}

//   async sendGreeting(phone: string, businessId: string, token: string): Promise<void> {
//   const config = await this.businessService.getServiceConfig(businessId);
  
//   const welcomeText =
//     config?.welcomeText ??
//     'Welcome to ErrandsBuddy! 🛒 Your one-stop solution for everyday needs.\n\nReply with what you need and we\'ll sort it out for you.';

//   await this.sendText({
//     to: phone,
//     message: welcomeText,
//     token,
//   });
// }
  // ----------------------------------------------------------------
  // handleFlowSubmission
  // ----------------------------------------------------------------
 private async handleFlowSubmission(
  phone: string,
  customerId: string,
  flowData: FlowSubmissionPayload,
  token: string,
): Promise<void> {
   this.logger.log(`RAW FLOW DATA: ${JSON.stringify(flowData)}`);
  this.logger.log(
    `Flow submitted by ${phone} — ${flowData.service_label ?? flowData.service_type}`,
  );

  await this.customersService.update(customerId, {
    name: flowData.customer_name,
    address: flowData.delivery_address,
  });

  const serviceTypeMap: Record<string, ServiceType> = {
    GROCERY: ServiceType.GROCERY,
    ERRAND: ServiceType.ERRAND,
    CLEANING: ServiceType.CLEANING,
  };

  const order = await this.ordersService.create({
    customerId,
    serviceType: serviceTypeMap[flowData.service_type] ?? ServiceType.GROCERY,
    sourceType: 'TEXT',
    rawText: flowData.item_list,
    deliveryAddress: flowData.delivery_address,
    flowData: {
      serviceLabel: flowData.service_label,   // ← save the human-readable label
      itemList: flowData.item_list,
      budget: Number(flowData.budget),
      preferredStore: flowData.preferred_store,
      area: flowData.area,
      areaLabel: AREA_LABELS[flowData.area] ?? flowData.area,
      additionalInfo: flowData.additional_info,
      phoneNumber: flowData.phone_number,
    },
  });
  const items =
  flowData.service_type === 'GROCERY'
    ? this.parseGroceryItems(flowData.item_list)
    : [
        {
          name: flowData.item_list,
          nameLower: flowData.item_list.toLowerCase().trim(),
          quantity: '1',
        },
      ];

await this.ordersService.addItems(order.id, items);

const template = Templates.flowOrderReceived(order.orderNumber);
await this.sendText({ to: phone, message: template.body, token });

}
  // ----------------------------------------------------------------
  // handleConfirmOrder
  // ----------------------------------------------------------------
  private async handleConfirmOrder(phone: string, orderId: string, token: string): Promise<void> {
    await this.ordersService.confirmQuote(orderId);
    const template = Templates.paymentOptions();
    await this.sendButtons({ to: phone, body: template.body, buttons: template.buttons, token });
  }

  // ----------------------------------------------------------------
  // handlePayTransfer — uses THIS business's bank details
  // ----------------------------------------------------------------
  private async handlePayTransfer(phone: string, orderId: string, token: string): Promise<void> {
    const order = await this.ordersService.findOne(orderId);
    const business = await this.businessService.getById(order.businessId);

    const template = Templates.bankTransferDetails({
      amount: Number(order.total),
      orderNumber: order.orderNumber,
      bankName: business.bankName ?? 'Contact us for bank details',
      accountNumber: business.bankAccountNumber ?? '',
      accountName: business.bankAccountName ?? '',
    });
    await this.sendText({ to: phone, message: template.body, token });
  }

  // private async handlePayOnline(phone: string, orderId: string, token: string): Promise<void> {
  //   const order = await this.ordersService.findOne(orderId);
  //   const link = `https://pay.errandsbuddy.com/${order.orderNumber}`;
  //   const template = Templates.paymentLink({
  //     amount: Number(order.total),
  //     orderNumber: order.orderNumber,
  //     link,
  //   });
  //   await this.sendText({ to: phone, message: template.body, token });
  // }

  private async handleCancelOrder(phone: string, orderId: string, token: string): Promise<void> {
    const order = await this.ordersService.cancel(orderId, { reason: 'Cancelled by customer' });
    const template = Templates.orderCancelled(order.orderNumber);
    await this.sendText({ to: phone, message: template.body, token });
  }

  private async handleRating(
    phone: string,
    orderId: string,
    payload: string,
    token: string,
  ): Promise<void> {
    const ratingMap: Record<string, number> = { RATING_5: 5, RATING_3: 3, RATING_1: 1 };
    const rating = ratingMap[payload] ?? 3;
    await this.sendText({
      to: phone,
      message:
        rating >= 4
          ? `Thank you! 🙏 So glad we could help. See you next time! 😊`
          : `Thank you for the feedback. We'll do better! 💪`,
      token,
    });
  }

  // ================================================================
  // OUTBOUND SENDERS — now accept token per-call
  // ================================================================
async sendText(params: SendTextPayload & { token?: string }): Promise<void> {
  const token = params.token ?? this.config.get<string>('WHATSAPP_ACCESS_TOKEN')!;
  const result = await this.callMetaApi({
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'text',
      text: { preview_url: false, body: params.message },
    },
    token,
  });
  await this.logOutbound(params.to, result?.messages?.[0]?.id, params.message);
}

  async sendButtons(params: SendButtonsPayload & { token?: string }): Promise<void> {
  const token = params.token ?? this.config.get<string>('WHATSAPP_ACCESS_TOKEN')!;
  const result = await this.callMetaApi({
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'interactive',
      interactive: {
        type: 'button',
        ...(params.header && { header: { type: 'text', text: params.header } }),
        body: { text: params.body },
        ...(params.footer && { footer: { text: params.footer } }),
        action: {
          buttons: params.buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    },
    token,
  });
  await this.logOutbound(params.to, result?.messages?.[0]?.id, params.body);
}

  async sendFlow(params: SendFlowPayload & { 
  token?: string; 
  phoneId?: string; 
  prefill?: Record<string, any>   // ← added
}): Promise<void> {
  const token = params.token ?? this.config.get<string>('WHATSAPP_ACCESS_TOKEN')!;
  const phoneId = params.phoneId ?? this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')!;
  const apiUrl = `https://graph.facebook.com/${this.version}/${phoneId}/messages`;

  await axios.post(
    apiUrl,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        ...(params.headerImage && {
          header: { type: 'image', image: { link: params.headerImage } },
        }),
        body: { text: params.body },
        footer: { text: params.footer ?? 'Powered by ErrandsBuddy' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: params.flowToken,
            flow_id: params.flowId,
            flow_cta: params.ctaText,
            flow_action: 'navigate',
            flow_action_payload: { 
              screen: 'SCREEN_SERVICE', 
              data: params.prefill ?? {} 
            },
          },
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );
}

private async sendAutoAckIfNeeded(phone: string, orderId: string, token: string): Promise<void> {
  const order = await this.ordersService.findOne(orderId);
  if (order.autoAckSent) return;

  await this.sendText({
    to: phone,
    message: `Thanks for reaching out! 🙏 Our team has been notified and will respond shortly.`,
    token,
  });

  await this.ordersService.setAutoAck(orderId, true);
}

async sendManualReply(orderId: string, message: string): Promise<void> {
  const order = await this.ordersService.findOne(orderId);
  const business = await this.businessService.getById(order.businessId);

  await this.sendText({
    to: order.customer.phone,
    message,
    token: business.whatsappToken!,
  });

  await this.ordersService.setAutoAck(orderId, false); // renew the courtesy ack for next time they go quiet
}

  async getOrderThread(orderId: string) {
    return this.whatsappRepository.getOrderThread(orderId);
  }

  // ================================================================
  // PRIVATE HELPERS
  // ================================================================

  private async callMetaApi(params: {
  payload: Record<string, any>;
  token: string;
}): Promise<any> {
  const phoneId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')!;
  const apiUrl = `https://graph.facebook.com/${this.version}/${phoneId}/messages`;

  try {
    const response = await axios.post(apiUrl, params.payload, {
      headers: {
        Authorization: `Bearer ${params.token}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data; // ✅ NEW
  } catch (error: any) {
    const detail = error.response?.data ?? error.message;
    this.logger.error(`Meta API error: ${JSON.stringify(detail)}`);
    throw error;
  }
}

  private parseMessage(raw: WhatsAppMessage, contactName: string | null): ParsedInboundMessage {
    const buttonPayload =
      raw.button?.payload ??
      raw.interactive?.button_reply?.id ??
      raw.interactive?.list_reply?.id ??
      null;

    let flowPayload: FlowSubmissionPayload | null = null;
    if (raw.interactive?.type === 'nfm_reply' && raw.interactive.nfm_reply) {
      try {
        flowPayload = JSON.parse(raw.interactive.nfm_reply.response_json);
      } catch {
        this.logger.error('Failed to parse flow nfm_reply JSON');
      }
    }

    return {
      waMessageId: raw.id,
      phone: raw.from,
      contactName,
      type: raw.type,
      text: raw.text?.body ?? null,
      mediaId: raw.image?.id ?? raw.audio?.id ?? null,
      buttonPayload,
      flowPayload,
    };
  }

  private async logOutbound(
  phone: string,
  waMessageId: string | undefined,
  content: string,
): Promise<void> {
  try {
    const { customer } = await this.customersService.findOrCreate(phone);
    const activeOrder = await this.ordersService.findLatestActive(customer.id);
    await this.whatsappRepository.saveMessage({
      waMessageId: waMessageId ?? `out-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      customerId: customer.id,
      orderId: activeOrder?.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      content,
    });
  } catch (err: any) {
    this.logger.error(`Failed to log outbound message: ${err.message}`);
  }
}

  private mapMessageType(type: string): MessageType {
    const map: Record<string, MessageType> = {
      text: MessageType.TEXT,
      image: MessageType.IMAGE,
      audio: MessageType.VOICE,
      button: MessageType.BUTTON_REPLY,
      interactive: MessageType.BUTTON_REPLY,
    };
    return map[type] ?? MessageType.TEXT;
  }

  private async sendFallback(phone: string, token: string): Promise<void> {
    await this.sendText({
      to: phone,
      message: Templates.fallback().body,
      token,
    });
  }

//  async handleFlowWebhook(payload: any): Promise<string> {
//   try {
//     const privateKey = this.config.get<string>('WHATSAPP_FLOW_PRIVATE_KEY')!;

//     const aesKeyBuffer = crypto.privateDecrypt(
//       {
//         key: privateKey,
//         padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
//         oaepHash: 'sha256',
//       },
//       Buffer.from(payload.encrypted_aes_key, 'base64'),
//     );

//     const ivBuffer = Buffer.from(payload.initial_vector, 'base64');

//     const decrypted = this.flowsService.decryptFlowPayload(
//       payload.encrypted_flow_data,
//       payload.encrypted_aes_key,
//       payload.initial_vector,
//       privateKey,
//     );

//     this.logger.log(`Flow webhook decrypted action: ${decrypted.action}`);

//     if (decrypted.action === 'ping') {
//       return this.flowsService.encryptFlowResponse(
//         { data: { status: 'active' } },
//         aesKeyBuffer,
//         ivBuffer,
//       );
//     }

//     if (decrypted.action === 'data_exchange') {
//       const p = decrypted.data;
//       const summaryTable = this.buildSummaryTable(p);

//       const responseScreen = {
//         screen: 'SCREEN_SUMMARY',
//         data: {
//           service_type:     p.service_type     ?? '',
//           item_list:        p.item_list        ?? '',
//           budget:           p.budget           ?? '',
//           preferred_store:  p.preferred_store  ?? '—',
//           customer_name:    p.customer_name    ?? '',
//           delivery_address: p.delivery_address ?? '',
//           area:             p.area             ?? '',
//           phone_number:     p.phone_number     ?? '',
//           additional_info:  p.additional_info  ?? '—',
//           summary_table:    summaryTable,
//         },
//       };

//       return this.flowsService.encryptFlowResponse(responseScreen, aesKeyBuffer, ivBuffer);
//     }

//     return this.flowsService.encryptFlowResponse(
//       { data: { status: 'ok' } },
//       aesKeyBuffer,
//       ivBuffer,
//     );

//   } catch (err: any) {
//     this.logger.error(`Flow webhook error: ${err.message}`);
//     return JSON.stringify({ data: { status: 'active' } });
//   }
// }

async handleFlowWebhook(payload: any): Promise<string> {
  try {
    const privateKey = this.config.get<string>('WHATSAPP_FLOW_PRIVATE_KEY')!;

    const aesKeyBuffer = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      Buffer.from(payload.encrypted_aes_key, 'base64'),
    );

    const ivBuffer = Buffer.from(payload.initial_vector, 'base64');

    const decrypted = this.flowsService.decryptFlowPayload(
      payload.encrypted_flow_data,
      payload.encrypted_aes_key,
      payload.initial_vector,
      privateKey,
    );

    this.logger.log(`DECRYPTED FULL: ${JSON.stringify(decrypted)}`);

    // ── PING ────────────────────────────────────────────────────────
    if (decrypted.action === 'ping') {
      return this.flowsService.encryptFlowResponse(
        { data: { status: 'active' } },
        aesKeyBuffer,
        ivBuffer,
      );
    }

    if (decrypted.action === 'data_exchange') {
      const screen: string = decrypted.screen;  // which screen sent this
      const p = decrypted.data ?? {};

      this.logger.log(`data_exchange from screen: "${screen}" | service_type: "${p.service_type}"`);

      // ── FROM SCREEN_SERVICE → route to correct detail screen ─────
      if (screen === 'SCREEN_SERVICE') {
        const screenMap: Record<string, string> = {
          GROCERY:  'SCREEN_DETAILS_GROCERY',
          ERRAND:   'SCREEN_DETAILS_ERRAND',
          CLEANING: 'SCREEN_DETAILS_CLEANING',
        };

        const nextScreen = screenMap[p.service_type] ?? 'SCREEN_DETAILS_GROCERY';
        this.logger.log(`Navigating to: ${nextScreen}`);

        return this.flowsService.encryptFlowResponse(
          {
            screen: nextScreen,
            data: {
              service_type:     p.service_type     ?? '',
              customer_name:    p.customer_name    ?? '',
              delivery_address: p.delivery_address ?? '',
              phone_number:     p.phone_number     ?? '',
            },
          },
          aesKeyBuffer,
          ivBuffer,
        );
      }

      // ── FROM DETAIL SCREENS → build summary ──────────────────────
      if (
        screen === 'SCREEN_DETAILS_GROCERY' ||
        screen === 'SCREEN_DETAILS_ERRAND'  ||
        screen === 'SCREEN_DETAILS_CLEANING'
      ) {
        const summaryTable = this.buildSummaryTable(p);

        return this.flowsService.encryptFlowResponse(
          {
            screen: 'SCREEN_SUMMARY',
            data: {
              service_type:     p.service_type     ?? '',
              item_list:        p.item_list        ?? '',
              budget:           p.budget           ?? '',
              preferred_store:  p.preferred_store  ?? '—',
              customer_name:    p.customer_name    ?? '',
              delivery_address: p.delivery_address ?? '',
              area:             p.area             ?? '',
              phone_number:     p.phone_number     ?? '',
              additional_info:  p.additional_info  ?? '—',
              summary_table:    summaryTable,
            },
          },
          aesKeyBuffer,
          ivBuffer,
        );
      }

      this.logger.warn(`Unhandled screen: "${screen}"`);
      return this.flowsService.encryptFlowResponse(
        { data: { status: 'ok' } },
        aesKeyBuffer,
        ivBuffer,
      );
    }

    return this.flowsService.encryptFlowResponse(
      { data: { status: 'ok' } },
      aesKeyBuffer,
      ivBuffer,
    );

  } catch (err: any) {
    this.logger.error(`Flow webhook error: ${err.message}`);
    this.logger.error(err.stack);
    return JSON.stringify({ data: { status: 'active' } });
  }
}

async sendTypingIndicator(
  phone: string,
  messageId: string,
  token: string,
  phoneId: string,
): Promise<void> {
  try {
    await axios.post(
      `https://graph.facebook.com/${this.version}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (err: any) {
    this.logger.warn(`Typing indicator failed: ${err.message}`);
  }
}
private buildSummaryTable(data: any): string {
  const SERVICE_MAP: Record<string, string> = {
    GROCERY: 'Grocery Shopping',
    ERRAND: 'Run an Errand',
    CLEANING: 'Cleaning Service',
  };
  const isCleaning = data.service_type === 'CLEANING';
  const budgetLabel = isCleaning 
    ? `${data.budget ?? '—'} rooms` 
    : `₦${data.budget ?? '—'}`;

  const rows: [string, string][] = [
    ['Service', SERVICE_MAP[data.service_type] ?? data.service_type ?? '—'],
    ['Name', data.customer_name ?? '—'],
    ['Phone', data.phone_number ?? '—'],
    ['Address', data.delivery_address ?? '—'],
    ['Area', AREA_LABELS[data.area] ?? data.area ?? '—'],
    [isCleaning ? 'Rooms' : 'Budget', budgetLabel],
    ['Details', data.item_list ?? '—'],
  ];

  // if (data.service_type === 'GROCERY' && data.preferred_store) {
  //   rows.push(['Store', data.preferred_store]);
  // }
  if (data.preferred_store) {
  const label = data.service_type === 'CLEANING' ? 'Date/Time' : 'Store';
  rows.push([label, data.preferred_store]);
}
  if (data.additional_info) {
    rows.push(['Notes', data.additional_info]);
  }

  const esc = (v: string) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  
  const table = [
    '| Field | Details |',
    '| --- | --- |',
    ...rows.map(([k, v]) => `| ${esc(k)} | ${esc(v)} |`),
  ].join('\n');

  return `## Review your request\n\n${table}\n\n*Your info is safe with us.*`;
}
}
