export interface LpaData {
  smdpAddress: string;
  activationCode: string;
  confirmationCode: string;
}

function decodeMaybeUri(value: string): string {
  if (/%24|%3A|%25/i.test(value)) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function parseLpaCode(raw: string): LpaData | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) return null;

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('carddata=') || trimmed.includes('lpa=')) {
    try {
      const parsed = new URL(trimmed);
      const nested =
        parsed.searchParams.get('carddata') ||
        parsed.searchParams.get('lpa') ||
        parsed.searchParams.get('url');
      if (nested && nested !== trimmed) {
        return parseLpaCode(decodeMaybeUri(nested));
      }
    } catch {
      return null;
    }
  }

  const match = trimmed.match(/^(?:LPA:)?1\$([^$\s<>"]+)\$([^$\s<>"]+)(?:\$([^$\s<>"]*?))?(?:\$.*)?$/i);
  if (!match) return null;

  const smdpAddress = match[1].trim();
  const activationCode = match[2].trim();
  const confirmationCode = (match[3] || '').trim();
  if (!smdpAddress || !activationCode || /[$\s]/.test(smdpAddress) || /[$\s]/.test(activationCode)) {
    return null;
  }

  return { smdpAddress, activationCode, confirmationCode };
}

export function sanitizePhoneNumber(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  const cleaned = raw
    .trim()
    .replace(/[^0-9+\-\s().]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return cleaned.replace(/\D/g, '').length >= 3 ? cleaned : '';
}

export function formatDisplayPhone(raw: string): string {
  const cleaned = sanitizePhoneNumber(raw);
  if (!cleaned) return '';
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 10 && !cleaned.startsWith('+')) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return cleaned;
}

export function encodePhoneParam(raw: string | null | undefined): string {
  const cleaned = sanitizePhoneNumber(raw);
  if (!cleaned) return '';
  const digits = cleaned.replace(/\D/g, '');
  return cleaned.startsWith('+') ? `+${digits}` : digits;
}

export function formatLpaString(lpa: LpaData): string {
  return `LPA:1$${lpa.smdpAddress}$${lpa.activationCode}${lpa.confirmationCode ? '$' + lpa.confirmationCode : ''}`;
}

export function buildAppleEsimUrl(lpa: LpaData): string {
  return `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(formatLpaString(lpa))}`;
}

export function parseSafeAppleActivationUrl(rawUrl: string | null | undefined): { appleUrl: string; lpa: LpaData } | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Accept either a raw LPA string or an official Apple eSIM provisioning URL
  if (/^(?:LPA:)?1\$/i.test(trimmed)) {
    const lpa = parseLpaCode(trimmed);
    if (!lpa) return null;
    return { appleUrl: buildAppleEsimUrl(lpa), lpa };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'esimsetup.apple.com') {
      return null;
    }
    if (parsed.pathname !== '/esim_qrcode_provisioning') {
      return null;
    }
    const carddata = parsed.searchParams.get('carddata');
    if (!carddata) return null;
    const lpa = parseLpaCode(carddata);
    if (!lpa) return null;
    return { appleUrl: buildAppleEsimUrl(lpa), lpa };
  } catch {
    return null;
  }
}
