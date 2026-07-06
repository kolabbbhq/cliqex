// ----------------------------------------------------------------
// Meta WhatsApp Cloud API — webhook payload types
// ----------------------------------------------------------------

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppEntry[];
}
export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}
export interface WhatsAppChange {
  value: WhatsAppValue;
  field: string;
}
export interface WhatsAppValue {
  messaging_product: string;
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}
export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}
export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}
export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: WhatsAppMessageType;
  text?: { body: string };
  image?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  button?: { payload: string; text: string };
  interactive?: WhatsAppInteractive;
}
export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'button'
  | 'interactive'
  | 'order'
  | 'unknown';

export interface WhatsAppMedia {
  id: string;
  mime_type: string;
  sha256: string;
  caption?: string;
}
export interface WhatsAppInteractive {
  type: 'button_reply' | 'list_reply' | 'nfm_reply';
  button_reply?: { id: string; title: string };
  list_reply?: { id: string; title: string; description?: string };
  // Populated when a WhatsApp Flow is completed
  nfm_reply?: {
    response_json: string; // JSON string — parse to get FlowSubmissionPayload
    body: string;
    name: string; // "flow"
  };
}
export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
}

// ----------------------------------------------------------------
// Flow data exchange webhook — for the /flow-webhook endpoint
// ----------------------------------------------------------------
export interface WhatsAppFlowWebhookPayload {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}
export interface FlowWebhookBody {
  screen: string;
  data: Record<string, string>;
  version: string;
  action: 'ping' | 'init' | 'data_exchange';
  flow_token: string;
}

// ----------------------------------------------------------------
// FlowSubmissionPayload
// This is what arrives inside nfm_reply.response_json
// when the customer taps "Proceed" on the SUMMARY screen.
// Fields match exactly the payload keys in errandsbuddy.flow.json
// ----------------------------------------------------------------
export interface FlowSubmissionPayload {
  service_type: string;    // "GROCERY" | "ERRAND" | "CLEANING"
  service_label?: string;  // "Grocery Shopping" | "Run an Errand" | "Cleaning Service"
  item_list: string;
  budget: string;
  preferred_store?: string;
  customer_name: string;
  delivery_address: string;
  area: string;
  phone_number: string;
  additional_info?: string;
}

// ----------------------------------------------------------------
// Outbound message types
// ----------------------------------------------------------------
export interface SendTextPayload {
  to: string;
  message: string;
}
export interface SendButtonsPayload {
  to: string;
  body: string;
  buttons: { id: string; title: string }[];
  header?: string;
  footer?: string;
}

// ----------------------------------------------------------------
// SendFlowPayload — triggers the WhatsApp Flow card in chat
// ----------------------------------------------------------------
export interface SendFlowPayload {
  to: string;
  flowId: string;
  flowToken: string;
  headerImage?: string;
  body: string;
  footer?: string;
  ctaText: string;
  phoneId?: string;
}

// ----------------------------------------------------------------
// SendDocumentPayload — sends a PDF or other document via WhatsApp
//
// Meta API shape:
// {
//   "messaging_product": "whatsapp",
//   "recipient_type": "individual",
//   "to": "phone",
//   "type": "document",
//   "document": {
//     "link": "https://cloudinary-url/receipt.pdf",
//     "filename": "Receipt-EB-0042.pdf",
//     "caption": "Your receipt for Order EB-0042 🧾"
//   }
// }
// ----------------------------------------------------------------
export interface SendDocumentPayload {
  to: string;
  documentUrl: string;   // publicly accessible URL (Cloudinary)
  filename: string;      // e.g. "Receipt-EB-0042.pdf"
  caption?: string;      // e.g. "Your receipt for Order EB-0042 🧾"
  token: string;         // business WhatsApp token
  phoneId: string;       // business WhatsApp Phone Number ID
}

// ----------------------------------------------------------------
// ParsedInboundMessage — normalised after parsing raw webhook
// ----------------------------------------------------------------
export interface ParsedInboundMessage {
  waMessageId: string;
  phone: string;
  contactName: string | null;
  type: WhatsAppMessageType;
  text: string | null;
  mediaId: string | null;
  buttonPayload: string | null;
  flowPayload: FlowSubmissionPayload | null; // populated on flow completion
}

// ----------------------------------------------------------------
// SendTemplatePayload — sends a Meta pre-approved template message
// ----------------------------------------------------------------
export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: TemplateParameter[];
  index?: number;    // required for button components
  sub_type?: 'quick_reply' | 'url';
}

export interface TemplateParameter {
  type: 'text' | 'image' | 'document' | 'video' | 'currency' | 'date_time';
  text?: string;
  image?: { link: string };
  document?: { link: string; filename?: string };
  currency?: { fallback_value: string; code: string; amount_1000: number };
  date_time?: { fallback_value: string };
}

export interface SendTemplatePayload {
  to: string;
  templateName: string;
  languageCode: string;
  components?: TemplateComponent[];
  token: string;
  phoneId: string;
}