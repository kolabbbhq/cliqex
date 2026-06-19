"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new client_1.PrismaClient();
async function main() {
    const existing = await prisma.admin.count();
    if (existing > 0) {
        console.log('⚠️  Admins already exist — skipping seed');
        return;
    }
    const passwordHash = await bcrypt.hash('Admin@1234', 12);
    const admin = await prisma.admin.create({
        data: {
            name: 'ErrandsBuddy Admin',
            email: 'admin@errandsbuddy.com',
            passwordHash,
            role: client_1.AdminRole.SUPER_ADMIN,
        },
    });
    console.log('✅ Super admin created:');
    console.log(`   Email:    ${admin.email}`);
    console.log(`   Password: Admin@1234`);
    console.log(`   ⚠️  Change this password immediately after first login!`);
}
main()
    .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map