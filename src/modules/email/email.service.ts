import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

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
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    // ✅ Env vars are ALWAYS strings — ConfigService.get<number>() only
    // casts the TypeScript type, it does NOT convert the runtime value.
    // "465" === 465 is false in JS, which silently broke `secure` before.
    const port = Number(this.config.get<string>('SMTP_PORT', '465'));
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    this.logger.log(
      `[EMAIL] Initializing transporter — host=${this.config.get<string>('SMTP_HOST', 'smtp.gmail.com')}, port=${port}, user=${user}, passLength=${pass?.length ?? 0}`,
    );

    if (!user || !pass) {
      this.logger.error(
        '[EMAIL] SMTP_USER or SMTP_PASS is missing — outgoing email will fail. Check your .env.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST', 'smtp.gmail.com'),
      port,
      secure: port === 465, // true for 465 (implicit TLS), false for 587 (STARTTLS)
      auth: { user, pass },
    } as any);
  }

  // ----------------------------------------------------------------
  // sendPaymentProofAlert
  // Returns true/false so callers (e.g. NotificationsService) know
  // whether the send actually succeeded, instead of assuming success.
  // ----------------------------------------------------------------
  async sendPaymentProofAlert(params: PaymentProofAlertParams): Promise<boolean> {
    const {
      adminEmails,
      orderNumber,
      customerName,
      customerPhone,
      amount,
      serviceType,
      proofUrl,
      businessName,
    } = params;

    if (!adminEmails.length) {
      this.logger.warn(`[EMAIL] No admin emails for order ${orderNumber} — skipping`);
      return false;
    }

    const formattedAmount = `₦${amount.toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

    const subject = `💳 Payment Proof Received — Order ${orderNumber} (${businessName})`;

    const text = [
      `A customer has submitted payment proof.`,
      ``,
      `Order:       ${orderNumber}`,
      `Customer:    ${customerName ?? 'Unknown'}`,
      `Phone:       ${customerPhone}`,
      `Amount:      ${formattedAmount}`,
      `Service:     ${serviceType}`,
      `Business:    ${businessName}`,
      ``,
      `View Receipt Image: ${proofUrl}`,
      ``,
      `Log into your CRM to confirm the payment.`,
      ``,
      `— Cliqex Platform`,
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #222; background: #f5f5f5; margin: 0; padding: 0; }
    .wrapper { max-width: 560px; margin: 32px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #1a8a5e; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; color: #fff; }
    .header p { margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.8); }
    .body { padding: 28px 32px; }
    .body p { margin: 0 0 16px; font-size: 14px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #eee; }
    td:first-child { font-weight: bold; color: #555; width: 110px; }
    .cta { display: inline-block; margin: 4px 0 20px; padding: 10px 20px; background: #1a8a5e; color: #fff !important; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; }
    .footer { background: #f9f9f9; border-top: 1px solid #eee; padding: 16px 32px; font-size: 12px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>💳 Payment Proof Received</h1>
      <p>${businessName}</p>
    </div>
    <div class="body">
      <p>A customer has submitted payment proof for the following order. Please review and confirm in your CRM.</p>
      <table>
        <tr><td>Order</td><td><strong>${orderNumber}</strong></td></tr>
        <tr><td>Customer</td><td>${customerName ?? 'Unknown'}</td></tr>
        <tr><td>Phone</td><td>${customerPhone}</td></tr>
        <tr><td>Amount</td><td><strong>${formattedAmount}</strong></td></tr>
        <tr><td>Service</td><td>${serviceType}</td></tr>
        <tr><td>Business</td><td>${businessName}</td></tr>
      </table>
      <a href="${proofUrl}" class="cta">View Receipt Image →</a>
      <p style="color:#777; font-size:13px;">Log into your CRM to confirm the payment and move this order to PAID.</p>
    </div>
    <div class="footer">— Cliqex Platform</div>
  </div>
</body>
</html>
    `.trim();

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM', 'Cliqex Platform <noreply@cliqex.com>'),
        to: adminEmails.join(', '),
        subject,
        text,
        html,
      });
      this.logger.log(
        `[EMAIL] Payment proof alert sent for order ${orderNumber} → ${adminEmails.join(', ')}`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(`[EMAIL] Failed to send payment proof alert: ${err.message}`);
      return false;
    }
  }

  // ----------------------------------------------------------------
  // sendNewOrderAlert
  // Returns true/false — same reasoning as above.
  // ----------------------------------------------------------------
  async sendNewOrderAlert(params: NewOrderAlertParams): Promise<boolean> {
    const {
      adminEmails,
      orderNumber,
      customerName,
      customerPhone,
      serviceType,
      serviceLabel,
      items,
      areaLabel,
      businessName,
      crmUrl,
    } = params;

    if (!adminEmails.length) return false;

    const displayItems = items.slice(0, 5);
    const remaining = items.length - 5;
    const itemLines = displayItems.map((i) => `• ${i.name} x${i.quantity}`).join('\n');
    const itemsText =
      remaining > 0 ? `${itemLines}\n... and ${remaining} more items` : itemLines;

    const subject = `🛒 New Order — ${orderNumber} (${businessName})`;

    const text = [
      `A new order has been placed and is waiting for a quote.`,
      ``,
      `Order:     ${orderNumber}`,
      `Customer:  ${customerName ?? 'Unknown'}`,
      `Phone:     ${customerPhone}`,
      `Service:   ${serviceLabel ?? serviceType}`,
      ...(areaLabel ? [`Area:      ${areaLabel}`] : []),
      ``,
      `Items:`,
      itemsText,
      ``,
      `Log into your CRM to send a quote.`,
      `${crmUrl}`,
      ``,
      `— Cliqex Platform`,
    ].join('\n');

    const itemsHtml = displayItems
      .map(
        (i) =>
          `<li style="margin:4px 0; font-size:13px;">${i.name} <strong>x${i.quantity}</strong></li>`,
      )
      .join('');
    const remainingHtml =
      remaining > 0
        ? `<li style="margin:4px 0; font-size:13px; color:#888;">...and ${remaining} more items</li>`
        : '';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; color: #222; background: #f5f5f5; margin: 0; padding: 0; }
    .wrapper { max-width: 560px; margin: 32px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #1a8a5e; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; color: #fff; }
    .header p { margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.8); }
    .body { padding: 28px 32px; }
    .body p { margin: 0 0 16px; font-size: 14px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #eee; }
    td:first-child { font-weight: bold; color: #555; width: 110px; }
    ul { margin: 8px 0 20px; padding-left: 20px; }
    .cta { display: inline-block; margin: 4px 0 20px; padding: 10px 20px; background: #1a8a5e; color: #fff !important; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; }
    .footer { background: #f9f9f9; border-top: 1px solid #eee; padding: 16px 32px; font-size: 12px; color: #999; text-align: center; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🛒 New Order Received</h1>
      <p>${businessName}</p>
    </div>
    <div class="body">
      <p>A new order has been placed and is waiting for a quote.</p>
      <table>
        <tr><td>Order</td><td><strong>${orderNumber}</strong></td></tr>
        <tr><td>Customer</td><td>${customerName ?? 'Unknown'}</td></tr>
        <tr><td>Phone</td><td>${customerPhone}</td></tr>
        <tr><td>Service</td><td>${serviceLabel ?? serviceType}</td></tr>
        ${areaLabel ? `<tr><td>Area</td><td>${areaLabel}</td></tr>` : ''}
      </table>
      <p style="margin:0 0 6px; font-size:13px; font-weight:bold; color:#555;">Items:</p>
      <ul>${itemsHtml}${remainingHtml}</ul>
      <a href="${crmUrl}" class="cta">Open CRM →</a>
    </div>
    <div class="footer">— Cliqex Platform</div>
  </div>
</body>
</html>
    `.trim();

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM', 'Cliqex Platform <noreply@cliqex.com>'),
        to: adminEmails.join(', '),
        subject,
        text,
        html,
      });
      this.logger.log(
        `[EMAIL] New order alert sent for ${orderNumber} → ${adminEmails.join(', ')}`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(`[EMAIL] Failed to send new order alert: ${err.message}`);
      return false;
    }
  }
}