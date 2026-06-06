import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse as parseJson5 } from 'json5';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { parse as parseTomlDocument, stringify as stringifyTomlDocument } from 'smol-toml';
import { atomicWriteFile, type AtomicWriteFileOptions } from './atomic-write';

export type NativeConfigFormat = 'json' | 'jsonc' | 'json5' | 'toml';

export type NativeConfigValue =
  | string
  | number
  | boolean
  | null
  | NativeConfigValue[]
  | { [key: string]: NativeConfigValue };

export type NativeConfigObject = { [key: string]: NativeConfigValue };

export class NativeConfigParseError extends Error {
  readonly format: NativeConfigFormat;

  constructor(format: NativeConfigFormat, message: string) {
    super(`Malformed ${format.toUpperCase()} native config: ${message}`);
    this.name = 'NativeConfigParseError';
    this.format = format;
  }
}

export class NativeConfigSerializeError extends Error {
  readonly format: NativeConfigFormat;

  constructor(format: NativeConfigFormat, message: string) {
    super(`Cannot serialize ${format.toUpperCase()} native config: ${message}`);
    this.name = 'NativeConfigSerializeError';
    this.format = format;
  }
}

export type WriteNativeConfigOptions = AtomicWriteFileOptions;

export async function readNativeConfig(
  filePath: string,
  format = detectNativeConfigFormat(filePath),
): Promise<NativeConfigValue> {
  return parseNativeConfig(await readFile(filePath, 'utf8'), format);
}

export async function writeNativeConfig(
  filePath: string,
  value: NativeConfigValue,
  format = detectNativeConfigFormat(filePath),
  options: WriteNativeConfigOptions = {},
): Promise<void> {
  await atomicWriteFile(filePath, serializeNativeConfig(value, format), options);
}

export function detectNativeConfigFormat(filePath: string): NativeConfigFormat {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.json') {
    return 'json';
  }

  if (extension === '.jsonc') {
    return 'jsonc';
  }

  if (extension === '.json5') {
    return 'json5';
  }

  if (extension === '.toml') {
    return 'toml';
  }

  throw new NativeConfigParseError('json', `unsupported native config extension '${extension || '(none)'}'`);
}

export function parseNativeConfig(content: string, format: NativeConfigFormat): NativeConfigValue {
  if (format === 'json') {
    return parseJson(content, format);
  }

  if (format === 'jsonc') {
    return parseJsoncDocument(content);
  }

  if (format === 'json5') {
    return parseJson5Document(content);
  }

  return parseToml(content);
}

export function serializeNativeConfig(value: NativeConfigValue, format: NativeConfigFormat): string {
  if (format !== 'toml') {
    return `${JSON.stringify(value, null, 2)}\n`;
  }

  if (!isNativeConfigObject(value)) {
    throw new NativeConfigSerializeError('toml', 'top-level TOML value must be an object');
  }

  try {
    const serialized = stringifyTomlDocument(value);
    return serialized.endsWith('\n') ? serialized : `${serialized}\n`;
  } catch (error) {
    throw new NativeConfigSerializeError('toml', formatParserError(error, 'TOML serializer failed'));
  }
}

function parseJson(content: string, format: NativeConfigFormat): NativeConfigValue {
  try {
    return assertNativeConfigValue(JSON.parse(content), format);
  } catch (error) {
    if (error instanceof NativeConfigParseError) {
      throw error;
    }

    throw new NativeConfigParseError(format, formatParserError(error, 'JSON parser failed'));
  }
}

function parseJsoncDocument(content: string): NativeConfigValue {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    throw new NativeConfigParseError('jsonc', formatJsoncParseError(content, errors[0]));
  }

  return assertNativeConfigValue(parsed, 'jsonc');
}

function parseJson5Document(content: string): NativeConfigValue {
  try {
    return assertNativeConfigValue(parseJson5(content), 'json5');
  } catch (error) {
    if (error instanceof NativeConfigParseError) {
      throw error;
    }

    throw new NativeConfigParseError('json5', formatParserError(error, 'JSON5 parser failed'));
  }
}

function parseToml(content: string): NativeConfigObject {
  try {
    return assertNativeConfigObject(parseTomlDocument(content), 'toml');
  } catch (error) {
    if (error instanceof NativeConfigParseError) {
      throw error;
    }

    throw new NativeConfigParseError('toml', formatParserError(error, 'TOML parser failed'));
  }
}

function assertNativeConfigValue(
  value: unknown,
  format: NativeConfigFormat,
  path = '(root)',
): NativeConfigValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new NativeConfigParseError(format, `number at ${path} must be finite`);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => assertNativeConfigValue(entry, format, `${path}[${index}]`));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, assertNativeConfigValue(entry, format, `${path}.${key}`)]),
    );
  }

  throw new NativeConfigParseError(format, `unsupported value at ${path}`);
}

function assertNativeConfigObject(value: unknown, format: NativeConfigFormat): NativeConfigObject {
  const parsed = assertNativeConfigValue(value, format);

  if (!isNativeConfigObject(parsed)) {
    throw new NativeConfigParseError(format, 'top-level native config must be an object');
  }

  return parsed;
}

function isNativeConfigObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatJsoncParseError(content: string, error: ParseError): string {
  const location = lineColumnForOffset(content, error.offset);
  return `${printParseErrorCode(error.error)} at line ${location.line}, column ${location.column}`;
}

function lineColumnForOffset(content: string, offset: number): { line: number; column: number } {
  const prefix = content.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);

  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function formatParserError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.split('\n')[0];
  }

  return fallback;
}
