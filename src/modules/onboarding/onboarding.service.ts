import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import * as bcrypt from 'bcrypt';

// ----------------------------------------------------------------
// OnboardingService
//
// Handles the full journey of a new business signing up.
//
// Step 1: signup()             — create business + owner admin account
// Step 2: connectWhatsApp()    — link their Meta phone number
// Step 3: configureServices()  — set services and areas
// Step 4: updatePaymentDetails() — add bank / Paystack credentials
//
// After step 4 they're ready to go live.
// ----------------------------------------------------------------
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(private readonly prisma: PrismaService) {}

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
        'Welcome! Your ErrandsBuddy account has been created. ' +
        'Log in with your email and password to continue setup.',
    };
  }

  // ----------------------------------------------------------------
  // Step 2 — Connect WhatsApp
  //
  // Called after signup, when the business owner pastes their
  // Meta phone number ID and access token.
  // Requires a valid JWT (they must be logged in).
  // This just saves the credentials — the Flow is registered
  // automatically by FlowsService on the next server restart
  // or can be triggered manually.
  // ----------------------------------------------------------------
  async connectWhatsApp(
    businessId: string,
    input: {
      whatsappPhoneId: string;
      whatsappToken: string;
      whatsappVerifyToken: string;
    },
  ): Promise<{ message: string }> {
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

    return {
      message:
        'WhatsApp connected! Your Flow will be registered automatically. ' +
        'Next: configure your services and areas.',
    };
  }

  // ----------------------------------------------------------------
  // Step 3 — Configure Services and Areas
  //
  // The business sets which services they offer and which
  // areas they cover. This populates the WhatsApp Flow dropdown.
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

      // Bank details
      bankName?: string;
      bankAccountNumber?: string;
      bankAccountName?: string;
    },
  ): Promise<{ message: string }> {
    // Save service config
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
      },
      update: {
        services: input.services,
        areas: input.areas,
        welcomeText: input.welcomeText,
        headerImageUrl: input.headerImageUrl,
        serviceChargePercent: input.serviceChargePercent ?? 0,
        vatPercent: input.vatPercent ?? 0,
      },
    });

    // Save bank details on the business
    if (input.bankName || input.bankAccountNumber || input.bankAccountName) {
      await this.prisma.business.update({
        where: { id: businessId },
        data: {
          bankName: input.bankName,
          bankAccountNumber: input.bankAccountNumber,
          bankAccountName: input.bankAccountName,
        },
      });
    }

    this.logger.log(
      `Services configured for business ${businessId}: ` +
        `${input.services
          .filter((s) => s.active)
          .map((s) => s.id)
          .join(', ')}`,
    );

    return {
      message: 'Services and areas configured. Your business is ready to go live! 🎉',
    };
  }

  // ----------------------------------------------------------------
  // Step 4 — Update payment details
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
        completed: !!(
          business.serviceConfig &&
          Array.isArray(business.serviceConfig.services) &&
          (business.serviceConfig.services as any[]).length > 0
        ),
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
