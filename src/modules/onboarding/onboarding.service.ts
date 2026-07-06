import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
// NOTE: adjust this import path to wherever your FlowsService actually lives
import { FlowsService } from '@modules/whatsapp/flows/flows.service';

// ----------------------------------------------------------------
// OnboardingService
//
// Handles the full journey of a new business signing up.
//
// Step 1: signup()             — create business + owner admin account
// Step 2: connectWhatsApp()    — link their Meta phone number + auto-register Flow
// Step 3: configureServices()  — set services, areas, and flow behaviour toggles
// Step 4: updatePaymentDetails() — add bank / Paystack credentials
//
// After step 4 they're ready to go live.
// ----------------------------------------------------------------
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flowsService: FlowsService,
  ) {}

  // ----------------------------------------------------------------
  // Step 1 — Business Signup
  //
  // Creates the business record and the owner's admin account
  // in a single transaction. If anything fails, nothing is saved.
  //
  // Returns the new business ID and admin ID so the owner can
  // immediately continue to step 2 without logging in again.
  // ----------------------------------------------------------------
  async signup(input: {
    // Business details
    businessName: string;
    slug: string;
    tagline?: string;
    primaryColor?: string;

    // Owner account
    ownerName: string;
    ownerEmail: string;
    ownerPassword: string;

    // Optional: their plan
    plan?: 'STARTER' | 'GROWTH' | 'PRO';
  }): Promise<{
    businessId: string;
    adminId: string;
    message: string;
  }> {
    // Check slug is available
    const existingSlug = await this.prisma.business.findUnique({
      where: { slug: input.slug },
    });
    if (existingSlug) {
      throw new ConflictException(
        `The name "${input.slug}" is already taken. Try a different one.`,
      );
    }

    // Check email is available
    const existingEmail = await this.prisma.admin.findUnique({
      where: { email: input.ownerEmail },
    });
    if (existingEmail) {
      throw new ConflictException(`An account with email ${input.ownerEmail} already exists.`);
    }

    // Validate password strength
    if (input.ownerPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    const passwordHash = await bcrypt.hash(input.ownerPassword, 12);

    // Create business + admin in one transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the business
      const business = await tx.business.create({
        data: {
          name: input.businessName,
          slug: input.slug.toLowerCase().replace(/\s+/g, '-'),
          tagline: input.tagline,
          primaryColor: input.primaryColor ?? '#1a8a5e',
          plan: (input.plan ?? 'STARTER') as any,
          isActive: true,
        },
      });

      // Create the owner admin account
      const admin = await tx.admin.create({
        data: {
          name: input.ownerName,
          email: input.ownerEmail,
          passwordHash,
          role: 'BUSINESS_OWNER' as any,
          businessId: business.id,
          isActive: true,
        },
      });

      // Create empty ServiceConfig so the business can configure later
      await tx.serviceConfig.create({
        data: {
          businessId: business.id,
          services: [],
          areas: [],
        },
      });

      return { business, admin };
    });

    this.logger.log(
      `New business signed up: ${result.business.name} (${result.business.id}) ` +
        `— owner: ${result.admin.email}`,
    );

    return {
      businessId: result.business.id,
      adminId: result.admin.id,
      message:
        'Welcome! Your account has been created. ' +
        'Log in with your email and password to continue setup.',
    };
  }

  // ----------------------------------------------------------------
  // Step 2 — Connect WhatsApp
  //
  // Called after signup, when the business owner pastes their
  // Meta phone number ID and access token.
  // Requires a valid JWT (they must be logged in).
  //
  // FIX: Flow registration is now triggered explicitly right here,
  // instead of waiting on "next server restart". If registration
  // fails, we don't fail the whole request — WhatsApp is still
  // connected, the owner can retry Flow registration separately
  // (e.g. via a "resync flow" action in settings).
  // ----------------------------------------------------------------
  async connectWhatsApp(
    businessId: string,
    input: {
      whatsappPhoneId: string;
      whatsappToken: string;
      whatsappVerifyToken: string;
    },
  ): Promise<{ message: string; flowRegistered: boolean }> {
    // Check no other business is using this phone number
    const existing = await this.prisma.business.findFirst({
      where: {
        whatsappPhoneId: input.whatsappPhoneId,
        id: { not: businessId },
      },
    });

    if (existing) {
      throw new ConflictException('This WhatsApp number is already connected to another business.');
    }

    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        whatsappPhoneId: input.whatsappPhoneId,
        whatsappToken: input.whatsappToken,
        whatsappVerifyToken: input.whatsappVerifyToken,
      },
    });

    this.logger.log(`WhatsApp connected for business ${businessId}`);

    // FIX: trigger Flow registration immediately instead of relying on restart.
    // Adjust the method name/signature below to match your actual FlowsService API
    // (e.g. resyncFlowForBusiness, registerFlow, etc).
    let flowRegistered = false;
    try {
      await this.flowsService.resyncFlowForBusiness(businessId);
      flowRegistered = true;
      this.logger.log(`WhatsApp Flow registered for business ${businessId}`);
    } catch (err: any) {
      this.logger.error(
        `Flow registration failed for business ${businessId}: ${err.message}. ` +
          `WhatsApp is still connected — Flow can be retried later.`,
      );
    }

    return {
      message: flowRegistered
        ? 'WhatsApp connected and your Flow is registered! Next: configure your services and areas.'
        : 'WhatsApp connected. Flow registration is still pending — we will retry automatically, or contact support.',
      flowRegistered,
    };
  }

  // ----------------------------------------------------------------
  // Step 3 — Configure Services and Areas
  //
  // The business sets which services they offer, which areas they
  // cover, and Flow display/behaviour options. This populates the
  // WhatsApp Flow dropdown and screens.
  //
  // FIX: bank details removed from this method entirely — they only
  // ever belong to updatePaymentDetails(). The previous bank-handling
  // block here was dead code since ConfigureServicesSchema never
  // passed those fields through validation.
  //
  // FIX: serviceBanners / showDeliveryEta / collectBudget / collectStore
  // are now actually persisted — previously validated by the Zod schema
  // but silently dropped before reaching the database.
  // ----------------------------------------------------------------
  async configureServices(
    businessId: string,
    input: {
      services: {
        id: string; // e.g. "GROCERY"
        label: string; // e.g. "Grocery Shopping"
        description: string;
        active: boolean;
      }[];
      areas: {
        id: string; // e.g. "WUSE_2"
        label: string; // e.g. "Wuse 2"
      }[];
      welcomeText?: string;
      headerImageUrl?: string;
      serviceChargePercent?: number;
      vatPercent?: number;

      // Per-service banner images — { "GROCERY": "https://...", ... }
      serviceBanners?: Record<string, string>;

      // Flow behaviour toggles
      showDeliveryEta?: boolean;
      collectBudget?: boolean;
      collectStore?: boolean;
    },
  ): Promise<{ message: string }> {
    await this.prisma.serviceConfig.upsert({
      where: { businessId },
      create: {
        businessId,
        services: input.services,
        areas: input.areas,
        welcomeText: input.welcomeText,
        headerImageUrl: input.headerImageUrl,
        serviceChargePercent: input.serviceChargePercent ?? 0,
        vatPercent: input.vatPercent ?? 0,
        serviceBanners: input.serviceBanners ?? undefined,
        showDeliveryEta: input.showDeliveryEta ?? true,
        collectBudget: input.collectBudget ?? true,
        collectStore: input.collectStore ?? false,
      },
      update: {
        services: input.services,
        areas: input.areas,
        welcomeText: input.welcomeText,
        headerImageUrl: input.headerImageUrl,
        serviceChargePercent: input.serviceChargePercent ?? 0,
        vatPercent: input.vatPercent ?? 0,
        serviceBanners: input.serviceBanners ?? undefined,
        showDeliveryEta: input.showDeliveryEta ?? true,
        collectBudget: input.collectBudget ?? true,
        collectStore: input.collectStore ?? false,
      },
    });

    this.logger.log(
      `Services configured for business ${businessId}: ` +
        `${input.services
          .filter((s) => s.active)
          .map((s) => s.id)
          .join(', ')} — ${input.areas.length} area(s)`,
    );

    return {
      message: 'Services and areas configured. Your business is ready to go live! 🎉',
    };
  }

  // ----------------------------------------------------------------
  // Step 4 — Update payment details
  //
  // This is the ONLY place bank/Paystack details are written.
  // ----------------------------------------------------------------
  async updatePaymentDetails(
    businessId: string,
    input: {
      bankName: string;
      bankAccountNumber: string;
      bankAccountName: string;
      paystackSecretKey?: string;
    },
  ): Promise<{ message: string }> {
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        bankName: input.bankName,
        bankAccountNumber: input.bankAccountNumber,
        bankAccountName: input.bankAccountName,
        ...(input.paystackSecretKey && {
          paystackSecretKey: input.paystackSecretKey,
        }),
      },
    });

    this.logger.log(`Payment details updated for business ${businessId}`);

    return { message: 'Payment details saved successfully ✅' };
  }

  // ----------------------------------------------------------------
  // getOnboardingStatus — shows which steps are complete
  // Shown on the dashboard so the owner knows what's left
  //
  // FIX: step 3 now also requires at least one area, not just one
  // service — matches the step title "Configure services and areas".
  // ----------------------------------------------------------------
  async getOnboardingStatus(businessId: string): Promise<{
    steps: {
      step: number;
      title: string;
      completed: boolean;
      action: string;
    }[];
    isComplete: boolean;
  }> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: { serviceConfig: true },
    });

    if (!business) throw new BadRequestException('Business not found');

    const hasServices =
      !!business.serviceConfig &&
      Array.isArray(business.serviceConfig.services) &&
      (business.serviceConfig.services as any[]).length > 0;

    const hasAreas =
      !!business.serviceConfig &&
      Array.isArray(business.serviceConfig.areas) &&
      (business.serviceConfig.areas as any[]).length > 0;

    const steps = [
      {
        step: 1,
        title: 'Create your account',
        completed: true, // they're logged in so this is done
        action: 'Done ✅',
      },
      {
        step: 2,
        title: 'Connect WhatsApp',
        completed: !!(business.whatsappPhoneId && business.whatsappToken),
        action: 'Go to Settings → WhatsApp',
      },
      {
        step: 3,
        title: 'Configure services and areas',
        completed: hasServices && hasAreas,
        action: 'Go to Settings → Services',
      },
      {
        step: 4,
        title: 'Add bank account details',
        completed: !!(business.bankName && business.bankAccountNumber),
        action: 'Go to Settings → Payments',
      },
      {
        step: 5,
        title: 'Register WhatsApp Flow',
        completed: !!business.flowId,
        action: 'Automatic after connecting WhatsApp — or contact support',
      },
    ];

    const isComplete = steps.every((s) => s.completed);

    return { steps, isComplete };
  }
}