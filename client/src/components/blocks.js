// Visual email builder: block model → bulletproof table-based HTML that renders in Gmail, Outlook and mobile clients.

export const BLOCK_TYPES = [
  { type: 'logo', label: 'Logo' },
  { type: 'heading', label: 'Heading' },
  { type: 'text', label: 'Text' },
  { type: 'image', label: 'Image' },
  { type: 'button', label: 'Button' },
  { type: 'divider', label: 'Divider' },
  { type: 'spacer', label: 'Spacer' },
  { type: 'social', label: 'Social links' },
  { type: 'footer', label: 'Footer' },
];

const uid = () => Math.random().toString(36).slice(2, 9);

export function newBlock(type) {
  const base = { id: uid(), type, bg: '', padding: 16 };
  switch (type) {
    case 'logo': return { ...base, src: '', alt: 'Aristokrat Travel', width: 180, align: 'center', link: 'https://aristokrat.az', padding: 24 };
    case 'heading': return { ...base, text: 'Your headline here', size: 26, color: '#1e3a5f', align: 'left', bold: true };
    case 'text': return { ...base, text: 'Hello {{first_name}},\n\nWrite your message here. Use **bold** for emphasis and [link text](https://aristokrat.az) for links.', size: 15, color: '#374151', align: 'left', lineHeight: 1.6 };
    case 'image': return { ...base, src: '', alt: '', width: 100, align: 'center', link: '', radius: 8 };
    case 'button': return { ...base, text: 'Discover more', url: 'https://aristokrat.az', color: '#ffffff', bgColor: '#1e3a5f', align: 'center', radius: 6, size: 15, padding: 20 };
    case 'divider': return { ...base, color: '#e5e7eb', thickness: 1, padding: 12 };
    case 'spacer': return { ...base, height: 24, padding: 0 };
    case 'social': return { ...base, align: 'center', color: '#1e3a5f', links: [
      { network: 'Website', url: 'https://aristokrat.az' },
      { network: 'Instagram', url: 'https://instagram.com/' },
      { network: 'Facebook', url: 'https://facebook.com/' },
      { network: 'LinkedIn', url: 'https://linkedin.com/' },
      { network: 'WhatsApp', url: 'https://wa.me/994552551514' },
    ] };
    case 'footer': return { ...base, bg: '#f3f6fb', color: '#6b7280', size: 12, align: 'center', padding: 24,
      text: '**Aristokrat Travel Azerbaijan**\n{{company_address}}\nYou are receiving this email because of your business relationship with us.' };
    default: return base;
  }
}

export function defaultDesign() {
  return {
    settings: { bgColor: '#eef2f7', contentBg: '#ffffff', width: 600, font: 'Arial, Helvetica, sans-serif', linkColor: '#1d4ed8' },
    blocks: [newBlock('logo'), newBlock('heading'), newBlock('text'), newBlock('button'), newBlock('divider'), newBlock('social'), newBlock('footer')],
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|\{\{)/i.test(s)) return s;
  return `https://${s}`;
};

/** Minimal formatting: **bold**, *italic*, [text](url), line breaks. Variables are left untouched. */
export function inlineFormat(text, linkColor) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(safeUrl(u.replace(/&amp;/g, '&')))}" style="color:${linkColor};text-decoration:underline;">${t}</a>`);
}

function paragraphs(text, style, linkColor) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p, i, arr) => `<p style="margin:0 0 ${i === arr.length - 1 ? 0 : 14}px 0;${style}">${inlineFormat(p, linkColor).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function blockInner(b, s) {
  const font = `font-family:${s.font};`;
  switch (b.type) {
    case 'logo': {
      if (!b.src) return `<div style="${font}font-size:22px;font-weight:bold;color:#1e3a5f;text-align:${b.align};">${esc(b.alt || 'Your logo')}</div>`;
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" width="${Number(b.width) || 180}" style="display:inline-block;max-width:100%;height:auto;border:0;outline:none;">`;
      return `<div style="text-align:${b.align};">${b.link ? `<a href="${esc(safeUrl(b.link))}" target="_blank">${img}</a>` : img}</div>`;
    }
    case 'heading':
      return `<h2 style="margin:0;${font}font-size:${Number(b.size) || 26}px;line-height:1.25;color:${b.color};text-align:${b.align};font-weight:${b.bold ? 'bold' : 'normal'};">${inlineFormat(b.text, s.linkColor).replace(/\n/g, '<br>')}</h2>`;
    case 'text':
      return paragraphs(b.text, `${font}font-size:${Number(b.size) || 15}px;line-height:${b.lineHeight || 1.6};color:${b.color};text-align:${b.align};`, s.linkColor);
    case 'image': {
      if (!b.src) return '';
      const w = Math.min(100, Math.max(10, Number(b.width) || 100));
      const px = Math.round(((s.width || 600) - 2 * (b.padding || 0)) * (w / 100));
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" width="${px}" style="display:inline-block;width:${w}%;max-width:${px}px;height:auto;border:0;border-radius:${b.radius || 0}px;">`;
      return `<div style="text-align:${b.align};">${b.link ? `<a href="${esc(safeUrl(b.link))}" target="_blank">${img}</a>` : img}</div>`;
    }
    case 'button': {
      const align = b.align === 'center' ? 'center' : b.align === 'right' ? 'right' : 'left';
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="margin:${align === 'center' ? '0 auto' : '0'};"><tr>
<td align="center" bgcolor="${b.bgColor}" style="border-radius:${b.radius}px;background:${b.bgColor};">
<a href="${esc(safeUrl(b.url))}" target="_blank" style="display:inline-block;padding:12px 28px;${font}font-size:${Number(b.size) || 15}px;font-weight:bold;color:${b.color};text-decoration:none;border-radius:${b.radius}px;">${esc(b.text)}</a>
</td></tr></table>`;
    }
    case 'divider':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:${Number(b.thickness) || 1}px solid ${b.color};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
    case 'spacer':
      return `<div style="height:${Number(b.height) || 24}px;line-height:${Number(b.height) || 24}px;font-size:0;">&nbsp;</div>`;
    case 'social': {
      const links = (b.links || []).filter((l) => l.url && l.network);
      return `<div style="text-align:${b.align};${font}font-size:13px;">${links
        .map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" style="display:inline-block;margin:4px 6px;padding:6px 12px;border:1px solid ${b.color};border-radius:16px;color:${b.color};text-decoration:none;">${esc(l.network)}</a>`)
        .join('')}</div>`;
    }
    case 'footer':
      return `${paragraphs(b.text, `${font}font-size:${Number(b.size) || 12}px;line-height:1.6;color:${b.color};text-align:${b.align};`, b.color)}
<p style="margin:12px 0 0 0;${font}font-size:${Number(b.size) || 12}px;color:${b.color};text-align:${b.align};"><a href="{{unsubscribe_url}}" style="color:${b.color};text-decoration:underline;">Unsubscribe</a> from future marketing emails.</p>`;
    default:
      return '';
  }
}

export function renderBlock(b, settings) {
  const inner = blockInner(b, settings);
  if (!inner) return '';
  const pad = b.type === 'spacer' ? 0 : Number(b.padding ?? 16);
  return `<tr><td style="padding:${pad}px ${Math.max(pad, 24)}px;${b.bg ? `background:${b.bg};` : ''}">${inner}</td></tr>`;
}

export function renderDesign(design, { companyAddress = '' } = {}) {
  const s = { ...defaultDesign().settings, ...(design?.settings || {}) };
  const rows = (design?.blocks || []).map((b) => renderBlock(b, s)).join('\n');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">
<title></title>
<style>
  body{margin:0;padding:0;-webkit-text-size-adjust:100%;}
  img{border:0;line-height:100%;outline:none;text-decoration:none;}
  @media only screen and (max-width:620px){ .em-container{width:100% !important;} .em-container td{padding-left:16px !important;padding-right:16px !important;} }
</style></head>
<body style="margin:0;padding:0;background:${s.bgColor};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${s.bgColor};"><tr><td align="center" style="padding:24px 8px;">
<table role="presentation" class="em-container" width="${s.width}" cellpadding="0" cellspacing="0" border="0" style="width:${s.width}px;max-width:100%;background:${s.contentBg};border-radius:8px;overflow:hidden;">
${rows}
</table>
</td></tr></table>
</body></html>`;
  return html.replace(/\{\{\s*company_address\s*\}\}/g, esc(companyAddress).replace(/\n/g, '<br>'));
}

// ---------------- Starter templates ----------------
function design(blocks) {
  return { settings: defaultDesign().settings, blocks: blocks.map((b) => ({ ...newBlock(b.type), ...b, id: uid() })) };
}

const opener = (title, text) => [
  { type: 'logo' },
  { type: 'heading', text: title },
  { type: 'text', text },
];
const closer = (btn, url = 'https://aristokrat.az') => [
  { type: 'button', text: btn, url },
  { type: 'text', text: 'Best regards,\n**Aristokrat Travel Azerbaijan**\nDestination Management Company · Baku', size: 14 },
  { type: 'divider' },
  { type: 'social' },
  { type: 'footer' },
];

export const STARTER_TEMPLATES = [
  {
    name: 'Azerbaijan Travel Packages', category: 'Travel Packages', subject: 'Discover Azerbaijan with Aristokrat Travel, {{first_name}}',
    preheader: 'Ready-made packages for Baku, Gabala, Sheki and more',
    design: design([...opener('Discover Azerbaijan — packages for your clients', 'Hello {{first_name}},\n\nWe are pleased to introduce our latest Azerbaijan travel packages for {{company_name}}: from the Old City of Baku and the Flame Towers to the mountains of Gabala and the silk-road heritage of Sheki.\n\n**What we offer:**\n• City breaks in Baku (3–5 nights)\n• Baku + Gabala + Sheki circuits\n• Guaranteed departures and private tours\n• 195+ vehicles and 15+ years on the ground'), { type: 'image' }, ...closer('View packages')]),
  },
  {
    name: 'Hotel Offers', category: 'Hotels', subject: 'Special hotel rates in Baku for {{company_name}}',
    preheader: 'Contracted rates at leading 4★ and 5★ hotels',
    design: design([...opener('Exclusive hotel rates in Baku', 'Dear {{first_name}},\n\nWe have secured special contracted rates at leading 4★ and 5★ hotels in Baku and the regions. Ideal for FIT, groups and incentive travel.\n\nReply to this email with your dates and number of rooms, and we will send a tailored quotation within 24 hours.'), { type: 'image' }, ...closer('Request a quote', 'mailto:info@aristokrat.az')]),
  },
  {
    name: 'B2B Travel Partnerships', category: 'B2B', subject: 'Partnership proposal: Aristokrat Travel × {{company_name}}',
    preheader: 'Your reliable DMC partner in Azerbaijan, Georgia, Uzbekistan and Kazakhstan',
    design: design([...opener('Let’s grow together in the Caucasus & Central Asia', 'Dear {{first_name}},\n\nAristokrat Travel is a Baku-based Destination Management Company operating in Azerbaijan, Georgia, Uzbekistan and Kazakhstan. We would be glad to become the local partner of {{company_name}} in {{country}}.\n\n**Why partners choose us:**\n• Net B2B rates and fast quotations\n• Own fleet of 195+ vehicles\n• 24/7 operations team\n• MICE, groups, FIT and tailor-made tours'), ...closer('Visit our B2B portal', 'https://b2baristokrat.com')]),
  },
  {
    name: 'MICE Services', category: 'MICE', subject: 'Conferences, incentives and events in Baku',
    preheader: 'End-to-end MICE management in Azerbaijan',
    design: design([...opener('MICE in Azerbaijan, fully managed', 'Hello {{first_name}},\n\nFrom 50-person incentives to 1,000-delegate conferences, our MICE team handles venues, accommodation, transfers, technical production, gala dinners and excursions.\n\nTell us about your next event and we will prepare a full proposal.'), { type: 'image' }, ...closer('Plan your event')]),
  },
  {
    name: 'Seasonal Promotions', category: 'Promotions', subject: '{{first_name}}, this season’s best offers in Azerbaijan',
    preheader: 'Limited-time rates for the coming season',
    design: design([...opener('This season’s best offers', 'Hello {{first_name}},\n\nOur seasonal promotion is now open. Book before the deadline to secure special rates on hotels, tours and transfers for your clients.\n\n**Offer valid for a limited time.**'), ...closer('See the offers')]),
  },
  {
    name: 'New Year Offers', category: 'Promotions', subject: 'Celebrate New Year in Baku ✨',
    preheader: 'Festive packages, gala dinners and winter tours',
    design: design([...opener('New Year in Baku', 'Dear {{first_name}},\n\nGive your clients an unforgettable New Year in Baku: festive city lights, gala dinners, winter tours to Shahdag and Gabala, and comfortable hotels in the heart of the city.\n\nAsk us for New Year package prices and availability.'), { type: 'image' }, ...closer('Get New Year prices')]),
  },
  {
    name: 'Summer Packages', category: 'Travel Packages', subject: 'Summer 2027 in Azerbaijan — packages for {{company_name}}',
    preheader: 'Caspian beaches, mountains and city breaks',
    design: design([...opener('Summer in Azerbaijan', 'Hello {{first_name}},\n\nSummer packages are ready: Caspian sea resorts, cool mountain escapes in Gabala and Guba, and vibrant Baku city breaks. Family, group and FIT options available.'), { type: 'image' }, ...closer('Explore summer packages')]),
  },
  {
    name: 'Corporate Travel', category: 'Corporate', subject: 'Corporate travel support in Azerbaijan for {{company_name}}',
    preheader: 'Business trips, transfers and VIP services',
    design: design([...opener('Corporate travel, handled', 'Dear {{first_name}},\n\nWe support companies with business travel to Azerbaijan: hotel bookings at corporate rates, airport transfers, VIP meet & greet, interpreters and meeting rooms.\n\nOne point of contact, 24/7 support.'), ...closer('Contact our corporate team', 'mailto:info@aristokrat.az')]),
  },
];
