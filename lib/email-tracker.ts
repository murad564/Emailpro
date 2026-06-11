const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Returns true only for URLs Brevo will accept — i.e. a real public hostname, not localhost/LAN.
function isPublicUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    if (hostname === "localhost") return false;
    if (hostname === "127.0.0.1" || hostname === "0.0.0.0") return false;
    if (hostname.endsWith(".local")) return false;
    // Private IPv4 ranges
    if (/^10\./.test(hostname)) return false;
    if (/^192\.168\./.test(hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface TrackingIds {
  openTrackingId: string;
  unsubscribeToken: string;
  linkMap: Record<string, string>;
}

export function buildTrackedEmail(
  rawHtml: string,
  openTrackingId: string,
  unsubscribeToken: string,
  campaignId: string,
): { html: string; linkMap: Record<string, string> } {
  const trackingEnabled = isPublicUrl(APP_URL);
  const linkMap: Record<string, string> = {};
  let linkIndex = 0;

  // Wrap every href for click tracking — only when APP_URL is a public host
  const htmlWithLinks = trackingEnabled
    ? rawHtml.replace(/href="([^"]+)"/gi, (match, url: string) => {
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
      })
    : rawHtml;

  // Unsubscribe footer — included only when we have a valid public URL for the link
  const footer = trackingEnabled
    ? `\n<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  <p>You received this email because you are subscribed to our mailing list.</p>
  <p><a href="${APP_URL}/unsubscribe/${unsubscribeToken}" style="color:#6b7280;">Unsubscribe</a></p>
</div>`
    : `\n<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
  <p>You received this email because you are subscribed to our mailing list.</p>
</div>`;

  // Open-tracking pixel — only when APP_URL is public (Brevo rejects localhost src values)
  const pixel = trackingEnabled
    ? `<img src="${APP_URL}/api/track/open/${openTrackingId}" width="1" height="1" alt="" style="display:none;" />`
    : "";

  return { html: `${htmlWithLinks}${footer}${pixel}`, linkMap };
}

export function buildPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
