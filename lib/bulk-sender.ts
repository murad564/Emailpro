import prisma from "./prisma";
import { sendBrevoEmail } from "./brevo";
import { buildTrackedEmail, buildPlainText } from "./email-tracker";
import { contactHasAnyTag, decodeTags } from "./tags";
import type { Contact, Segment } from "@prisma/client";

const BATCH_SIZE     = 10;
const BATCH_DELAY_MS = 500;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getSegmentContacts(segment: Segment, userId: string): Promise<Contact[]> {
  const all = await prisma.contact.findMany({ where: { userId } });
  const filterTags = decodeTags(segment.filterTags);
  if (segment.filterType === "all" || filterTags.length === 0) return all;
  return all.filter((c) => contactHasAnyTag(c.tags, filterTags));
}

export async function sendCampaign(
  campaignId: string,
  userId: string,
): Promise<{ totalSent: number; errors: number; skipped: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId },
    include: { segment: true },
  });

  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status === "sending" || campaign.status === "sent")
    throw new Error(`Campaign is already ${campaign.status}`);

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "sending" } });

  let contacts: Contact[];
  if (campaign.segmentId && campaign.segment) {
    contacts = await getSegmentContacts(campaign.segment, userId);
  } else {
    contacts = await prisma.contact.findMany({ where: { userId } });
  }

  // Remove globally unsubscribed
  const unsubscribed = await prisma.unsubscribe.findMany({
    where: { email: { in: contacts.map((c) => c.email) } },
    select: { email: true },
  });
  const unsubSet = new Set(unsubscribed.map((u) => u.email));
  const targets  = contacts.filter((c) => !unsubSet.has(c.email));

  const userSettings = await prisma.userSettings.findUnique({ where: { userId } });
  const brevoApiKey  = userSettings?.brevoApiKey || process.env.BREVO_API_KEY;
  if (!brevoApiKey) throw new Error("Brevo API key is not configured. Add it in Settings.");

  const dailyLimit = userSettings?.dailySendLimit ?? 300;
  const skipped    = Math.max(0, targets.length - dailyLimit);
  const capped     = targets.slice(0, dailyLimit);

  let totalSent = 0, errors = 0;

  for (let i = 0; i < capped.length; i += BATCH_SIZE) {
    const batch = capped.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(
      batch.map(async (contact) => {
        try {
          // Create the "sent" event — its trackingId becomes the open-pixel ID
          const sentEvent = await prisma.emailEvent.create({
            data: { type: "sent", campaignId, contactId: contact.id, email: contact.email },
          });

          // Ensure unsubscribe token exists
          const unsub = await prisma.unsubscribe.upsert({
            where: { email_campaignId: { email: contact.email, campaignId } },
            update: {},
            create: { email: contact.email, contactId: contact.id, campaignId },
          });

          const { html, linkMap } = buildTrackedEmail(
            campaign.htmlContent,
            sentEvent.trackingId,
            unsub.token,
            campaignId,
          );

          // Persist link tracking stubs
          if (Object.keys(linkMap).length > 0) {
            await prisma.emailEvent.createMany({
              data: Object.entries(linkMap).map(([trackingId, url]) => ({
                type: "link_registered",
                campaignId,
                contactId: contact.id,
                email: contact.email,
                trackingId,
                url,
              })),
            });
          }

          const toName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

          const result = await sendBrevoEmail({
            fromName:   campaign.fromName,
            fromEmail:  campaign.fromEmail,
            toEmail:    contact.email,
            toName:     toName || undefined,
            replyTo:    campaign.replyTo ?? undefined,
            subject:    campaign.subject,
            html,
            text:       buildPlainText(html),
            campaignId,
            tags:       [campaignId, sentEvent.trackingId],
          }, brevoApiKey);

          // Store Brevo message ID for webhook correlation
          if (result.messageId) {
            await prisma.emailEvent.update({
              where: { id: sentEvent.id },
              data: { resendId: result.messageId }, // reusing resendId column for messageId
            });
          }

          totalSent++;
        } catch (err) {
          console.error(`Send failed for ${contact.email}:`, err);
          errors++;
        }
      }),
    );

    if (i + BATCH_SIZE < capped.length) await sleep(BATCH_DELAY_MS);
  }

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "sent", sentAt: new Date(), totalSent },
  });

  return { totalSent, errors, skipped };
}
