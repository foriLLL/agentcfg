import type { AgentName, ConfigAvailabilityEntry, ConfigFileRuntimeResponse } from './api';
import { AgentConfigIcon } from './AgentConfigIcon';
import { formatDate } from './view-model';

type LocalConfigAgentSummaryProps = {
  readonly configAgent: AgentName | null;
  readonly targetTitle: string | undefined;
  readonly targetCopy: string | undefined;
  readonly availability: ConfigAvailabilityEntry | undefined;
  readonly configFile: ConfigFileRuntimeResponse | null;
  readonly configPathModeLabel: string;
};

export function LocalConfigAgentSummary({
  configAgent,
  targetTitle,
  targetCopy,
  availability,
  configFile,
  configPathModeLabel,
}: LocalConfigAgentSummaryProps) {
  const files = resolveAssociatedFiles(configFile, availability);

  return (
    <div className="config-agent-summary" id="config-agent-panel" role="tabpanel" aria-labelledby={configAgent === null ? undefined : `config-agent-${configAgent}-tab`}>
      <div>
        <span>当前 Agent</span>
        <strong className="config-agent-summary__title">
          {configAgent !== null && <AgentConfigIcon agent={configAgent} />}
          <span>{targetTitle ?? '请选择 Agent'}</span>
        </strong>
      </div>
      <div>
        <span>主配置入口</span>
        <strong>{configFile?.path ?? availability?.path ?? (configAgent === null ? '未选择' : configPathModeLabel)}</strong>
      </div>
      <div className="config-associated-files">
        <span>关联配置文件</span>
        {files.length === 0 ? (
          <p>选择上方 Agent 后显示它会读取或写入的配置文件。</p>
        ) : (
          <ul>
            {files.map((file) => (
              <li key={`${file.role}:${file.path}`}>
                <strong>{file.label}</strong>
                <code>{file.path}</code>
                <small>{formatAssociatedFileStatus(file)}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p>
        {configAgent === null
          ? '选择上方 Agent 后，可以加载、编辑并保存它的原生配置。'
          : availability?.available === false
            ? availability.reason ?? '未找到可编辑的配置文件。'
            : configFile === null
              ? '尚未加载配置文件；可直接使用默认检测路径，或填写下方路径覆盖。'
              : `已加载 ${targetCopy ?? '配置原文'}。`}
      </p>
    </div>
  );
}

function resolveAssociatedFiles(
  configFile: ConfigFileRuntimeResponse | null,
  availability?: ConfigAvailabilityEntry,
): ConfigAvailabilityEntry['files'] {
  const files = availability?.files ?? [];

  if (configFile === null || files.some((file) => file.path === configFile.path)) {
    return files;
  }

  return [
    {
      role: 'primary',
      label: '主配置',
      path: configFile.path,
      exists: true,
      format: configFile.format,
      updatedAt: configFile.updatedAt,
    },
    ...files.filter((file) => file.role !== 'primary'),
  ];
}

function formatAssociatedFileStatus(file: ConfigAvailabilityEntry['files'][number]): string {
  const format = file.format === undefined ? '配置' : file.format.toUpperCase();
  if (!file.exists) {
    return file.role === 'generated-env' ? `${format}，应用时会创建` : `${format}，未找到`;
  }
  return file.updatedAt === undefined ? `${format}，已存在` : `${format}，更新于 ${formatDate(file.updatedAt)}`;
}
