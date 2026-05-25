import { PrismaClient } from "@prisma/client";
import { subDays } from "date-fns";

const prisma = new PrismaClient();

const DEMO_USER_ID    = "local-demo-user-00000000000001";
const DEMO_USER_EMAIL = "demo@emailpro.local";

const FIRST_NAMES = ["Alice","Bob","Carol","David","Eva","Frank","Grace","Henry","Isabel","James","Karen","Liam","Mia","Noah","Olivia","Paul","Quinn","Rachel","Sam","Tara"];
const LAST_NAMES  = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Wilson","Moore","Taylor","Anderson","Thomas","Jackson","White","Harris","Martin"];
const TAG_GROUPS  = [
  ["newsletter"],["newsletter","vip"],["newsletter","en"],["newsletter","ru"],
  ["vip","enterprise"],["newsletter","trial"],["newsletter","paid"],["newsletter","churned"],
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function enc(tags: string[]): string { return JSON.stringify(tags); }

async function main() {
  console.log("🌱 Seeding EmailPro (SQLite)…");

  await prisma.emailEvent.deleteMany({ where: { campaign: { userId: DEMO_USER_ID } } });
  await prisma.unsubscribe.deleteMany({ where: { contact: { userId: DEMO_USER_ID } } });
  await prisma.campaign.deleteMany({ where: { userId: DEMO_USER_ID } });
  await prisma.segment.deleteMany({ where: { userId: DEMO_USER_ID } });
  await prisma.contact.deleteMany({ where: { userId: DEMO_USER_ID } });
  await prisma.user.deleteMany({ where: { id: DEMO_USER_ID } });

  await prisma.user.create({ data: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL } });

  for (let i = 0; i < 80; i++) {
    const fn = FIRST_NAMES[i % FIRST_NAMES.length];
    const ln = LAST_NAMES[i % LAST_NAMES.length];
    const domain = ["gmail.com","yahoo.com","outlook.com","company.io","example.com"][i % 5];
    await prisma.contact.create({
      data: {
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@${domain}`,
        firstName: fn, lastName: ln,
        tags: enc(pick(TAG_GROUPS)),
        userId: DEMO_USER_ID,
        subscribedAt: subDays(new Date(), Math.floor(Math.random() * 180)),
      },
    });
  }
  console.log("✓ 80 contacts");

  const seg = await prisma.segment.create({
    data: { name: "All Newsletter", filterType: "tags", filterTags: enc(["newsletter"]), userId: DEMO_USER_ID },
  });
  await prisma.segment.createMany({
    data: [
      { name: "VIP",            filterType: "tags", filterTags: enc(["vip"]),        userId: DEMO_USER_ID },
      { name: "All Contacts",   filterType: "all",  filterTags: enc([]),             userId: DEMO_USER_ID },
    ],
  });
  console.log("✓ 3 segments");

  await prisma.campaign.createMany({
    data: [
      {
        name: "Welcome Series #1", subject: "Welcome to the community! 🎉",
        fromName: "EmailPro Team", fromEmail: "hello@emailpro.dev",
        htmlContent: "<h1>Welcome!</h1><p>Glad to have you with us.</p>",
        status: "sent", sentAt: subDays(new Date(), 14),
        userId: DEMO_USER_ID, segmentId: seg.id,
        totalSent: 65, totalDelivered: 63, totalOpens: 31, totalUniqueOpens: 28,
        totalClicks: 14, totalUniqueClicks: 12, totalBounces: 2, totalUnsubscribes: 1,
      },
      {
        name: "May Newsletter", subject: "Your May digest",
        fromName: "EmailPro Team", fromEmail: "hello@emailpro.dev",
        htmlContent: "<h2>May Newsletter</h2><p>Here's what's new this month.</p>",
        status: "sent", sentAt: subDays(new Date(), 7),
        userId: DEMO_USER_ID, segmentId: seg.id,
        totalSent: 65, totalDelivered: 62, totalOpens: 22, totalUniqueOpens: 20,
        totalClicks: 9, totalUniqueClicks: 8, totalBounces: 3, totalUnsubscribes: 0,
      },
      {
        name: "June Newsletter", subject: "Summer updates are here",
        fromName: "EmailPro Team", fromEmail: "hello@emailpro.dev",
        htmlContent: "<h2>June Newsletter</h2><p>Summer is here!</p>",
        status: "draft", userId: DEMO_USER_ID,
      },
    ],
  });
  console.log("✓ 3 campaigns (2 sent, 1 draft)");
  console.log("\n✅ Done! Run: npm run dev → http://localhost:3000");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
