/**
 * Injects open-tracking pixel and wraps all <a> hrefs for click tracking.
 * Returns modified HTML + an unsubscribe token per contact.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export interface TrackingIds {
  openTrackingId: string;
  unsubscribeToken: string;
  linkMap: Record<string, string>; // linkTrackingId → original url
}

export function buildTrackedEmail(
  rawHtml: string,
  openTrackingId: string,
  unsubscribeToken: string,
  campaignId: string,
): { html: string; linkMap: Record<string, string> } {
  const linkMap: Record<string, string> = {};
  let linkIndex = 0;

  // Wrap every href for click tracking (skip mailto:, unsubscribe links)
  const htmlWithTrackedLinks = rawHtml.replace(
    /href="([^"]+)"/gi,
    (match, url: string) => {
      if (
        url.startsWith("mailto:") ||
        url.includes("/unsubscribe/") ||
        url.includes("/api/track/")
      ) {
        return match;
      }
      const linkTrackingId = `${openTrackingId}-l${linkIndex++}`;
      linkMap[linkTrackingId] = url;
      const trackUrl = `${APP_URL}/api/track/click/${linkTrackingId}?url=${encodeURIComponent(url)}`;
      return `href="${trackUrl}"`;
    },
  );

  // Add unsubscribe footer
  const unsubscribeUrl = `${APP_URL}/unsubscribe/${unsubscribeToken}`;
  const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  <p>You received this email because you are subscribed to our mailing list.</p>
  <p><a href="${unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a></p>
</div>`;

  // Add open-tracking pixel
  const pixelUrl = `${APP_URL}/api/track/open/${openTrackingId}`;
  const pixel = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;

  const finalHtml = `${htmlWithTrackedLinks}${footer}${pixel}`;
  return { html: finalHtml, linkMap };
}

export function buildPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
