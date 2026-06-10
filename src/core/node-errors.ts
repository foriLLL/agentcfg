export function isNodeErrorWithCode<const TCode extends string>(
  error: unknown,
  code: TCode,
): error is NodeJS.ErrnoException & { code: TCode } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
