// src/modules/whatsapp/templates/message-template-overrides.type.ts
export interface MessageTemplateOverrides {
  greeting?: string;       // supports {name}
  orderReceived?: string;  // supports {orderNumber}
  closedMessage?: string;  // supports {nextOpen}
  quoteFooter?: string;    // plain text, no placeholders
}