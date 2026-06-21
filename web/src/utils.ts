export function maskApiKey(value: string | undefined | null): string {
  if (!value) return '未设置';
  const trimmed = value.trim();
  if (trimmed === '') return '未设置';
  if (trimmed.length <= 12) return `${trimmed.slice(0, 3)}••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}••••••••••••${trimmed.slice(-6)}`;
}
