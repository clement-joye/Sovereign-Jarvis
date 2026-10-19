export function numberedListPosition(selector: string): number | undefined {
  if (!/^[1-9]\d*$/.test(selector)) return undefined;
  const position = Number(selector);
  return Number.isSafeInteger(position) ? position : undefined;
}
