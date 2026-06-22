import { DiffEditor } from '@monaco-editor/react';
import './monaco';

type FileDiffViewerProps = {
  path: string;
  currentContent: string;
  expectedContent: string;
};

export function FileDiffViewer({ path, currentContent, expectedContent }: FileDiffViewerProps) {
  return (
    <section className="file-diff-viewer" aria-label={`${path} 当前内容与应用后内容差异`}>
      <div className="file-diff-viewer__legend" aria-hidden="true">
        <strong>当前内容</strong>
        <strong>应用后内容</strong>
      </div>
      <div className="file-diff-editor">
        <DiffEditor
          original={redactSensitiveContent(currentContent)}
          modified={redactSensitiveContent(expectedContent)}
          language={languageForPath(path)}
          options={{
            automaticLayout: true,
            domReadOnly: true,
            minimap: { enabled: false },
            originalEditable: false,
            readOnly: true,
            renderSideBySide: true,
            scrollBeyondLastLine: false,
            wordWrap: 'off',
          }}
          theme="vs"
        />
      </div>
    </section>
  );
}

function redactSensitiveContent(content: string): string {
  return content
    .replace(/(apiKey\s*[:=]\s*)([\"']?)([^\n,}\"']+)([\"']?)/gi, '$1$2***MASKED***$4')
    .replace(/(OPENAI_API_KEY|ANTHROPIC_API_KEY|API_KEY)(\s*=\s*)([^\n]+)/gi, '$1$2***MASKED***');
}

function languageForPath(path: string): string {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.json') || lowerPath.endsWith('.jsonc') || lowerPath.endsWith('.json5')) {
    return 'json';
  }
  if (lowerPath.endsWith('.toml')) {
    return 'ini';
  }
  if (lowerPath.endsWith('.env')) {
    return 'ini';
  }
  return 'plaintext';
}
