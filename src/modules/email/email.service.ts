import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface PaymentProofAlertParams {
  adminEmails: string[];
  orderNumber: string;
  customerName: string | null;
  customerPhone: string;
  amount: number;
  serviceType: string;
  proofUrl: string;
  businessName: string;
}

export interface NewOrderAlertParams {
  adminEmails: string[];
  orderNumber: string;
  customerName: string | null;
  customerPhone: string;
  serviceType: string;
  serviceLabel: string | null;
  items: { name: string; quantity: string }[];
  areaLabel: string | null;
  businessName: string;
  crmUrl: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromAddress = this.config.get<string>(
      'EMAIL_FROM',
      'Cliqex Platform <notifications@cliqex.com>', // must be a verified domain in Resend
    );

    if (!apiKey) {
      this.logger.error(
        '[EMAIL] RESEND_API_KEY is missing — outgoing email will fail. Check your .env.',
      );
    }

    this.resend = new Resend(apiKey);
  }

  async sendPaymentProofAlert(params: PaymentProofAlertParams): Promise<boolean> {
    const {
      adminEmails, orderNumber, customerName, customerPhone,
      amount, serviceType, proofUrl, businessName,
    } = params;

    if (!adminEmails.length) {
      this.logger.warn(`[EMAIL] No admin emails for order ${orderNumber} — skipping`);
      return false;
    }

    const formattedAmount = `₦${amount.toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="background:#1a8a5e; padding:24px 32px;">
          <h1 style="margin:0; font-size:20px; color:#fff;">💳 Payment Proof Received</h1>
          <p style="margin:4px 0 0; font-size:13px; color:rgba(255,255,255,0.8);">${businessName}</p>
        </div>
        <div style="padding:28px 32px;">
          <p>A customer has submitted payment proof. Please review and confirm in your CRM.</p>
          <table style="width:100%; border-collapse:collapse; margin:20px 0;">
            <tr><td style="padding:10px 12px; font-weight:bold; width:110px;">Order</td><td style="padding:10px 12px;"><strong>${orderNumber}</strong></td></tr>
            <tr><td style="padding:10px 12px; font-weight:bold;">Customer</td><td style="padding:10px 12px;">${customerName ?? 'Unknown'}</td></tr>
            <tr><td style="padding:10px 12px; font-weight:bold;">Phone</td><td style="padding:10px 12px;">${customerPhone}</td></tr>
            <tr><td style="padding:10px 12px; font-weight:bold;">Amount</td><td style="padding:10px 12px;"><strong>${formattedAmount}</strong></td></tr>
            <tr><td style="padding:10px 12px; font-weight:bold;">Service</td><td style="padding:10px 12px;">${serviceType}</td></tr>
          </table>
          <a href="${proofUrl}" style="display:inline-block; padding:10px 20px; background:#1a8a5e; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold;">View Receipt Image →</a>
        </div>
      </div>
    `;

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: adminEmails,
        subject: `💳 Payment Proof Received — Order ${orderNumber} (${businessName})`,
        html,
      });

      if (error) {
        this.logger.error(`[EMAIL] Resend error for order ${orderNumber}: ${JSON.stringify(error)}`);
        return false;
      }

      this.logger.log(`[EMAIL] Payment proof alert sent for order ${orderNumber} → ${adminEmails.join(', ')}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[EMAIL] Failed to send payment proof alert: ${err.message}`);
      return false;
    }
  }

  async sendNewOrderAlert(params: NewOrderAlertParams): Promise<boolean> {
    const {
      adminEmails, orderNumber, customerName, customerPhone,
      serviceType, serviceLabel, items, areaLabel, businessName, crmUrl,
    } = params;

    if (!adminEmails.length) {
      this.logger.warn(`[EMAIL] No admin emails for order ${orderNumber} — skipping`);
      return false;
    }

    const displayItems = items.slice(0, 5);
    const remaining = items.length - 5;
    const itemsHtml = displayItems
      .map((i) => `<li style="margin:4px 0; font-size:13px;">${i.name} <strong>x${i.quantity}</strong></li>`)
      .join('');
    const remainingHtml = remaining > 0
      ? `<li style="margin:4px 0; font-size:13px; color:#888;">...and ${remaining} more items</li>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="background:#1a8a5e; padding:24px 32px;">
          <h1 style="margin:0; font-size:20px; color:#fff;">🛒 New Order Received</h1>
          <p style="margin:4px 0 0; font-size:13px; color:rgba(255,255,255,0.8);">${businessName}</p>
        </div>
        <div style="padding:28px 32px;">
          <p>A new order has been placed and is waiting for a quote.</p>
          <table style="width:100%; border-collapse:collapse; margin:20px 0;">
            <tr><td style="padding:10px 12px; font-weight:bold; width:110px;">Order</td><td style="padding:10px 12px;"><strong>${orderNumber}</strong></td></tr>
            <tr><td style="padding:10px 12px; font-weight:bold;">Customer</td><td style="padding:10px 12px;">${customerName ?? 'Unknown'}</td></tr>
            <tr><td style="padding:10px 12px; font-weight:bold;">Phone</td><td style="padding:10px 12px;">${customerPhone}</td></tr>
            <tr><td style="padding:10px 12px; font-weight:bold;">Service</td><td style="padding:10px 12px;">${serviceLabel ?? serviceType}</td></tr>
            ${areaLabel ? `<tr><td style="padding:10px 12px; font-weight:bold;">Area</td><td style="padding:10px 12px;">${areaLabel}</td></tr>` : ''}
          </table>
          <p style="margin:0 0 6px; font-size:13px; font-weight:bold;">Items:</p>
          <ul style="margin:8px 0 20px; padding-left:20px;">${itemsHtml}${remainingHtml}</ul>
          <a href="${crmUrl}" style="display:inline-block; padding:10px 20px; background:#1a8a5e; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold;">Open CRM →</a>
        </div>
      </div>
    `;

    try {
      const { error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: adminEmails,
        subject: `🛒 New Order — ${orderNumber} (${businessName})`,
        html,
      });

      if (error) {
        this.logger.error(`[EMAIL] Resend error for order ${orderNumber}: ${JSON.stringify(error)}`);
        return false;
      }

      this.logger.log(`[EMAIL] New order alert sent for ${orderNumber} → ${adminEmails.join(', ')}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[EMAIL] Failed to send new order alert: ${err.message}`);
      return false;
    }
  }
}