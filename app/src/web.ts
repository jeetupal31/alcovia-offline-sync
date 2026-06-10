// Tiny shims around browser globals so the same code typechecks for
// native + web without pulling in the whole DOM type library.
// On a real phone these are null and the code degrades gracefully.

export const webDoc: any = (globalThis as any).document ?? null;
export const webStorage: any = (globalThis as any).localStorage ?? null;
export const webLocation: any = (globalThis as any).location ?? null;

export function makeUUID(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
