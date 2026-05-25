import prisma from "./prisma";

export const DEMO_USER_ID = "local-demo-user-00000000000001";
export const DEMO_USER_EMAIL = "demo@emailpro.local";

export async function getCurrentUser() {
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    create: { id: DEMO_USER_ID, email: DEMO_USER_EMAIL },
    update: {},
  });
  return { id: DEMO_USER_ID, email: DEMO_USER_EMAIL };
}
