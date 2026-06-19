import { z } from 'zod';

// ----------------------------------------------------------------
// Step 1 — Signup
// ----------------------------------------------------------------
export const SignupSchema = z.object({
  businessName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),
  tagline: z.string().trim().max(120).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color e.g. #1a8a5e')
    .optional(),
  ownerName: z.string().trim().min(2).max(80),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerPassword: z
    .string()
    .min(8)
    .max(72)
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Must contain uppercase, lowercase and a number'),
  plan: z.enum(['STARTER', 'GROWTH', 'PRO']).default('STARTER'),
});

// ----------------------------------------------------------------
// Step 2 — Connect WhatsApp
// ----------------------------------------------------------------
export const ConnectWhatsAppSchema = z.object({
  whatsappPhoneId: z.string().trim().min(5),
  whatsappToken: z.string().trim().min(10),
  whatsappVerifyToken: z.string().trim().min(4).max(64),
});

// ----------------------------------------------------------------
// Step 3 — Configure Services and Areas
// ----------------------------------------------------------------
export const ConfigureServicesSchema = z.object({
  services: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        label: z.string().trim().min(1).max(60),
        description: z.string().trim().max(120).default(''),
        active: z.boolean().default(true),
      }),
    )
    .min(1, 'Add at least one service')
    .max(10),

  areas: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        label: z.string().trim().min(1).max(60),
      }),
    )
    .min(1, 'Add at least one delivery area')
    .max(100),

  welcomeText: z.string().trim().max(300).optional(),
  headerImageUrl: z.string().trim().url().optional(),
  serviceChargePercent: z.number().min(0).max(50).default(0),
  vatPercent: z.number().min(0).max(30).default(0),

  // Per-service banner images
  serviceBanners: z.record(z.string().url()).optional(),

  // Flow behaviour toggles
  showDeliveryEta: z.boolean().default(true),
  collectBudget: z.boolean().default(true),
  collectStore: z.boolean().default(false),
});

// ----------------------------------------------------------------
// Step 4 — Payment Details
// ----------------------------------------------------------------
export const UpdatePaymentDetailsSchema = z.object({
  bankName: z.string().trim().min(2).max(60),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Must be exactly 10 digits'),
  bankAccountName: z.string().trim().min(2).max(80),
  paystackSecretKey: z.string().trim().startsWith('sk_').optional(),
});

// ----------------------------------------------------------------
// Step 5 — Business Profile (branding + contact + hours)
// ----------------------------------------------------------------
const DayHoursSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM e.g. 08:00'),
  close: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM e.g. 18:00'),
  active: z.boolean(),
});

export const UpdateBusinessProfileSchema = z.object({
  // Branding
  name: z.string().trim().min(2).max(80).optional(),
  tagline: z.string().trim().max(120).optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  logoUrl: z.string().trim().url('Must be a valid URL').optional(),
  faviconUrl: z.string().trim().url().optional(),

  // Contact
  businessPhone: z.string().trim().max(20).optional(),
  businessEmail: z.string().trim().toLowerCase().email().optional(),
  businessAddress: z.string().trim().max(200).optional(),
  websiteUrl: z.string().trim().url().optional(),

  // Operating hours
  operatingHours: z
    .object({
      mon: DayHoursSchema,
      tue: DayHoursSchema,
      wed: DayHoursSchema,
      thu: DayHoursSchema,
      fri: DayHoursSchema,
      sat: DayHoursSchema,
      sun: DayHoursSchema,
    })
    .optional(),

  // Operational settings
  minOrderValue: z.number().min(0).optional(),
  estimatedDeliveryMin: z.number().min(1).max(240).optional(),
  estimatedDeliveryMax: z.number().min(1).max(480).optional(),
  currencySymbol: z.string().max(3).optional(),

  // Custom message templates
  messageTemplates: z
    .object({
      greeting: z.string().max(500).optional(),
      orderReceived: z.string().max(500).optional(),
      quoteFooter: z.string().max(200).optional(),
      closedMessage: z.string().max(300).optional(),
    })
    .optional(),
});

// ----------------------------------------------------------------
// Inferred types
// ----------------------------------------------------------------
export type SignupInput = z.infer<typeof SignupSchema>;
export type ConnectWhatsAppInput = z.infer<typeof ConnectWhatsAppSchema>;
export type ConfigureServicesInput = z.infer<typeof ConfigureServicesSchema>;
export type UpdatePaymentInput = z.infer<typeof UpdatePaymentDetailsSchema>;
export type UpdateBusinessProfileInput = z.infer<typeof UpdateBusinessProfileSchema>;
