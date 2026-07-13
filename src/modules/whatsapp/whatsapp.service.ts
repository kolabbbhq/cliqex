import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { MessageDirection, MessageType } from '@prisma/client';
import { WhatsappRepository } from './whatsapp.repository';
import { CustomersService } from '@modules/customers/customers.service';
import { OrdersService } from '@modules/orders/orders.service';
import { FlowsService } from './flows/flows.service';
import { BusinessService } from '@modules/business/business.service';
import { TenantContext } from '@common/tenant/tenant-context.service';
import { Templates } from './templates/messages.template';
import { UploadService } from '@modules/upload/upload.service';
import { EmailService } from '@modules/email/email.service';
import { FlowServiceDef, FlowAreaDef } from './flows/flow-config.types';
import { PrismaService } from '@common/prisma/prisma.service';
import { ReviewsService } from '@modules/reviews/reviews.service';
import { BusinessHoursService } from '@modules/business/business-hours.service';
import { PaymentsService } from '@modules/payments/payments.service';

import {
  ParsedInboundMessage,
  SendTextPayload,
  SendButtonsPayload,
  SendDocumentPayload,
  SendFlowPayload,
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  FlowSubmissionPayload,
  SendTemplatePayload,
} from './whatsapp.types';

import * as crypto from 'crypto';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly version: string;

  constructor(
    private readonly whatsappRepository: WhatsappRepository,
    private readonly customersService: CustomersService,
    private readonly ordersService: OrdersService,
    private readonly flowsService: FlowsService,
    private readonly businessService: BusinessService,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
    private readonly uploadService: UploadService,
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
     private readonly reviewsService: ReviewsService,
     private readonly businessHoursService: BusinessHoursService,
          private readonly paymentsService: PaymentsService,



  ) {
    this.version = this.config.get('WHATSAPP_API_VERSION', 'v19.0');
  }

  // ----------------------------------------------------------------
  // verifyWebhook
  // ----------------------------------------------------------------
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const platformToken = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === platformToken) {
      this.logger.log('WhatsApp webhook verified ✅');
      return challenge;
    }
    return null;
  }

  // ----------------------------------------------------------------
  // handleWebhook — MAIN ENTRY POINT
  // ----------------------------------------------------------------
  async handleWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
    const changes = payload.entry?.flatMap((e) => e.changes) ?? [];

    for (const change of changes) {
      const value = change.value;
      const phoneId = value.metadata?.phone_number_id;

      const business = await this.businessService.resolveByPhoneId(phoneId);

      if (!business) {
        this.logger.warn(`No business found for phoneId: ${phoneId} — ignoring`);
        continue;
      }

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
          business.whatsappToken!,
          business.id,
        );
      }
    }
  }

  async sendManualImageReply(orderId: string, imageUrl: string, caption?: string): Promise<void> {
  const order = await this.ordersService.findOne(orderId);
  const business = await this.businessService.getById(order.businessId);
  const phoneId = business.whatsappPhoneId!;
  const token = business.whatsappToken!;

  const apiUrl = `https://graph.facebook.com/${this.version}/${phoneId}/messages`;

  const result = await axios.post(
    apiUrl,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: order.customer.phone,
      type: 'image',
      image: {
        link: imageUrl,
        ...(caption && { caption }),
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );

  const waMessageId = result.data?.messages?.[0]?.id;

  await this.whatsappRepository.saveMessage({
    waMessageId: waMessageId ?? `out-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    customerId: order.customerId,
    orderId,
    direction: MessageDirection.OUTBOUND,
    type: MessageType.IMAGE,
    content: caption ?? undefined,
    mediaUrl: imageUrl,
  });

  await this.ordersService.setAutoAck(orderId, false);
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

    const business = await this.businessService.getById(businessId);
    if (business.whatsappPhoneId) {
      await this.sendTypingIndicator(parsed.phone, raw.id, token, business.whatsappPhoneId);
    }

    const activeOrder = await this.ordersService.findLatestActive(customer.id);

    // Resolve media URL (image / audio) from Meta CDN → Cloudinary
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

    // ✅ Pass mediaUrl through to routeMessage
     await this.routeMessage(
      parsed,
      customer.id,
      token,
      businessId,
      activeOrder?.id,
      customer,
      mediaUrl,
      isNew,
    );
  }
  // ----------------------------------------------------------------
  // routeMessage
  // ----------------------------------------------------------------
 private async routeMessage(
    msg: ParsedInboundMessage,
    customerId: string,
    token: string,
    businessId: string,
    activeOrderId?: string,
    customer?: any,
    mediaUrl?: string,
    isNew?: boolean,    
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
    if (payload === 'PAY_PAYSTACK' && activeOrderId) {
      return this.handlePayPaystack(phone, activeOrderId, token);
    }
if (payload?.startsWith('RATING_')) {
  const deliveredOrder = await this.findLastDeliveredOrder(customer.id);
  if (deliveredOrder) {
    return this.handleRating(
      phone,
      deliveredOrder.id,
      payload,
      token,
      customer.id,
      deliveredOrder.businessId,  // ← add this
    );
  }
}
if (msg.type === 'text' && msg.text) {
  const pendingReview = await this.reviewsService.findAwaitingComment(
    customerId,
    businessId,   // ← pass businessId
  );
  if (pendingReview) {
    return this.handleReviewComment(phone, msg.text, pendingReview.id, token);
  }
}
    // ✅ Task 10 — detect payment proof image BEFORE the generic image/audio handler
    if (msg.type === 'image' && activeOrderId && mediaUrl) {
      const order = await this.ordersService.findOne(activeOrderId);
      if (order.status === 'AWAITING_PAYMENT') {
        return this.handlePaymentProofReceived(
          phone,
          activeOrderId,
          mediaUrl,
          token,
          businessId,
        );
      }
    }

       if (msg.type === 'text' || msg.type === 'image' || msg.type === 'audio') {
      if (activeOrderId) {
        return this.sendAutoAckIfNeeded(phone, activeOrderId, token);
      }
      return this.sendGreeting(phone, businessId, token, customer, isNew);
    }

    await this.sendFallback(phone, token);
  }
  private async handlePayPaystack(phone: string, orderId: string, token: string): Promise<void> {
    try {
      const { authorizationUrl, orderNumber, amount, phoneId } =
        await this.buildPaystackLinkInfo(orderId);

      await this.sendPaystackCta({
        to: phone,
        orderNumber,
        amount,
        url: authorizationUrl,
        token,
        phoneId,
      });
    } catch (err: any) {
      this.logger.error(`handlePayPaystack failed for order ${orderId}: ${err.message}`);
      await this.sendText({
        to: phone,
        message:
          `Sorry, we couldn't generate a payment link right now. ` +
          `Please try bank transfer instead or try again shortly.`,
        token,
      });
    }
  }


 private async buildPaystackLinkInfo(orderId: string) {
    const result = await this.paymentsService.initiatePaystack(orderId);
    const order = await this.ordersService.findOne(orderId);
    const business = await this.businessService.getById(order.businessId);
    return {
      authorizationUrl: result.authorizationUrl,
      orderNumber: order.orderNumber,
      amount: Number(order.total),
      phoneId: business.whatsappPhoneId!,
    };
  }

  private async sendPaystackCta(params: {
    to: string;
    orderNumber: string;
    amount: number;
    url: string;
    token: string;
    phoneId: string;
  }): Promise<void> {
    const apiUrl = `https://graph.facebook.com/${this.version}/${params.phoneId}/messages`;

    await axios.post(
      apiUrl,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: {
            text:
              `Tap below to pay *₦${params.amount.toLocaleString()}* for order *${params.orderNumber}* 👇\n\n` +
              `Choose card, bank transfer, or USSD on the next screen. Link expires in 24 hours. ` +
              `Your receipt arrives automatically once paid.`,
          },
          footer: { text: 'Powered by Cliqex' },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: 'Pay Now',
              url: params.url,
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    await this.logOutbound(params.to, undefined, `[paystack cta:${params.orderNumber}]`);
  }

  // ----------------------------------------------------------------
  // handlePaymentProofReceived (Task 10)
  //
  // Triggered when a customer sends an image while their order is
  // in AWAITING_PAYMENT. Saves/updates the payment proof, auto-replies
  // to the customer, and emails all active admins.
  // ----------------------------------------------------------------
  private async handlePaymentProofReceived(
  phone: string,
  orderId: string,
  mediaUrl: string,
  token: string,
  businessId: string,
): Promise<void> {
  this.logger.log(`[PAYMENT_PROOF] Received from ${phone} for order ${orderId}`);

  try {
    const order = await this.ordersService.findOne(orderId);

    const existing = await this.prisma.payment.findFirst({ where: { orderId } });

    if (existing) {
      await this.prisma.payment.update({
        where: { id: existing.id },
        data: { proofUrl: mediaUrl },
      });
      this.logger.log(`[PAYMENT_PROOF] Updated proofUrl on payment ${existing.id}`);
    } else {
      await this.prisma.payment.create({
        data: {
          businessId,
          orderId,
          customerId: order.customerId,
          method: 'BANK_TRANSFER',
          status: 'PENDING',
          amount: order.total,
          proofUrl: mediaUrl,
        },
      });
      this.logger.log(`[PAYMENT_PROOF] Created new PENDING payment for order ${orderId}`);
    }

    // ── Auto-reply to customer ─────────────────────────────────
    const proofTemplate = Templates.paymentProofReceived();
    await this.sendText({ to: phone, message: proofTemplate.body, token });

    // ── Email all active admins ────────────────────────────────
    const admins = await this.prisma.admin.findMany({
      where: { businessId, isActive: true },
      select: { email: true },
    });
    const adminEmails = admins.map((a) => a.email);

    if (!adminEmails.length) {
      this.logger.warn(
        `[PAYMENT_PROOF] No active admins with email for business ${businessId} — skipping alert`,
      );
      return;
    }

    const business = await this.businessService.getById(businessId);

    // ✅ Number(order.total) — order.total is a Prisma Decimal, not a
    // plain number. Passing it straight through silently breaks
    // amount.toLocaleString() inside EmailService.
    const sent = await this.emailService.sendPaymentProofAlert({
      adminEmails,
      orderNumber: order.orderNumber,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      amount: Number(order.total),
      serviceType: (order.flowData as any)?.serviceLabel ?? order.serviceType,
      proofUrl: mediaUrl,
      businessName: business.name,
    });

    if (sent) {
      this.logger.log(`[PAYMENT_PROOF] Admin alert email sent for order ${order.orderNumber}`);
    } else {
      this.logger.warn(
        `[PAYMENT_PROOF] Admin alert email FAILED for order ${order.orderNumber} — see EmailService logs above`,
      );
    }
  } catch (err: any) {
    this.logger.error(`[PAYMENT_PROOF] Handler failed: ${err.message}`);
  }
}

async getThreadByCustomer(customerId: string) {
  return this.whatsappRepository.getThreadByCustomer(customerId);
}

async sendGreeting(
  phone: string,
  businessId: string,
  token: string,
  customer?: any,
  isNew?: boolean,     // ← added
): Promise<void> {
  const [business, config] = await Promise.all([
    this.businessService.getById(businessId),
    this.businessService.getServiceConfig(businessId),
  ]);

  // ── Operating hours check ────────────────────────────────────
  if (business.operatingHours) {
    const isOpen = this.businessHoursService.isOpen(
      business.operatingHours,
      business.timezone,
    );

    if (!isOpen) {
      const nextOpen = this.businessHoursService.nextOpeningTime(
        business.operatingHours,
        business.timezone,
      );
     this.logger.log(`Business ${businessId} is closed. Next open: ${nextOpen}`);
      await this.sendText({
        to: phone,
        message: Templates.closedMessage(
          nextOpen,
          (business.messageTemplates as any)?.closedMessage,
        ).body,
        token,
      });
      return;
    }
  } else {
    this.logger.warn(
      `Business ${businessId} has no operatingHours configured — treating as always open`,
    );
  }

  // ── Custom greeting for first-time customers ─────────────────
  const greetingOverride = (business.messageTemplates as any)?.greeting;
  if (isNew && greetingOverride) {
    await this.sendText({
      to: phone,
      message: Templates.customGreeting(customer?.name ?? 'there', greetingOverride).body,
      token,
    });
  }

  // ── Web menu greeting (cta_url button) ──────────────────────
  if (business.menuEnabled) {
    const menuUrl =
      business.menuUrl ??
      `${this.config.get('PUBLIC_WEB_URL')}/menu/${business.slug}?phone=${encodeURIComponent(phone)}`;

    const cta = Templates.menuGreetingCta({
      businessName: business.name,
      welcomeText: config?.welcomeText ?? undefined,
      menuUrl,
    });

    const phoneId = business.whatsappPhoneId!;
    const apiUrl = `https://graph.facebook.com/${this.version}/${phoneId}/messages`;

    try {
      await axios.post(
        apiUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'interactive',
          interactive: {
            type: 'cta_url',
            body: { text: cta.body },
            footer: { text: cta.footer },
            action: {
              name: 'cta_url',
              parameters: {
                display_text: cta.buttonText,
                url: cta.url,
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
      this.logger.log(`Sent menu cta_url greeting to ${phone} for business ${businessId}`);
    } catch (err: any) {
      const detail = err.response?.data ?? err.message;
      this.logger.error(`cta_url greeting failed for ${phone}: ${JSON.stringify(detail)}`);
      // Fallback to plain text so the customer still gets something
      const fallback = Templates.menuGreeting({
        businessName: business.name,
        welcomeText: config?.welcomeText ?? undefined,
        menuUrl,
      });
      await this.sendText({ to: phone, message: fallback.body, token });
    }
    return;
  }

  // ── WhatsApp Flow greeting ───────────────────────────────────
  let flowId: string | null = null;
  try {
    flowId = await this.flowsService.getFlowIdForBusiness(businessId);
  } catch (err: any) {
    this.logger.warn(`getFlowIdForBusiness failed for ${businessId}: ${err.message}`);
  }

  if (!flowId) {
    this.logger.warn(`No flowId for business ${businessId} — sending plain text fallback`);
    await this.sendText({
      to: phone,
      message: Templates.flowNotReady().body,
      token,
    });
    return;
  }

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
    prefill: {
      customer_name: customer?.name ?? '',
      delivery_address: customer?.address ?? '',
      phone_number: phone,
    }, 
  });

  this.logger.log(`Sent flow ${flowId} to ${phone}`);
}
  // ----------------------------------------------------------------
  // handleFlowSubmission
  // ----------------------------------------------------------------
  private async handleFlowSubmission(
    phone: string,
    customerId: string,
    flowData: FlowSubmissionPayload,
    token: string,
  ): Promise<void> {
    this.logger.log(
      `Flow submitted by ${phone} — ${flowData.service_label ?? flowData.service_type}`,
    );

    const businessId = this.tenantContext.get();
    const [serviceConfig, business] = await Promise.all([
      this.businessService.getServiceConfig(businessId),
      this.businessService.getById(businessId),
    ]);
    const services = (serviceConfig?.services as unknown as FlowServiceDef[]) ?? [];
    const areas = (serviceConfig?.areas as unknown as FlowAreaDef[]) ?? [];

    const service = services.find((s) => s.id === flowData.service_type);
    const area = areas.find((a) => a.id === flowData.area);
    const areaLabel = area?.label ?? flowData.area;
const skipDeliveryFee = service?.chargeRules?.applyDeliveryFee === false;
const areaFee = skipDeliveryFee ? 0 : (area?.deliveryFee ?? 0);
    const isLogistics = flowData.service_type === 'LOGISTICS';
    const deliveryAddress = isLogistics
      ? (flowData as any).pickup_address ?? flowData.delivery_address
      : flowData.delivery_address;

    await this.customersService.update(customerId, {
      name: flowData.customer_name,
      ...(!isLogistics && { address: flowData.delivery_address }),
    });

    const order = await this.ordersService.create({
      customerId,
      serviceType: flowData.service_type ?? service?.id ?? 'UNKNOWN',
      sourceType: 'TEXT',
      rawText: (flowData as any).item_description ?? flowData.item_list,
      deliveryAddress,
      deliveryFee: areaFee,
      flowData: {
        serviceLabel: flowData.service_label ?? service?.label,
        itemList: (flowData as any).item_description ?? flowData.item_list,
        budget: flowData.budget !== undefined ? Number(flowData.budget) : undefined,
        preferredStore: flowData.preferred_store,
        area: flowData.area,
        areaLabel,
        additionalInfo: flowData.additional_info,
        phoneNumber: flowData.phone_number,
        ...(isLogistics && {
          pickupAddress: (flowData as any).pickup_address,
          dropoffAddress: (flowData as any).dropoff_address,
        }),
      },
    });

    const items = this.extractOrderItems(service ?? null, flowData);
    await this.ordersService.addItems(order.id, items);

    const template = Templates.flowOrderReceived(
      order.orderNumber,
      undefined,
      (business.messageTemplates as any)?.orderReceived,
    );
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
  private async findLastDeliveredOrder(customerId: string) {
  return this.prisma.order.findFirst({
    where: {
      customerId,
      status: 'DELIVERED',
    },
    orderBy: { updatedAt: 'desc' },
  });
}

  // ----------------------------------------------------------------
  // handlePayTransfer
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
    customerId: string,
    businessId: string,
  ): Promise<void> {
    const ratingMap: Record<string, number> = { RATING_5: 5, RATING_3: 3, RATING_1: 1 };
    const rating = ratingMap[payload] ?? 3;
    this.tenantContext.set(businessId, false);

    const order = await this.ordersService.findOne(orderId);

    await this.reviewsService.upsert({
      orderId,
      customerId,
      buddyId: order.buddyId ?? undefined,
      rating,
      businessId,
    });

    const template = Templates.ratingFollowUp(rating);
    await this.sendText({ to: phone, message: template.body, token });
  }


private async handleReviewComment(
    phone: string,
    text: string,
    reviewId: string,
    token: string,
  ): Promise<void> {
    const isSkip = text.trim().toUpperCase() === 'SKIP';

    if (isSkip) {
      await this.reviewsService.closeAwaitingComment(reviewId);
      await this.sendText({
        to: phone,
        message: `No problem! Thank you for your order 🙏\n\nSee you next time! 😊`,
        token,
      });
      return;
    }

    await this.reviewsService.saveComment(reviewId, text.trim());
    const feedbackTemplate = Templates.feedbackReceived();
    await this.sendText({ to: phone, message: feedbackTemplate.body, token });
  }

  // ================================================================
  // OUTBOUND SENDERS
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

  // ----------------------------------------------------------------
  // sendDocument — sends a PDF (or other file) via WhatsApp
  //
  // Requires a publicly accessible URL (e.g. from Cloudinary).
  // Uses the business's own whatsappToken and phoneId.
  // ----------------------------------------------------------------
  async sendDocument(params: SendDocumentPayload): Promise<void> {
    const apiUrl = `https://graph.facebook.com/${this.version}/${params.phoneId}/messages`;

    try {
      const result = await axios.post(
        apiUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.to,
          type: 'document',
          document: {
            link: params.documentUrl,
            filename: params.filename,
            ...(params.caption && { caption: params.caption }),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${params.token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      await this.logOutbound(
        params.to,
        result.data?.messages?.[0]?.id,
        `[document:${params.filename}]`,
      );

      this.logger.log(`Document sent to ${params.to}: ${params.filename}`);
    } catch (error: any) {
      const detail = error.response?.data ?? error.message;
      this.logger.error(`sendDocument failed for ${params.to}: ${JSON.stringify(detail)}`);
      throw error;
    }
  }

  async sendTemplate(params: SendTemplatePayload): Promise<void> {
    const apiUrl = `https://graph.facebook.com/${this.version}/${params.phoneId}/messages`;

    try {
      const result = await axios.post(
        apiUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.to,
          type: 'template',
          template: {
            name: params.templateName,
            language: { code: params.languageCode },
            ...(params.components?.length && { components: params.components }),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${params.token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      await this.logOutbound(
        params.to,
        result.data?.messages?.[0]?.id,
        `[template:${params.templateName}]`,
      );
    } catch (error: any) {
      const detail = error.response?.data ?? error.message;
      this.logger.error(`sendTemplate failed for ${params.to}: ${JSON.stringify(detail)}`);
      throw error;
    }
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

  async sendFlow(
    params: SendFlowPayload & {
      token?: string;
      phoneId?: string;
      prefill?: Record<string, any>;
    },
  ): Promise<void> {
    const token = params.token ?? this.config.get<string>('WHATSAPP_ACCESS_TOKEN')!;
    const phoneId =
      params.phoneId ?? this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')!;
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
                data: params.prefill ?? {},
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

  private async sendAutoAckIfNeeded(
    phone: string,
    orderId: string,
    token: string,
  ): Promise<void> {
    const order = await this.ordersService.findOne(orderId);
    if (order.autoAckSent) return;

    await this.sendText({
      to: phone,
      message: `Thanks for reaching out to Errandsbuddy! 😊We've received your request and our team is already on it. We'll get back to you as soon as possible.`,
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

    await this.ordersService.setAutoAck(orderId, false);
  }

  async getOrderThread(orderId: string) {
    return this.whatsappRepository.getOrderThread(orderId);
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

  async handleFlowWebhook(payload: any, businessId: string): Promise<string> {
    this.logger.log(`📩 Flow webhook HIT for business ${businessId}`);

    let aesKeyBuffer: Buffer | undefined;
    let ivBuffer: Buffer | undefined;

    try {
      this.tenantContext.set(businessId, false);

      const business = await this.businessService.getById(businessId);
      const privateKey =
        business.flowPrivateKey ?? this.config.get<string>('WHATSAPP_FLOW_PRIVATE_KEY');
      if (!privateKey) throw new Error(`No flowPrivateKey for business ${businessId}`);

      aesKeyBuffer = crypto.privateDecrypt(
        {
          key: privateKey,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(payload.encrypted_aes_key, 'base64'),
      );
      ivBuffer = Buffer.from(payload.initial_vector, 'base64');

      const decrypted = this.flowsService.decryptFlowPayload(
        payload.encrypted_flow_data,
        payload.encrypted_aes_key,
        payload.initial_vector,
        privateKey,
      );

      if (decrypted.action === 'ping') {
        return this.flowsService.encryptFlowResponse(
          { data: { status: 'active' } },
          aesKeyBuffer,
          ivBuffer,
        );
      }

      if (decrypted.action === 'data_exchange') {
        const screen: string = decrypted.screen;
        const p = decrypted.data ?? {};

        const serviceConfig = await this.businessService.getServiceConfig(businessId);
        const services = (serviceConfig?.services as unknown as FlowServiceDef[]) ?? [];
        const areas = (serviceConfig?.areas as unknown as FlowAreaDef[]) ?? [];

        if (screen === 'SCREEN_SERVICE') {
          const service = services.find((s) => s.id === p.service_type && s.active !== false);
          if (!service) {
            this.logger.warn(
              `Unknown service_type "${p.service_type}" for business ${businessId}`,
            );
            return this.flowsService.encryptFlowResponse(
              { data: { status: 'ok' } },
              aesKeyBuffer,
              ivBuffer,
            );
          }

          return this.flowsService.encryptFlowResponse(
            {
              screen: `SCREEN_DETAILS_${service.id}`,
              data: {
                service_type: p.service_type ?? '',
                customer_name: p.customer_name ?? '',
                delivery_address: p.delivery_address ?? '',
                phone_number: p.phone_number ?? '',
              },
            },
            aesKeyBuffer,
            ivBuffer,
          );
        }

        if (typeof screen === 'string' && screen.startsWith('SCREEN_DETAILS_')) {
          const summaryTable = this.buildSummaryTable(p, { services, areas });
          const responseData: Record<string, any> = { summary_table: summaryTable };
          for (const [key, value] of Object.entries(p)) responseData[key] = value ?? '';

          return this.flowsService.encryptFlowResponse(
            { screen: 'SCREEN_SUMMARY', data: responseData },
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
      if (aesKeyBuffer && ivBuffer) {
        return this.flowsService.encryptFlowResponse(
          { data: { status: 'active' } },
          aesKeyBuffer,
          ivBuffer,
        );
      }
      return JSON.stringify({ data: { status: 'active' } });
    }
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
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data ?? error.message;
      this.logger.error(`Meta API error: ${JSON.stringify(detail)}`);
      throw error;
    }
  }

  private parseMessage(
    raw: WhatsAppMessage,
    contactName: string | null,
  ): ParsedInboundMessage {
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
        waMessageId:
          waMessageId ??
          `out-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  private parseItemizedField(
    fieldText: string,
  ): { name: string; nameLower: string; quantity: string }[] {
    return fieldText
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

  private extractOrderItems(
    service: FlowServiceDef | null,
    flowData: FlowSubmissionPayload,
  ): { name: string; nameLower: string; quantity: string }[] {
    if (!service) {
      const fallback = flowData.item_list?.trim();
      if (fallback)
        return [{ name: fallback, nameLower: fallback.toLowerCase(), quantity: '1' }];
      return [{ name: 'Order item', nameLower: 'order item', quantity: '1' }];
    }

    const primaryTextarea = service.fields?.find(
      (f) => f.type === 'textarea' && f.required === true,
    );

    if (primaryTextarea) {
      const value = (flowData as any)[primaryTextarea.name];
      if (value && typeof value === 'string') {
        if (service.itemized) return this.parseItemizedField(value);
        const name = value.trim();
        return [{ name, nameLower: name.toLowerCase(), quantity: '1' }];
      }
    }

    const primaryChoice = service.fields?.find(
      (f) => (f.type === 'radio' || f.type === 'dropdown') && f.required === true,
    );

    if (primaryChoice) {
      const selectedId = (flowData as any)[primaryChoice.name];
      if (selectedId) {
        const optionTitle =
          primaryChoice.options?.find((o) => o.id === selectedId)?.title ?? selectedId;
        const name = optionTitle.trim();
        return [{ name, nameLower: name.toLowerCase(), quantity: '1' }];
      }
    }

    const label = service.label ?? service.id ?? 'Order';
    return [{ name: label, nameLower: label.toLowerCase(), quantity: '1' }];
  }

  private buildSummaryTable(
    data: any,
    context: { services: FlowServiceDef[]; areas: FlowAreaDef[] },
  ): string {
    const service = context.services.find((s) => s.id === data.service_type);
    const areaLabel =
      context.areas.find((a) => a.id === data.area)?.label ?? data.area;
    const isLogistics = data.service_type === 'LOGISTICS';

    const rows: [string, string][] = [
      ['Service', service?.label ?? data.service_type ?? '—'],
      ['Name', data.customer_name ?? '—'],
      ['Phone', data.phone_number ?? '—'],
    ];

    if (isLogistics) {
      rows.push(['Pickup', data.pickup_address ?? '—']);
      rows.push(['Drop-off', data.dropoff_address ?? '—']);
    } else {
      rows.push(['Address', data.delivery_address ?? '—']);
    }

    if (context.areas.length && data.area) {
      rows.push(['Area', areaLabel ?? '—']);
    }

    for (const field of service?.fields ?? []) {
      const value = data[field.name];
      if (value === undefined || value === null || value === '') continue;
      if (['pickup_address', 'dropoff_address'].includes(field.name)) continue;
      const display = field.options?.find((o) => o.id === value)?.title ?? value;
      rows.push([field.label, display]);
    }

    if (data.additional_info) rows.push(['Notes', data.additional_info]);

    const esc = (v: string) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const table = [
      '| Field | Details |',
      '| --- | --- |',
      ...rows.map(([k, v]) => `| ${esc(k)} | ${esc(v)} |`),
    ].join('\n');

    return `## Review your request\n\n${table}\n\n*Your info is safe with us.*`;
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
}