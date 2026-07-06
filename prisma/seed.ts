import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding platform...');

  const errandsBuddy = await prisma.business.upsert({
    where: { slug: 'errandsbuddy' },
    update: {},
    create: {
      name:    'ErrandsBuddy',
      slug:    'errandsbuddy',
      tagline: 'Your personal shopping & errand service in Abuja',

      whatsappPhoneId:     process.env.WHATSAPP_PHONE_NUMBER_ID          ?? '',
      whatsappToken:       process.env.WHATSAPP_ACCESS_TOKEN              ?? '',
      whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN              ?? '',
      flowId:              process.env.WHATSAPP_FLOW_ID                   ?? null,
      flowPrivateKey:      process.env.WHATSAPP_FLOW_PRIVATE_KEY          ?? null,
      wabaId:              process.env.WHATSAPP_BUSINESS_ACCOUNT_ID       ?? null,

      bankName:          'Opay',
      bankAccountNumber: '8012345678',
      bankAccountName:   'ErrandsBuddy Ltd',

      primaryColor: '#1a8a5e',
      plan:         'GROWTH',
      isActive:     true,
    },
  });
  console.log(`✅ Business created: ${errandsBuddy.name} (${errandsBuddy.id})`);

  await prisma.serviceConfig.upsert({
    where:  { businessId: errandsBuddy.id },
    update: {},
    create: {
      businessId: errandsBuddy.id,

      services: [
        // ──────────────────────────────────────────────
        // 1. SHOPPING & ERRANDS
        // ──────────────────────────────────────────────
        {
          id:          'SHOPPING',
          label:       'Shopping & Errands',
          description: 'Need groceries, market items, pharmacy pickups, or a quick errand? We can handle it.',
          active:      true,
          itemized:    true,
          icon:        'https://www.alleplnews.com/wp-content/uploads/2026/06/trolley.png',
          chargeRules: { applyDeliveryFee: true, applyServiceCharge: true, applyVat: false },

          fields: [
            {
              name:       'item_list',
              label:      'What do you need?',
              type:       'textarea',
              required:   true,
              maxLength:  1000,
              helperText: 'List items or describe your errand.\nE.g:\n• Indomie noodles x10\n• Peak Milk 1L x2\n• Pick up package from Wuse Market',
            },
          ],
        },

        // ──────────────────────────────────────────────
        // 2. LOGISTICS
        // ──────────────────────────────────────────────
        {
          id:          'LOGISTICS',
          label:       'Delivery / Logistics',
          description: 'Pickup from one location, deliver to another',
          active:      true,
          itemized:    false,
          icon:        'https://www.alleplnews.com/wp-content/uploads/2026/06/delivery-1.png',
          chargeRules: { applyDeliveryFee: false, applyServiceCharge: false, applyVat: false },
          overrideStandardFields: { hideDeliveryAddress: true },
          fields: [
            {
              name:       'pickup_address',
              label:      'Pickup Address',
              type:       'textarea',
              required:   true,
              maxLength:  300,
              helperText: 'Full address of where we should pick up from',
            },
            {
              name:       'dropoff_address',
              label:      'Drop-off Address',
              type:       'textarea',
              required:   true,
              maxLength:  300,
              helperText: 'Full address of where we should deliver to',
            },
            {
              name:       'item_description',
              label:      'What are we moving?',
              type:       'textarea',
              required:   true,
              maxLength:  500,
              helperText: 'Describe the item(s) — size, fragility, any special handling needed',
            },
          ],
        },

        // ──────────────────────────────────────────────
        // 3. CLEANING
        // ──────────────────────────────────────────────
        {
          id:          'CLEANING',
          label:       'Book a Cleaner',
          description: 'Professional home or office cleaning service',
          active:      true,
          itemized:    false,
          icon:        'https://www.alleplnews.com/wp-content/uploads/2026/06/cleaner.png',
          chargeRules: { applyDeliveryFee: false, applyServiceCharge: false, applyVat: false },
          fields: [
            {
              name:     'cleaning_type',
              label:    'Type of Cleaning',
              type:     'radio',
              required: true,
              options: [
                {
                  id:          'routine_cleaning',
                  title:       'Routine Cleaning',
                  description: 'Regular upkeep — daily or weekly maintenance clean',
                },
                {
                  id:          'deep_cleaning',
                  title:       'Deep Cleaning',
                  description: 'Thorough top-to-bottom clean for every corner',
                },
                {
                  id:          'post_move',
                  title:       'Post-Move Cleaning',
                  description: "Moving in or out? We'll make it fresh and ready",
                },
                {
                  id:          'office_cleaning',
                  title:       'Office Cleaning',
                  description: 'Professional cleaning for commercial spaces',
                },
              ],
            },
            {
              name:       'room_count',
              label:      'Number of Rooms',
              type:       'text',
              required:   true,
              helperText: 'Total rooms to be cleaned (include bathrooms & kitchen)',
            },
            {
              name:       'preferred_date',
              label:      'Preferred Date & Time',
              type:       'text',
              required:   true,
              helperText: 'E.g. Monday 23rd June, 9am — or ASAP',
            },
          ],
        },
      ],

      areas: [
        { id: 'ASOKORO',      label: 'Asokoro',                   deliveryFee: 1500 },
        { id: 'MAITAMA',      label: 'Maitama',                   deliveryFee: 1500 },
        { id: 'WUSE',         label: 'Wuse',                      deliveryFee: 1200 },
        { id: 'WUSE_2',       label: 'Wuse 2',                    deliveryFee: 1200 },
        { id: 'GARKI',        label: 'Garki',                     deliveryFee: 1200 },
        { id: 'GARKI_2',      label: 'Garki 2',                   deliveryFee: 1200 },
        { id: 'GWARINPA',     label: 'Gwarinpa',                  deliveryFee: 2000 },
        { id: 'JABI',         label: 'Jabi',                      deliveryFee: 1500 },
        { id: 'UTAKO',        label: 'Utako',                     deliveryFee: 1500 },
        { id: 'KUBWA',        label: 'Kubwa',                     deliveryFee: 2500 },
        { id: 'LIFECAMP',     label: 'Life Camp',                 deliveryFee: 2000 },
        { id: 'KADO',         label: 'Kado',                      deliveryFee: 1500 },
        { id: 'DURUMI',       label: 'Durumi',                    deliveryFee: 1500 },
        { id: 'LUGBE',        label: 'Lugbe',                     deliveryFee: 2500 },
        { id: 'GALADIMAWA',   label: 'Galadimawa',                deliveryFee: 2000 },
        { id: 'LOKOGOMA',     label: 'Lokogoma',                  deliveryFee: 2000 },
        { id: 'NBORA',        label: 'Nbora',                     deliveryFee: 2500 },
        { id: 'DAWAKI',       label: 'Dawaki',                    deliveryFee: 2000 },
        { id: 'KARMO',        label: 'Karmo',                     deliveryFee: 2000 },
        { id: 'KARU',         label: 'Karu',                      deliveryFee: 2500 },
        { id: 'NYANYA',       label: 'Nyanya',                    deliveryFee: 2500 },
        { id: 'MPAPE',        label: 'Mpape',                     deliveryFee: 3000 },
        { id: 'KATAMPE',      label: 'Katampe',                   deliveryFee: 2000 },
        { id: 'CENTRAL_AREA', label: 'Central Area',              deliveryFee: 1200 },
        { id: 'OTHER',        label: 'Other (specify in address)', deliveryFee: 0    },
      ],

      serviceBanners: {
        SHOPPING:  'https://www.alleplnews.com/wp-content/uploads/2026/06/Shopping-lady_in_the_202606241011-1.jpg',
        LOGISTICS: 'https://www.alleplnews.com/wp-content/uploads/2026/06/The_twobike_men_on_202606241045.jpg',
        CLEANING:  'https://www.alleplnews.com/wp-content/uploads/2026/06/Cleaning-lady_in_the_202606241018.jpg',
      },

      welcomeText:          'Your one-stop solution for everyday needs in Abuja. 🛒',
      headerImageUrl:       'https://www.alleplnews.com/wp-content/uploads/2026/06/WhatsApp-Chat-Intro-scaled.jpg',
      servicePageImageUrl: 'https://www.alleplnews.com/wp-content/uploads/2026/06/Select-service-Header-2.jpg',
      serviceChargePercent: 5,
      vatPercent:           7.5,
    },
  });
  console.log('✅ ServiceConfig created for ErrandsBuddy');

  const superAdminHash = await bcrypt.hash('ChangeMe123!', 12);
  await prisma.admin.upsert({
    where:  { email: 'talktoboyveedo@gmail.com' },
    update: {},
    create: {
      name:         'Platform Admin',
      email:        'talktoboyveedo@gmail.com',
      passwordHash: superAdminHash,
      role:         'SUPER_ADMIN',
      businessId:   null,
      isActive:     true,
    },
  });
  console.log('✅ Super admin created: talktoboyveedo@gmail.com');

  const ebAdminHash = await bcrypt.hash('ChangeMe456!', 12);
  await prisma.admin.upsert({
    where:  { email: 'support@errandsbuddy.com' },
    update: {},
    create: {
      name:         'ErrandsBuddy Admin',
      email:        'support@errandsbuddy.com',
      passwordHash: ebAdminHash,
      role:         'BUSINESS_OWNER',
      businessId:   errandsBuddy.id,
      isActive:     true,
    },
  });
  console.log('✅ Business admin created: support@errandsbuddy.com');

  console.log('\n🎉 Seed complete!');
  console.log('─────────────────────────────────────');
  console.log(`Business ID : ${errandsBuddy.id}`);
  console.log('Super admin : talktoboyveedo@gmail.com / ChangeMe123!');
  console.log('EB admin    : support@errandsbuddy.com / ChangeMe456!');
  console.log('─────────────────────────────────────');
  console.log('⚠️  Change both passwords immediately after first login!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());