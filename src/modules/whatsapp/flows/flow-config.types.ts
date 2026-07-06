export type FlowFieldType = 'text' | 'phone' | 'number' | 'textarea' | 'dropdown' | 'radio';

export interface FlowFieldOption {
  id: string;
  title: string;
  description?: string;
}

export interface FlowFieldDef {
  name: string;            // becomes the form field name AND the key in flowData sent to your backend
  label: string;
  type: FlowFieldType;
  required?: boolean;
  helperText?: string;
  maxLength?: number;             // text / textarea
  options?: FlowFieldOption[];    // dropdown / radio
}

export interface FlowServiceDef {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
  itemized: boolean;
  icon?: string;
  fields: FlowFieldDef[];
  overrideStandardFields?: {
    hideDeliveryAddress?: boolean;
  };
  chargeRules?: {
    applyDeliveryFee?: boolean;
    applyServiceCharge?: boolean;
    applyVat?: boolean;
  };
}

export interface FlowAreaDef {
  id: string;
  label: string;
deliveryFee?: number;  // ✅ pre-fills quote builder, admin can override
}

// Field names reserved for the standard delivery/contact block that's
// auto-appended to every detail screen. A business-defined field with
// one of these names will be dropped (with a warning) to avoid duplicate
// form components in the generated Flow JSON.
export const RESERVED_FIELD_NAMES = new Set([
  'service_type',
  'customer_name',
  'delivery_address',
  // pickup_address and dropoff_address removed — LOGISTICS owns these as custom fields
  'area',
  'phone_number',
  'additional_info',
]);