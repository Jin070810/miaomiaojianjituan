export function inferGiftKind(name: string) {
  return /(?:现金|红包)/u.test(name.trim()) ? "CASH" as const : "PHYSICAL" as const;
}
