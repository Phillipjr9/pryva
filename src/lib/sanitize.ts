export function sanitizeString(str: string): string {
  return str.replace(/[<>\"'&]/g, (char) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
      "&": "&amp;",
    };
    return entities[char] || char;
  });
}

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPhone(phone: string): boolean {
  const phoneRegex = /^0[789][01]\d{8}$/;
  return phoneRegex.test(phone);
}

export function isValidAmount(amount: number, min: number = 0, max: number = Infinity): boolean {
  return Number.isFinite(amount) && amount >= min && amount <= max;
}

export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local.length <= 2) return email;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return phone;
  return `***${phone.slice(-4)}`;
}

export function maskCard(code: string): string {
  const parts = code.split("-");
  if (parts.length !== 4) return code;
  return `${parts[0]}-****-****-${parts[3]}`;
}

export function parseJSON<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function safeJSONStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return "{}";
  }
}
