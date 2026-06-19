import { ServiceType } from '@prisma/client';

// ----------------------------------------------------------------
// All WhatsApp message templates live here.
// Never hardcode message strings anywhere else in the codebase.
// ----------------------------------------------------------------

export const Templates = {
  // ----------------------------------------------------------------
  // greeting
  //
  // Produces the Flow trigger card — the first thing a customer sees.
  //
  // What the customer sees in WhatsApp chat:
  //   [Image: your branding banner]
  //   "Welcome to ErrandsBuddy! ..."    ← flowCardBody
  //   Powered by ErrandsBuddy           ← footer (set in sendFlow call)
  //   [  Proceed  ]                     ← CTA button (ctaText in sendFlow)
  //
  // ----------------------------------------------------------------
  greeting: () => ({
    // Body text shown on the card before customer taps Proceed
    flowCardBody:
      `Your one-stop solution for everyday needs in Abuja. 🛒\n\n` +
      `Groceries, errands, cleaning and more — handled fast and reliably.\n\n` +
      `Tap *Proceed* to place your order in under 2 minutes.`,
  }),

  // ----------------------------------------------------------------
  // flowOrderReceived
  //
  // Sent INSTANTLY when the customer submits the Flow form.
  // This is the most important message — kills the waiting anxiety.
  // ----------------------------------------------------------------
  flowOrderReceived: (orderNumber: string) => ({
    body:
      `Got your order! \n\n` +
      ` *Order ${orderNumber}* has been created.\n\n` +
      `We're checking prices now — your quote will be ready shortly \n\n` +
      `We'll send it right here.`,
  }),

  // ----------------------------------------------------------------
  // quote — sent by admin from CRM after pricing items
  // ----------------------------------------------------------------
  quote: (params: {
    customerName: string | null;
    orderNumber: string;
    items: { name: string; quantity: string; unitPrice: number }[];
    deliveryFee: number;
    subtotal: number;
    total: number;
  }) => {
    const name = params.customerName ? params.customerName.split(' ')[0] : 'there';

    const itemLines = params.items
      .map((item) => `• ${item.name} (${item.quantity}) — ₦${item.unitPrice.toLocaleString()}`)
      .join('\n');

    const body =
      `Hi ${name}! Your quote is ready \n\n` +
      `🛒 *Order ${params.orderNumber}*\n` +
      `━━━━━━━━━━━━━━\n` +
      `${itemLines}\n` +
      `━━━━━━━━━━━━━━\n` +
      ` Delivery fee   ₦${params.deliveryFee.toLocaleString()}\n` +
      `*Total: ₦${params.total.toLocaleString()}*`;

    return {
      body,
      buttons: [
        { id: 'CONFIRM_ORDER', title: '✅ Confirm order' },
        { id: 'CANCEL_ORDER', title: '❌ Cancel' },
      ],
    };
  },

  // ----------------------------------------------------------------
  // paymentOptions — sent after customer confirms quote
  // ----------------------------------------------------------------
  paymentOptions: () => ({
    body: `Great choice!  How would you like to pay?`,
    buttons: [
      { id: 'PAY_TRANSFER', title: ' Bank transfer' },
      // { id: 'PAY_ONLINE', title: '💳 Pay online' },
    ],
  }),

  // ----------------------------------------------------------------
  // bankTransferDetails — your actual account number goes here
  // ----------------------------------------------------------------
  bankTransferDetails: (params: {
    amount: number;
    orderNumber: string;
    bankName: string; // ← was hardcoded "Opay"
    accountNumber: string; // ← was hardcoded "8012345678"
    accountName: string; // ← was hardcoded "ErrandsBuddy Ltd"
  }) => ({
    body:
      `Please transfer *₦${params.amount.toLocaleString()}* to:\n\n` +
      ` *Bank:* ${params.bankName}\n` +
      ` *Name:* ${params.accountName}\n` +
      ` *Account:* ${params.accountNumber}\n\n` +
      `Use *${params.orderNumber}* as your payment reference.\n\n` +
      `Send your transfer receipt here once done \n\n` +
      `Our team will confirm within minutes.`,
  }),

  // ----------------------------------------------------------------
  // paymentLink — Paystack
  // ----------------------------------------------------------------
  paymentLink: (params: { amount: number; orderNumber: string; link: string }) => ({
    body:
      `Here's your secure payment link 💳\n\n` +
      ` Amount: *₦${params.amount.toLocaleString()}*\n` +
      ` Order: *${params.orderNumber}*\n\n` +
      `${params.link}`,
  }),

  // ----------------------------------------------------------------
  // paymentConfirmed
  // ----------------------------------------------------------------
  paymentConfirmed: (orderNumber: string) => ({
    body:
      ` *Payment received!*\n\n` +
      `Order *${orderNumber}* is confirmed — we're on it! 🛒\n\n` +
      `We'll update you as soon as a Buddy is assigned.`,
  }),

  // ----------------------------------------------------------------
  // buddyAssigned
  // ----------------------------------------------------------------
  buddyAssigned: (params: {
    orderNumber: string;
    buddyName: string;
    buddyPhone: string;
    eta: string;
  }) => ({
    body:
      `Your Buddy *${params.buddyName}* has been assigned! 🏍️\n\n` +
      ` Order: *${params.orderNumber}*\n` +
      ` Contact: *${params.buddyPhone}*\n` +
      ` Est. arrival: *${params.eta}*\n\n` +
      `We'll notify you when they're on the way.`,
    buttons: [{ id: `CALL_BUDDY_${params.buddyPhone}`, title: '📞 Call Buddy' }],
  }),

  // ----------------------------------------------------------------
  // inTransit
  // ----------------------------------------------------------------
  inTransit: (params: { orderNumber: string; buddyName: string }) => ({
    body:
      ` *${params.buddyName}* is on the way with your order!\n\n` +
      ` Order: *${params.orderNumber}*\n\n` +
      `Please be available to receive your delivery 🙏`,
  }),

  // ----------------------------------------------------------------
  // delivered + rating buttons
  // ----------------------------------------------------------------
  delivered: (customerName: string | null) => {
    const name = customerName ? customerName.split(' ')[0] : 'there';
    return {
      body: ` Order delivered! Hope everything looks great, ${name}.\n\nHow was your experience?`,
      buttons: [
        { id: 'RATING_5', title: '⭐⭐⭐⭐⭐ Excellent' },
        { id: 'RATING_3', title: '👍 Good' },
        { id: 'RATING_1', title: '😕 Had an issue' },
      ],
    };
  },

  // ----------------------------------------------------------------
  // orderCancelled
  // ----------------------------------------------------------------
  orderCancelled: (orderNumber: string) => ({
    body:
      `Your order *${orderNumber}* has been cancelled.\n\n` +
      `If you need anything, just send us a new message anytime! `,
  }),

  // ----------------------------------------------------------------
  // fallback
  // ----------------------------------------------------------------
  fallback: () => ({
    body: `Sorry, I didn't quite get that \n\nType *Hi* to start a new order.`,
  }),

  // ----------------------------------------------------------------
  // requestList — kept for backwards compat
  // ----------------------------------------------------------------
  requestList: (serviceType: ServiceType) => {
    const prompts: Record<ServiceType, string> = {
      GROCERY: `Perfect! 🛒 Send me your shopping list.`,
      ERRAND: `No problem! 🏃 Describe the errand in detail.`,
      CLEANING: `Let's get your space sparkling ✨ Tell us the type of cleaning and your location.`,
    };
    return { body: prompts[serviceType] };
  },

  // ----------------------------------------------------------------
  // listReceived — kept for backwards compat
  // ----------------------------------------------------------------
  listReceived: () => ({
    body: `Got your list! \n\nWe're checking prices now — your quote will be ready in under *10 minutes* `,
  }),
};
