import { Injectable, Logger } from '@nestjs/common';
import { OrderWithItems } from '@modules/orders/orders.types';
import { Business, Payment } from '@prisma/client';

const PDFDocument = require('pdfkit');

// ----------------------------------------------------------------
// PdfService
//
// Generates professional PDFs entirely in memory (Buffer).
// Never writes to disk — caller uploads the buffer to Cloudinary.
//
// generateReceipt()       — post-payment receipt (PAID badge)
// generateQuoteInvoice()  — pre-payment quote (AWAITING CONFIRMATION badge)
//
// compress: false is intentional — increases file size from ~3KB to
// ~80-150KB which gives WhatsApp enough pixel data to generate a
// thumbnail preview for the PDF in the chat.
// ----------------------------------------------------------------

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  private currency(business: Business): string {
    return (business as any).currencySymbol ?? '₦';
  }

  private fmt(amount: number, business: Business): string {
    return `${this.currency(business)}${amount.toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // ----------------------------------------------------------------
  // fetchLogoBuffer — safely fetches logo image as Buffer
  // Returns null if logoUrl is empty or fetch fails
  // ----------------------------------------------------------------
  private async fetchLogoBuffer(logoUrl: string | null | undefined): Promise<Buffer | null> {
    if (!logoUrl) return null;
    try {
      const res = await fetch(logoUrl);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------
  // generateReceipt — POST-PAYMENT
  // ----------------------------------------------------------------
  async generateReceipt(params: {
    order: OrderWithItems;
    business: Business;
    payment: Payment;
  }): Promise<Buffer> {
    const { order, business, payment } = params;
    const logoBuffer = await this.fetchLogoBuffer(business.logoUrl);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        compress: false, // keeps file large enough for WhatsApp thumbnail
        info: {
          Title: `Receipt ${order.orderNumber}`,
          Author: business.name,
        },
      });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.renderDocument(doc, order, business, logoBuffer, { mode: 'receipt', payment });

      doc.end();
    });
  }

  // ----------------------------------------------------------------
  // generateQuoteInvoice — PRE-PAYMENT
  // ----------------------------------------------------------------
  async generateQuoteInvoice(params: {
    order: OrderWithItems;
    business: Business;
  }): Promise<Buffer> {
    const { order, business } = params;
    const logoBuffer = await this.fetchLogoBuffer(business.logoUrl);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        compress: false, // keeps file large enough for WhatsApp thumbnail
        info: {
          Title: `Quote ${order.orderNumber}`,
          Author: business.name,
        },
      });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.renderDocument(doc, order, business, logoBuffer, { mode: 'quote' });

      doc.end();
    });
  }

  // ----------------------------------------------------------------
  // renderDocument — shared synchronous renderer
  // logoBuffer is pre-fetched before the Promise so we can embed it
  // synchronously inside the pdfkit streaming pipeline
  // ----------------------------------------------------------------
  private renderDocument(
    doc: any,
    order: OrderWithItems,
    business: Business,
    logoBuffer: Buffer | null,
    opts: { mode: 'receipt'; payment: Payment } | { mode: 'quote' },
  ): void {
    const PAGE_WIDTH = doc.page.width;
    const LEFT = doc.page.margins.left;
    const RIGHT = PAGE_WIDTH - doc.page.margins.right;
    const CONTENT_WIDTH = RIGHT - LEFT;

    const isQuote = opts.mode === 'quote';
    const PRIMARY = (business as any).primaryColor ?? '#1a8a5e';

    // ── HEADER BAR ─────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_WIDTH, 8).fill(PRIMARY);

    // ── LOGO / BUSINESS NAME ───────────────────────────────────────
    const headerY = 24;
    let nameX = LEFT;
    let nameWidth = CONTENT_WIDTH / 2;

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, LEFT, headerY, {
          width: 50,
          height: 50,
          fit: [50, 50],
          align: 'left',
        });
        nameX = LEFT + 60;
        nameWidth = CONTENT_WIDTH / 2 - 60;
      } catch (e) {
        this.logger.warn(`Failed to embed logo for ${business.name}`);
      }
    }

    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor(PRIMARY)
      .text(business.name, nameX, headerY, { width: nameWidth });

    if (business.tagline) {
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#666666')
        .text(business.tagline, nameX, headerY + 20, { width: nameWidth });
    }

    // ── TITLE (top-right) ─────────────────────────────────────────
    doc
      .fontSize(24)
      .font('Helvetica-Bold')
      .fillColor('#222222')
      .text(isQuote ? 'QUOTE' : 'RECEIPT', 0, headerY, { align: 'right', width: RIGHT });

    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text(`#${order.orderNumber}`, 0, headerY + 28, { align: 'right', width: RIGHT });

    // ── DIVIDER ────────────────────────────────────────────────────
    const divY = 90;
    doc.moveTo(LEFT, divY).lineTo(RIGHT, divY).lineWidth(1).strokeColor('#e0e0e0').stroke();

    // ── META BLOCK ─────────────────────────────────────────────────
    const metaY = divY + 14;

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#444444').text('BILLED TO', LEFT, metaY);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#222222')
      .text(order.customer.name ?? 'Customer', LEFT, metaY + 13);
    doc.fontSize(9).fillColor('#666666').text(order.customer.phone, LEFT, metaY + 26);

    const areaLabel = (order.flowData as any)?.areaLabel ?? '';
    if (areaLabel) {
      doc.fontSize(9).fillColor('#666666').text(areaLabel, LEFT, metaY + 39);
    }

    const rightCol = LEFT + CONTENT_WIDTH / 2 + 20;
    let metaRows: [string, string][];

    if (opts.mode === 'receipt') {
      const datePaid = opts.payment.confirmedAt
        ? new Date(opts.payment.confirmedAt).toLocaleDateString('en-NG', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : new Date().toLocaleDateString('en-NG', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });

      metaRows = [
        ['Date Paid:', datePaid],
        ['Receipt No:', order.orderNumber],
        ['Payment:', opts.payment.method === 'BANK_TRANSFER' ? 'Bank Transfer' : 'Paystack'],
      ];
    } else {
      const quoteDate = new Date().toLocaleDateString('en-NG', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      metaRows = [
        ['Quote Date:', quoteDate],
        ['Quote No:', order.orderNumber],
      ];
    }

    let mY = metaY;
    for (const [label, value] of metaRows) {
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#444444')
        .text(label, rightCol, mY, { width: 90 });
      doc.fontSize(9).font('Helvetica').fillColor('#222222').text(value, rightCol + 95, mY);
      mY += 15;
    }

    // ── STATUS BADGE ───────────────────────────────────────────────
    const badgeBg = isQuote ? '#fff3cd' : '#d4edda';
    const badgeText = isQuote ? '#856404' : '#155724';
    const badgeLabel = isQuote ? 'AWAITING CONFIRMATION' : 'PAID';
    const badgeWidth = isQuote ? 170 : 100;

    doc.roundedRect(rightCol, mY + 4, badgeWidth, 20, 4).fill(badgeBg);
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor(badgeText)
      .text(badgeLabel, rightCol, mY + 9, { width: badgeWidth, align: 'center' });

    // ── ITEMS TABLE ────────────────────────────────────────────────
    const tableY = metaY + 80;

    doc.rect(LEFT, tableY, CONTENT_WIDTH, 22).fill(PRIMARY);

    const col = {
      item: LEFT + 8,
      qty: LEFT + CONTENT_WIDTH * 0.52,
      unit: LEFT + CONTENT_WIDTH * 0.66,
      total: LEFT + CONTENT_WIDTH * 0.82,
    };

    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('ITEM', col.item, tableY + 7)
      .text('QTY', col.qty, tableY + 7)
      .text('UNIT PRICE', col.unit, tableY + 7)
      .text('TOTAL', col.total, tableY + 7);

    let rowY = tableY + 22;
    let rowIndex = 0;

    for (const item of order.items) {
      const qty = parseInt(item.quantity, 10) || 1;
      const unitPrice = item.unitPrice ?? 0;
      const lineTotal = unitPrice * qty;

      if (rowIndex % 2 === 0) {
        doc.rect(LEFT, rowY, CONTENT_WIDTH, 22).fill('#f9f9f9');
      }

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#222222')
        .text(item.name, col.item, rowY + 7, { width: CONTENT_WIDTH * 0.48 })
        .text(String(qty), col.qty, rowY + 7)
        .text(this.fmt(unitPrice, business), col.unit, rowY + 7)
        .text(this.fmt(lineTotal, business), col.total, rowY + 7);

      rowY += 22;
      rowIndex++;
    }

    // ── TOTALS ─────────────────────────────────────────────────────
    rowY += 8;
    const totalsX = col.unit - 10;
    const valX = col.total;

    const addTotalsRow = (label: string, value: string): void => {
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#444444')
        .text(label, totalsX, rowY, { width: col.total - totalsX - 5, align: 'right' })
        .text(value, valX, rowY);
      rowY += 20;
    };

    doc
      .moveTo(totalsX, rowY - 4)
      .lineTo(RIGHT, rowY - 4)
      .lineWidth(0.5)
      .strokeColor('#cccccc')
      .stroke();

    addTotalsRow('Subtotal', this.fmt(order.subtotal, business));

    if (order.deliveryFee > 0) {
      const dLabel = areaLabel ? `Delivery (${areaLabel})` : 'Delivery Fee';
      addTotalsRow(dLabel, this.fmt(order.deliveryFee, business));
    }

    if (order.serviceCharge > 0) {
      addTotalsRow('Service Charge', this.fmt(order.serviceCharge, business));
    }

    if (order.vatAmount > 0) {
      addTotalsRow('VAT', this.fmt(order.vatAmount, business));
    }

    rowY += 4;
    doc.rect(LEFT, rowY - 3, CONTENT_WIDTH, 26).fill(PRIMARY);
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('GRAND TOTAL', totalsX, rowY + 4, {
        width: col.total - totalsX - 5,
        align: 'right',
      })
      .text(this.fmt(order.total, business), valX, rowY + 4);

    // ── FOOTER ─────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 50;

    doc
      .moveTo(LEFT, footerY)
      .lineTo(RIGHT, footerY)
      .lineWidth(1)
      .strokeColor('#e0e0e0')
      .stroke();

    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .fillColor('#222222')
      .text(
        isQuote
          ? 'Tap Confirm in WhatsApp to proceed with this order'
          : 'Thank you for your order!',
        LEFT,
        footerY + 10,
        { align: 'center', width: CONTENT_WIDTH },
      );

    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#999999')
      .text('Powered by Cliqex', LEFT, footerY + 26, {
        align: 'center',
        width: CONTENT_WIDTH,
      });

    doc.rect(0, doc.page.height - 6, PAGE_WIDTH, 6).fill(PRIMARY);
  }
}