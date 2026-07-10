// ============================================================
// ErrandsBuddy — App Events
// All event names defined here. Import from here everywhere.
// ============================================================

export const EVENTS = {
  ORDER_CREATED: 'order.created',
  ORDER_QUOTED: 'order.quoted',
  ORDER_AWAITING_PAYMENT: 'order.awaiting_payment',
  ORDER_PAID: 'order.paid',
  ORDER_PROCESSING: 'order.processing',
  ORDER_ASSIGNED: 'order.assigned',
  ORDER_IN_TRANSIT: 'order.in_transit',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',

  // WhatsApp
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_SENT: 'message.sent',

  // Payments
  PAYMENT_CONFIRMED: 'payment.confirmed',
  PAYMENT_REJECTED: 'payment.rejected',
  PAYMENT_FAILED: 'payment.failed',

  // AI processing
  AI_EXTRACTION_DONE: 'ai.extraction_done',
  AI_EXTRACTION_FAILED: 'ai.extraction_failed',

  // Buddy
  BUDDY_ASSIGNED: 'buddy.assigned',
  BUDDY_STATUS_CHANGED: 'buddy.status_changed',

  // Reviews
  REVIEW_SUBMITTED: 'review.submitted',
} as const;

// Order status transition map — enforces the state machine
// Key = current status, Value = allowed next statuses
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  NEW: ['QUOTED', 'CANCELLED'],
  QUOTED: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};