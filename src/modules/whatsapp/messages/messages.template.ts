type ServiceType = string;

// ----------------------------------------------------------------
// All WhatsApp message templates live here.
// Never hardcode message strings anywhere else in the codebase.
// ----------------------------------------------------------------

export const Templates = {

  // ----------------------------------------------------------------
  // Greeting — sent when customer messages for the first time
  // or sends a message that doesn't match any active flow
  // ----------------------------------------------------------------
  greeting: () => ({
    body: `Hey! 👋 Welcome to *ErrandsBuddy* — your personal shopping & errand service.\n\nWhat can we help you with today?`,
    buttons: [
      { id: 'SERVICE_GROCERY',  title: '🛒 Grocery shopping' },
      { id: 'SERVICE_ERRAND',   title: '📦 Run an errand'    },
      { id: 'SERVICE_CLEANING', title: '🧹 Book cleaning'    },
    ],
  }),

  // ----------------------------------------------------------------
  // Service selected — prompt customer to send their list
  // ----------------------------------------------------------------
  requestList: (serviceType: ServiceType) => {
    const prompts: Record<ServiceType, string> = {
      GROCERY: `Perfect! 🛒\n\nJust send me your shopping list — you can type it, or snap a photo of your written list 📸\n\nAlso let us know where to shop (e.g. Shoprite, nearest market, Marketsquare)`,
      ERRAND:  `No problem! 🏃 What do you need done?\n\nDescribe the errand — pickup, delivery, pharmacy run, document drop-off etc. The more detail, the better!`,
      CLEANING:`Let's get your space sparkling ✨\n\nTell us:\n1️⃣ Type of cleaning (routine / deep / post-move)\n2️⃣ Number of bedrooms & bathrooms\n3️⃣ Any special areas (kitchen, balcony etc)\n4️⃣ Your location`,
    };

    return { body: prompts[serviceType] };
  },

  // ----------------------------------------------------------------
  // List received — instant auto-reply (sent in < 2 seconds)
  // This is the most important message — kills the anxiety of waiting
  // ----------------------------------------------------------------
  listReceived: () => ({
    body: `Got your list! ✅\n\nWe're checking prices now — your quote will be ready in under *10 minutes* ⏱️\n\nWe'll send it right here.`,
  }),

  // ----------------------------------------------------------------
  // Quote — sent by admin from CRM after pricing items
  // ----------------------------------------------------------------
  quote: (params: {
    customerName: string | null;
    orderNumber:  string;
    items:        { name: string; quantity: string; unitPrice: number }[];
    deliveryFee:  number;
    subtotal:     number;
    total:        number;
  }) => {
    const name = params.customerName ? params.customerName.split(' ')[0] : 'there';

    const itemLines = params.items
      .map((item) => `• ${item.name} (${item.quantity}) — ₦${item.unitPrice.toLocaleString()}`)
      .join('\n');

    const body =
      `Hi ${name}! Your quote is ready 🎉\n\n` +
      `🛒 *Order ${params.orderNumber}*\n` +
      `━━━━━━━━━━━━━━\n` +
      `${itemLines}\n` +
      `━━━━━━━━━━━━━━\n` +
      `🛵 Delivery fee   ₦${params.deliveryFee.toLocaleString()}\n` +
      `*Total: ₦${params.total.toLocaleString()}*`;

    return {
      body,
      buttons: [
        { id: 'CONFIRM_ORDER', title: '✅ Confirm order' },
        { id: 'EDIT_ORDER',    title: '✏️ Edit my list'  },
        { id: 'CANCEL_ORDER',  title: '❌ Cancel'        },
      ],
    };
  },

  // ----------------------------------------------------------------
  // Payment options — sent after customer confirms quote
  // ----------------------------------------------------------------
  paymentOptions: () => ({
    body: `Great choice!  How would you like to pay?`,
    buttons: [
      { id: 'PAY_ONLINE',   title: '💳 Pay online'      },
      { id: 'PAY_TRANSFER', title: '🏦 Bank transfer'   },
    ],
  }),

  // ----------------------------------------------------------------
  // Payment link — Paystack link sent to customer
  // ----------------------------------------------------------------
  paymentLink: (params: { amount: number; orderNumber: string; link: string }) => ({
    body:
      `Here's your secure payment link 💳\n\n` +
      `💰 Amount: *₦${params.amount.toLocaleString()}*\n` +
      `🔖 Order: *${params.orderNumber}*\n\n` +
      `Tap the link below to pay by card, bank transfer or USSD 👇\n\n` +
      `${params.link}`,
  }),

  // ----------------------------------------------------------------
  // Bank transfer details
  // ----------------------------------------------------------------
  bankTransferDetails: (params: { amount: number; orderNumber: string }) => ({
    body:
      `Please transfer *₦${params.amount.toLocaleString()}* to:\n\n` +
      `🏦 *Bank:* Opay\n` +
      `👤 *Name:* ErrandsBuddy Ltd\n` +
      `💳 *Account:* 8012345678\n\n` +
      `Use *${params.orderNumber}* as your payment reference.\n\n` +
      `Send your transfer receipt here once done `,
  }),

  // ----------------------------------------------------------------
  // Payment confirmed — sent automatically by Paystack webhook
  // ----------------------------------------------------------------
  paymentConfirmed: (orderNumber: string) => ({
    body:
      `✅ *Payment received!*\n\n` +
      `Order *${orderNumber}* is confirmed — we're on it! 🛒\n\n` +
      `We'll update you as soon as a Buddy is assigned.`,
  }),

  // ----------------------------------------------------------------
  // Buddy assigned — sent when admin assigns a rider
  // ----------------------------------------------------------------
  buddyAssigned: (params: {
    orderNumber: string;
    buddyName:   string;
    buddyPhone:  string;
    eta:         string;
  }) => ({
    body:
      `Your Buddy *${params.buddyName}* has been assigned! 🏍️\n\n` +
      `📦 Order: *${params.orderNumber}*\n` +
      `📞 Contact: *${params.buddyPhone}*\n` +
      `⏱️ Est. arrival: *${params.eta}*\n\n` +
      `We'll notify you when they're on the way.`,
    buttons: [
      { id: `CALL_BUDDY_${params.buddyPhone}`, title: '📞 Call Buddy' },
    ],
  }),

  // ----------------------------------------------------------------
  // Order in transit — buddy picked up and heading to customer
  // ----------------------------------------------------------------
  inTransit: (params: { orderNumber: string; buddyName: string }) => ({
    body:
      `🏍️ *${params.buddyName}* is on the way with your order!\n\n` +
      `📦 Order: *${params.orderNumber}*\n\n` +
      `Please be available to receive your delivery 🙏`,
  }),

  // ----------------------------------------------------------------
  // Delivered — sent when admin marks order delivered
  // ----------------------------------------------------------------
  delivered: (customerName: string | null) => {
    const name = customerName ? customerName.split(' ')[0] : 'there';
    return {
      body: `🎉 Order delivered! Hope everything looks great, ${name}.\n\nHow was your experience?`,
      buttons: [
        { id: 'RATING_5', title: '⭐⭐⭐⭐⭐ Excellent' },
        { id: 'RATING_3', title: '👍 Good'            },
        { id: 'RATING_1', title: '😕 Had an issue'    },
      ],
    };
  },

  // ----------------------------------------------------------------
  // Order cancelled
  // ----------------------------------------------------------------
  orderCancelled: (orderNumber: string) => ({
    body:
      `Your order *${orderNumber}* has been cancelled.\n\n` +
      `If you need anything, just send us a new message anytime! 😊`,
  }),

  // ----------------------------------------------------------------
  // Fallback — when we don't understand the message
  // ----------------------------------------------------------------
  fallback: () => ({
    body: `Sorry, I didn't quite get that 😅\n\nType *Hi* to start a new order, or reply to an existing message in our conversation.`,
  }),
};
