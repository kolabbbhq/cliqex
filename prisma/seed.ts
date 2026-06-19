import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding platform...');

  // ----------------------------------------------------------------
  // 1. Create ErrandsBuddy — Tenant #1
  // ----------------------------------------------------------------
  const errandsBuddy = await prisma.business.upsert({
    where: { slug: 'errandsbuddy' },
    update: {},
    create: {
      name:    'ErrandsBuddy',
      slug:    'errandsbuddy',
      tagline: 'Your personal shopping & errand service in Abuja',

      // These come from your .env — fill in real values
      whatsappPhoneId:     process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
      whatsappToken:       process.env.WHATSAPP_ACCESS_TOKEN    ?? '',
      whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN    ?? '',
      flowId:              process.env.WHATSAPP_FLOW_ID         ?? null,

      bankName:          'Opay',
      bankAccountNumber: '8012345678',      // ← replace with real account
      bankAccountName:   'ErrandsBuddy Ltd',

      primaryColor: '#1a8a5e',
      plan:         'GROWTH',
      isActive:     true,
    },
  });
  console.log(`✅ Business created: ${errandsBuddy.name} (${errandsBuddy.id})`);

  // ----------------------------------------------------------------
  // 2. Create ErrandsBuddy ServiceConfig
  //    — services they offer and Abuja areas they cover
  // ----------------------------------------------------------------
  await prisma.serviceConfig.upsert({
    where: { businessId: errandsBuddy.id },
    update: {},
    create: {
      businessId: errandsBuddy.id,

      services: [
        { id: 'GROCERY',  label: 'Grocery Shopping', description: 'We shop and deliver your groceries',    active: true  },
        { id: 'ERRAND',   label: 'Run an Errand',     description: 'Pickup, delivery, pharmacy & more',    active: true  },
        { id: 'CLEANING', label: 'Book Cleaning',     description: 'Home or office cleaning service',      active: true  },
      ],

      areas: [
        { id: 'ASOKORO',      label: 'Asokoro'      },
        { id: 'MAITAMA',      label: 'Maitama'      },
        { id: 'WUSE',         label: 'Wuse'         },
        { id: 'WUSE_2',       label: 'Wuse 2'       },
        { id: 'GARKI',        label: 'Garki'        },
        { id: 'GARKI_2',      label: 'Garki 2'      },
        { id: 'GWARINPA',     label: 'Gwarinpa'     },
        { id: 'JABI',         label: 'Jabi'         },
        { id: 'UTAKO',        label: 'Utako'        },
        { id: 'KUBWA',        label: 'Kubwa'        },
        { id: 'LIFECAMP',     label: 'Life Camp'    },
        { id: 'KADO',         label: 'Kado'         },
        { id: 'DURUMI',       label: 'Durumi'       },
        { id: 'LUGBE',        label: 'Lugbe'        },
        { id: 'GALADIMAWA',   label: 'Galadimawa'   },
        { id: 'LOKOGOMA',     label: 'Lokogoma'     },
        { id: 'NBORA',        label: 'Nbora'        },
        { id: 'DAWAKI',       label: 'Dawaki'       },
        { id: 'KARMO',        label: 'Karmo'        },
        { id: 'KARU',         label: 'Karu'         },
        { id: 'NYANYA',       label: 'Nyanya'       },
        { id: 'MPAPE',        label: 'Mpape'        },
        { id: 'KATAMPE',      label: 'Katampe'      },
        { id: 'CENTRAL_AREA', label: 'Central Area' },
        { id: 'OTHER',        label: 'Other (specify in address)' },
      ],

      welcomeText:    'Your one-stop solution for everyday needs in Abuja. 🛒',
      headerImageUrl: 'https://errandsbuddy.com/assets/greeting-card.png',
      serviceChargePercent: 0,
      vatPercent:           0,
    },
  });
  console.log('✅ ServiceConfig created for ErrandsBuddy');

  // ----------------------------------------------------------------
  // 3. Create the SUPER_ADMIN (platform owner — you)
  // ----------------------------------------------------------------
  const superAdminHash = await bcrypt.hash('ChangeMe123!', 12);
  const superAdmin = await prisma.admin.upsert({
    where: { email: 'talktoboyveedo@gmail.com' },
    update: {},
    create: {
      name:         'Platform Admin',
      email:        'talktoboyveedo@gmail.com',   // ← change this
      passwordHash: superAdminHash,
      role:         'SUPER_ADMIN',
      businessId:   null,                       // SUPER_ADMIN has no business
      isActive:     true,
    },
  });
  console.log(`✅ Super admin created: ${superAdmin.email}`);

  // ----------------------------------------------------------------
  // 4. Create the ErrandsBuddy admin (business owner)
  // ----------------------------------------------------------------
  const ebAdminHash = await bcrypt.hash('ChangeMe456!', 12);
  const ebAdmin = await prisma.admin.upsert({
    where: { email: 'support@errandsbuddy.com' },
    update: {},
    create: {
      name:         'ErrandsBuddy Admin',
      email:        'support@errandsbuddy.com',   // ← change this
      passwordHash: ebAdminHash,
      role:         'BUSINESS_OWNER',
      businessId:   errandsBuddy.id,
      isActive:     true,
    },
  });
  console.log(`✅ Business admin created: ${ebAdmin.email}`);

  console.log('\n🎉 Seed complete!');
  console.log('─────────────────────────────────────');
  console.log(`Business ID: ${errandsBuddy.id}`);
  console.log('Super admin: admin@yourplatform.com / ChangeMe123!');
  console.log('EB admin:    admin@errandsbuddy.com / ChangeMe456!');
  console.log('─────────────────────────────────────');
  console.log('⚠️  Change both passwords immediately after first login!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());