// ----------------------------------------------------------------
// All WhatsApp message templates live here.
// Never hardcode message strings anywhere else in the codebase.
// ----------------------------------------------------------------

export const Templates = {
  // ----------------------------------------------------------------
  // greeting (flow card body — used elsewhere, unrelated to custom greeting)
  // ----------------------------------------------------------------
  greeting: () => ({
    flowCardBody:
      `Your trusted partner for everyday errands in Abuja. 🛒\n\n` +
      `Groceries, errands, cleaning and more — handled fast and reliably.\n\n` +
      `Tap *Proceed* to place your order in under 2 minutes.`,
  }),

  // ----------------------------------------------------------------
  // customGreeting — sent to first-time customers when business has
  // configured a custom "greeting" message template
  // ----------------------------------------------------------------
  customGreeting: (name: string, override: string) => ({
    body: override.replace('{name}', name),
  }),

  // ----------------------------------------------------------------
  // closedMessage — sent when a customer messages outside operating hours
  // ----------------------------------------------------------------
  closedMessage: (nextOpen: string, override?: string) => ({
    body: override
      ? override.replace('{nextOpen}', nextOpen)
      : `Hi! 👋 We are currently closed.\n\n` +
        `We'll be back ${nextOpen}.\n\n` +
        `Feel free to send your order then and we'll get right on it! 😊`,
  }),

  // ----------------------------------------------------------------
  // flowNotReady
  // ----------------------------------------------------------------
  flowNotReady: () => ({
    body: `Hi! We are setting up our ordering system. Please try again in a few minutes. 🙏`,
  }),

  // ----------------------------------------------------------------
  // menuGreeting
  // ----------------------------------------------------------------
  menuGreeting: (params: { businessName: string; welcomeText?: string; menuUrl: string }) => ({
    body:
      `Hi! 👋 Welcome to *${params.businessName}*\n\n` +
      `${params.welcomeText ?? 'Tap the link below to view our menu and place your order 🍽️'}\n\n` +
      `👉 ${params.menuUrl}`,
  }),
  menuGreetingCta: (params: { businessName: string; welcomeText?: string; menuUrl: string }) => ({
    body: `Hi! 👋 Welcome to *${params.businessName}*\n\n${params.welcomeText ?? 'Tap below to view our menu and place your order 🍽️'}`,
    footer: 'Powered by Cliqex',
    buttonText: 'View Menu & Order →',
    url: params.menuUrl,
  }),

  // ----------------------------------------------------------------
  // flowOrderReceived — sent right after a customer submits an order.
  // Business can override via messageTemplates.orderReceived,
  // supporting the {orderNumber} placeholder.
  // ----------------------------------------------------------------
  flowOrderReceived: (orderNumber: string, serviceType?: string, override?: string) => {
    if (override) {
      return { body: override.replace('{orderNumber}', orderNumber) };
    }

    const isCleaning  = serviceType === 'CLEANING';
    const isLogistics = serviceType === 'LOGISTICS';

    let contextLine: string;
    if (isCleaning) {
      contextLine = `Our team will review your request and send you a quote shortly.`;
    } else if (isLogistics) {
      contextLine = `Our team is reviewing your delivery request and will send you a quote shortly.`;
    } else {
      contextLine = `Our team is now checking prices. We'll send your quote here shortly.`;
    }

    return {
      body:
        `Got it! ✅\n\n` +
        `Your request has been received and your order number is *${orderNumber}*.\n\n` +
        `${contextLine}\n\n` +
        `Thanks for choosing ErrandsBuddy.`,
    };
  },

  // ----------------------------------------------------------------
  // quote — supports an optional footerOverride appended after the total
  // (business.messageTemplates.quoteFooter)
  // ----------------------------------------------------------------
  quote: (params: {
    customerName: string | null;
    orderNumber: string;
    areaLabel?: string;
    items: { name: string; quantity: string; unitPrice: number }[];
    deliveryFee: number;
    subtotal: number;
    serviceCharge: number;
    vatAmount: number;
    total: number;
    serviceType?: string;
    footerOverride?: string;
  }) => {
    const name = params.customerName ? params.customerName.split(' ')[0] : 'there';
    const isCleaning  = params.serviceType === 'CLEANING';
    const isLogistics = params.serviceType === 'LOGISTICS';

    const itemLines = params.items
      .map((item) => {
        const qty = parseInt(item.quantity, 10) || 1;
        return qty > 1
          ? `• ${item.name} ×${qty} — ₦${(item.unitPrice * qty).toLocaleString()}`
          : `• ${item.name} — ₦${item.unitPrice.toLocaleString()}`;
      })
      .join('\n');

    const deliveryLabel = params.areaLabel
      ? `Delivery (${params.areaLabel})`
      : isLogistics
      ? 'Logistics fee'
      : isCleaning
      ? 'Travel fee'
      : 'Delivery fee';

    const header = isCleaning
      ? `Hi ${name}! Here's your cleaning quote 🧹\n`
      : isLogistics
      ? `Hi ${name}! Here's your delivery quote 🚴\n`
      : `Hi ${name}! Your quote is ready 🧾\n`;

    const lines: string[] = [
      header,
      `🛒 *Order ${params.orderNumber}*`,
      `━━━━━━━━━━━━━━`,
      itemLines,
      `━━━━━━━━━━━━━━`,
      `Subtotal          ₦${params.subtotal.toLocaleString()}`,
    ];

    if (params.deliveryFee > 0) {
      lines.push(`${deliveryLabel.padEnd(18)}₦${params.deliveryFee.toLocaleString()}`);
    }
    if (params.serviceCharge > 0) {
      lines.push(`Service charge    ₦${Math.round(params.serviceCharge).toLocaleString()}`);
    }
    if (params.vatAmount > 0) {
      lines.push(`VAT               ₦${Math.round(params.vatAmount).toLocaleString()}`);
    }

    lines.push(`━━━━━━━━━━━━━━`);
    lines.push(`*Total            ₦${Math.round(params.total).toLocaleString()}*`);

    if (params.footerOverride) {
      lines.push('');
      lines.push(params.footerOverride);
    }

    return {
      body: lines.join('\n'),
      buttons: [
        { id: 'CONFIRM_ORDER', title: '✅ Confirm order' },
        { id: 'CANCEL_ORDER',  title: '❌ Cancel' },
      ],
    };
  },

  // ----------------------------------------------------------------
  // paymentOptions
  // ----------------------------------------------------------------
  paymentOptions: () => ({
    body: `Great choice! How would you like to pay?`,
    buttons: [
      { id: 'PAY_TRANSFER', title: '🏦 Bank transfer' },
    ],
  }),

  // ----------------------------------------------------------------
  // bankTransferDetails
  // ----------------------------------------------------------------
  bankTransferDetails: (params: {
    amount: number;
    orderNumber: string;
    bankName: string;
    accountNumber: string;
    accountName: string;
  }) => ({
    body:
      `Please transfer *₦${params.amount.toLocaleString()}* to:\n\n` +
      ` *Bank:* ${params.bankName}\n` +
      ` *Name:* ${params.accountName}\n` +
      ` *Account:* ${params.accountNumber}\n\n` +
      `Use *${params.orderNumber}* as your payment reference.\n\n` +
      `Send your transfer receipt here once done 🧾\n\n` +
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
  // paymentProofReceived
  // Sent when customer uploads payment receipt image
  // ----------------------------------------------------------------
  paymentProofReceived: () => ({
    body:
      `Payment receipt received! 🧾\n\n` +
      `Thanks! We're confirming your payment now and will update you as soon as it is verified.`,
  }),

  // ----------------------------------------------------------------
  // paymentConfirmed
  // Sent on ORDER_PROCESSING (auto-fires after markPaid)
  // ----------------------------------------------------------------
  paymentConfirmed: (orderNumber: string, serviceType?: string) => {
    const isCleaning  = serviceType === 'CLEANING';
    const isLogistics = serviceType === 'LOGISTICS';

    let nextStepLine: string;
    if (isCleaning) {
      nextStepLine = `We'll update you as soon as your cleaner is assigned and confirmed.`;
    } else if (isLogistics) {
      nextStepLine = `We'll update you as soon as a Buddy is assigned to handle your delivery.`;
    } else {
      nextStepLine = `We'll assign a Buddy shortly.`;
    }

    return {
      body:
        `Payment confirmed! ✅\n\n` +
        `Thanks for your payment. Your order (*${orderNumber}*) has been confirmed and our team is already working on it.\n\n` +
        `${nextStepLine}`,
    };
  },

  // ----------------------------------------------------------------
  // paymentReceipt
  // Used as the caption on the PDF document sent to the customer
  // ----------------------------------------------------------------
  paymentReceipt: (orderNumber: string) => ({
    body:
      `Your receipt for Order *${orderNumber}* is attached.\n\n` +
      `Please keep it for your records. If you have any questions, we're just a message away.`,
  }),

  // ----------------------------------------------------------------
  // orderBeingPrepared
  // Sent right after paymentConfirmed on ORDER_PROCESSING
  // ----------------------------------------------------------------
  orderBeingPrepared: () => ({
    body:
      `Your order is now being prepared. 🛒\n\n` +
      `Our team is matching you with the best Buddy for the job.\n\n` +
      `We'll let you know as soon as they're assigned.`,
  }),

  // ----------------------------------------------------------------
  // buddyAssigned
  // ----------------------------------------------------------------
  buddyAssigned: (params: {
    orderNumber: string;
    buddyName: string;
    eta: string;
    serviceType: string;
  }) => {
    const isCleaning  = params.serviceType === 'CLEANING';
    const isLogistics = params.serviceType === 'LOGISTICS';

    const icon = isCleaning ? '🧹' : '🏍️';
    const role = isCleaning ? 'cleaner' : 'Buddy';

    let contextLine: string;
    if (isCleaning) {
      contextLine = `Estimated arrival: *${params.eta}*\n\nPlease be available to let them in.`;
    } else if (isLogistics) {
      contextLine = `Estimated arrival: *${params.eta}*\n\nThey're heading to the pickup address now.`;
    } else {
      contextLine = `Estimated arrival: *${params.eta}*\n\nThey're already sourcing your items.`;
    }

    return {
      body:
        `Great news! ${icon}\n\n` +
        `*${params.buddyName}* has been assigned as your ${role}.\n\n` +
        ` Order: *${params.orderNumber}*\n\n` +
        `${contextLine}\n\n` +
        `You'll receive another update once your ${role} is on the way.`,
    };
  },

  // ----------------------------------------------------------------
  // inTransit
  // ----------------------------------------------------------------
  inTransit: (params: {
    orderNumber: string;
    buddyName: string;
    serviceType: string;
  }) => {
    const isCleaning  = params.serviceType === 'CLEANING';
    const isLogistics = params.serviceType === 'LOGISTICS';

    let body: string;

    if (isCleaning) {
      body =
        `🧹 *${params.buddyName}* is on the way to your location!\n\n` +
        ` Order: *${params.orderNumber}*\n\n` +
        `Please be available to let them in 🙏`;
    } else if (isLogistics) {
      body =
        `🚀 *${params.buddyName}* has picked up the package and is heading to the drop-off address!\n\n` +
        ` Order: *${params.orderNumber}*\n\n` +
        `Please ensure someone is available to receive it 🙏`;
    } else {
      body =
        `🚀 Your Buddy is on the way!\n\n` +
        `*${params.buddyName}* is heading to you with your order.\n\n` +
        ` Order: *${params.orderNumber}*\n\n` +
        `Please keep your phone nearby and be available to receive your delivery.\n\n` +
        `See you soon! 😊`;
    }

    return { body };
  },

  // ----------------------------------------------------------------
  // delivered + rating buttons
  // ----------------------------------------------------------------
  delivered: (customerName: string | null, serviceType: string) => {
    const name = customerName ? customerName.split(' ')[0] : 'there';
    const isCleaning  = serviceType === 'CLEANING';
    const isLogistics = serviceType === 'LOGISTICS';

    let opening: string;
    if (isCleaning) {
      opening = `✨ Cleaning done! Hope your space is looking fresh, ${name}.`;
    } else if (isLogistics) {
      opening =
        `📦 Your order has been delivered!\n\n` +
        `We hope everything is exactly as you expected, ${name}.`;
    } else {
      opening =
        `📦 Your order has been delivered!\n\n` +
        `We hope everything is exactly as you expected, ${name}.`;
    }

    return {
      body: `${opening}\n\nHow would you rate your experience with ErrandsBuddy today?`,
      buttons: [
        { id: 'RATING_5', title: '⭐⭐⭐⭐⭐ Excellent' },
        { id: 'RATING_3', title: '👍 Good' },
        { id: 'RATING_1', title: '😕 Had an issue' },
      ],
    };
  },

  // ----------------------------------------------------------------
  // ratingFollowUp
  // ----------------------------------------------------------------
  ratingFollowUp: (rating: number) => {
    let message: string;

    if (rating === 5) {
      message =
        `Thank you so much for the rating! ⭐⭐⭐⭐⭐\n\n` +
        `We're delighted we could help you save time today.\n\n` +
        `Would you mind telling us what you loved most about your experience?\n\n` +
        `Simply reply with your feedback, or type *SKIP* if you'd rather not.`;
    } else if (rating === 3) {
      message =
        `Thank you for the feedback! 👍\n\n` +
        `Is there anything specific we could have done better? We'd love to know 🙏\n\n` +
        `Just reply with your comment or type *SKIP* to finish.`;
    } else {
      message =
        `We're sorry to hear that 😔 Your experience matters to us.\n\n` +
        `Please tell us what went wrong so we can make it right.\n\n` +
        `Just reply with your comment or type *SKIP* to finish.`;
    }

    return { body: message };
  },

  // ----------------------------------------------------------------
  // feedbackReceived
  // ----------------------------------------------------------------
  feedbackReceived: () => ({
    body:
      `Thank you for your feedback! 🙏\n\n` +
      `We truly appreciate you taking the time to share your experience.\n\n` +
      `Your comments help us serve you even better.\n\n` +
      `We look forward to assisting you again soon.\n\n` +
      `Own your time to freedom. 😊`,
  }),

  // ----------------------------------------------------------------
  // orderCancelled
  // ----------------------------------------------------------------
  orderCancelled: (orderNumber: string) => ({
    body:
      `Your order *${orderNumber}* has been cancelled.\n\n` +
      `If you need anything, just send us a new message anytime! 😊`,
  }),

  // ----------------------------------------------------------------
  // fallback
  // ----------------------------------------------------------------
  fallback: () => ({
    body: `Sorry, I didn't quite get that 😅\n\nType *Hi* to start a new order.`,
  }),

  // ----------------------------------------------------------------
  // requestList — kept for backwards compat
  // ----------------------------------------------------------------
  requestList: (serviceType: string) => {
    const prompts: Record<string, string> = {
      GROCERY:  `Perfect! 🛒 Send me your shopping list.`,
      ERRAND:   `No problem! 🏃 Describe the errand in detail.`,
      CLEANING: `Let's get your space sparkling ✨ Tell us the type of cleaning and your location.`,
    };
    return { body: prompts[serviceType] };
  },

  // ----------------------------------------------------------------
  // listReceived — kept for backwards compat
  // ----------------------------------------------------------------
  listReceived: () => ({
    body:
      `Got your list! 👍\n\n` +
      `We're checking prices now — your quote will be ready in under *10 minutes* ⏱️`,
  }),
};