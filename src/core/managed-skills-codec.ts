import {
  ManagedAgentSkillsError,
  type ManagedAgentSkillsManifestFile,
  type ManagedAgentSkillsOperation,
} from './managed-skills-types';

export function encodeSkillContent(content: Buffer): Pick<ManagedAgentSkillsManifestFile, 'encoding' | 'content'> {
  const text = content.toString('utf8');
  if (!text.includes('\u0000') && Buffer.from(text, 'utf8').equals(content)) {
    return { encoding: 'utf8', content: text };
  }
  return { encoding: 'base64', content: content.toString('base64') };
}

export function decodeSkillContent(file: ManagedAgentSkillsManifestFile): Buffer {
  return file.encoding === 'utf8' ? Buffer.from(file.content, 'utf8') : Buffer.from(file.content, 'base64');
}

export function previewSkillContent(content: Buffer): string {
  return encodeSkillContent(content).content;
}

export function previewSkillContentKind(content: Buffer): 'text' | 'binary' {
  return encodeSkillContent(content).encoding === 'utf8' ? 'text' : 'binary';
}

export function decodeOperationExpectedFile(operation: ManagedAgentSkillsOperation): { content: Buffer; mode: number } {
  if (operation.expectedContent === undefined) {
    throw new ManagedAgentSkillsError(`Operation ${operation.path} does not include expected content.`);
  }
  if (operation.expectedMode === undefined) {
    throw new ManagedAgentSkillsError(`Operation ${operation.path} does not include expected mode.`);
  }
  if (operation.contentKind === 'binary') {
    return { content: Buffer.from(operation.expectedContent, 'base64'), mode: operation.expectedMode };
  }
  return { content: Buffer.from(operation.expectedContent, 'utf8'), mode: operation.expectedMode };
}
