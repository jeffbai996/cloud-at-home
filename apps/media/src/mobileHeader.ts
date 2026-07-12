export type MobileHeaderScrollIntent = "hide" | "show" | null;

export function mobileHeaderScrollIntent(previousY: number, currentY: number): MobileHeaderScrollIntent {
  if (currentY <= 48) return "show";
  const delta = currentY - previousY;
  if (delta >= 12) return "hide";
  if (delta <= -12) return "show";
  return null;
}
