// Numbers typed into the tools: values in decimal unless written $1F or 0x1F,
// addresses always in hex, as the 6502's documentation and FCEUX write them.

const HEX_PREFIX = /^(?:\$|0x)/i;

/** A whole number typed as decimal, $hex or 0xhex, sign allowed; null when it is not one. */
export function parseValueText(text: string): number | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  let value: number;
  if (HEX_PREFIX.test(body)) {
    const digits = body.replace(HEX_PREFIX, "");
    if (!/^[0-9a-f]+$/i.test(digits)) return null;
    value = parseInt(digits, 16);
  } else {
    if (!/^[0-9]+$/.test(body)) return null;
    value = parseInt(body, 10);
  }
  return negative ? -value : value;
}

/** An address typed in hex, with or without $ or 0x; null when it is not one. */
export function parseAddressText(text: string): number | null {
  const digits = text.trim().replace(HEX_PREFIX, "");
  return /^[0-9a-f]{1,4}$/i.test(digits) ? parseInt(digits, 16) : null;
}
