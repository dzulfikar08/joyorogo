// Who runs JoyoRogo and how to reach them: the one place the public pages (/my/privasi, /my/privacy, /my/syarat,
// /my/terms, the /my landing) read it from. Plain data on purpose: blog/pages.ts imports it at build time.

export const CONTACT_EMAIL = "dzulfikar@joyorogo.com";

export const COMPANY_NAME = "PT Joyo Digitama Solusi";
export const COMPANY_REGION = "Malang, Jawa Timur, Indonesia";

/**
 * Street address of the company. Not in the repo: the owner must supply it. Empty means the address line is not
 * rendered on the Malaysian notices (the PDPA notice and the e-trade seller block need it before launch).
 */
export const COMPANY_ADDRESS = "";

/**
 * PT Joyo Digitama Solusi's WhatsApp number, taken from the sibling Voltrus Indonesian landing; it is the only
 * company WhatsApp number in the filesystem. The owner should confirm it is the number to publish for JoyoRogo.
 */
export const WHATSAPP_NUMBER = "6289680839591";
export const WHATSAPP_DISPLAY = "+62 896-8083-9591";

/** wa.me link, with an optional prefilled message. */
export function whatsappUrl(message?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** Prefilled opening message for the Malay pages. */
export const WHATSAPP_MESSAGE_MS = "Hai JoyoRogo, saya ada soalan tentang ";
/** Prefilled opening message for the English pages. */
export const WHATSAPP_MESSAGE_EN = "Hi JoyoRogo, I have a question about ";

/** Company line: name, region, and the street address only when it is known. */
export function companyLine(): string {
  return [COMPANY_NAME, COMPANY_ADDRESS, COMPANY_REGION].filter(Boolean).join(", ");
}
