import type { ReactNode } from 'react';
import type { AgentConfig, AgentName, ConfigAvailabilityEntry, RuntimeStateSummary } from './api';
import type { CommandCenterStatusSnapshot } from './useCommandCenterStatus';
import { AgentConfigIcon } from './AgentConfigIcon';
import { agentLabel, formatDate } from './view-model';
import { maskApiKey } from './utils';
import {
  cacheReadinessBadge,
  conflictBaselineBadge,
  gistConnectionBadge,
  remoteRevisionBadge,
  syncServiceBadge,
} from './strings';

type StatusRailProps = {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly commandStatus: CommandCenterStatusSnapshot;
  readonly configAvailability: readonly ConfigAvailabilityEntry[];
};

export function StatusRail({ commandStatus, configAvailability, runtimeState }: StatusRailProps) {
  const availableAgents = configAvailability.filter((entry) => entry.available).length;
  const gistBadge = gistConnectionBadge(runtimeState);
  const cacheBadge = cacheReadinessBadge(runtimeState);
  const serviceBadge = syncServiceBadge(commandStatus.service?.installed);

  return (
    <div className="status-rail status-drawer">
      <div className="status-drawer__summary">
        <span className={`status-badge status-badge--${gistBadge.tone}`}>{gistBadge.label}</span>
        <span className={`status-badge status-badge--${cacheBadge.tone}`}>{cacheBadge.label}</span>
        <span className="status-badge status-badge--ready">{availableAgents} Agent 可用</span>
        {runtimeState?.autoSync?.enabled && (
          <span className="status-badge status-badge--ready">自动同步开</span>
        )}
      </div>
      
      {commandStatus.error && (
        <p className="rail-error">{commandStatus.error}</p>
      )}

      <div className="status-drawer__details">
        <RailDetails runtimeState={runtimeState} commandStatus={commandStatus} configAvailability={configAvailability} />
      </div>
    </div>
  );
}

function RailDetails({ runtimeState, commandStatus, configAvailability }: StatusRailProps) {
  const gistBadge = gistConnectionBadge(runtimeState);
  const cacheBadge = cacheReadinessBadge(runtimeState);
  const remoteBadge = remoteRevisionBadge(runtimeState);
  const conflictBadge = conflictBaselineBadge(runtimeState);
  const serviceBadge = syncServiceBadge(commandStatus.service?.installed);

  return (
    <details className="rail-card rail-card--collapsible" id="status-details">
      <summary>
        <span>详细元数据</span>
        <small>Gist 来源、远端版本、缓存配置与基线</small>
      </summary>
      <div className="rail-details">
        <RailDetailGroup
          eyebrow="来源"
          title="Gist 与缓存"
          tone={gistBadge.tone}
          badge={gistBadge.label}
        >
          <Detail label="Gist 状态" value={runtimeState?.gist.present ? '已存在' : '缺失'} />
          <Detail label="Gist ID" value={runtimeState?.gist.id ?? '未设置'} />
          <Detail label="缓存状态" value={cacheBadge.label} />
          <Detail label="缓存更新时间" value={formatDate(runtimeState?.cache.updatedAt)} />
        </RailDetailGroup>

        <RailDetailGroup
          eyebrow="远端"
          title="版本元数据"
          tone={remoteBadge.tone}
          badge={remoteBadge.label}
        >
          {runtimeState?.remote ? (
            <>
              <Detail label="Revision" value={runtimeState.remote.revision ?? '未返回'} />
              <Detail label="ETag" value={runtimeState.remote.etag ?? '未返回'} />
              <Detail label="拉取时间" value={formatDate(runtimeState.remote.pulledAt)} />
            </>
          ) : (
            <RailEmpty copy="初始化 Gist 后拉取，即可记录 Revision 与缓存时间戳。" />
          )}
        </RailDetailGroup>

        <RailDetailGroup
          eyebrow="同步"
          title="自动同步状态"
          tone={serviceBadge.tone}
          badge={serviceBadge.label}
        >
          <Detail label="设置" value={runtimeState?.autoSync?.enabled === true ? `每 ${runtimeState.autoSync.intervalMinutes} 分钟` : '未启用'} />
          <Detail label="系统服务" value={serviceBadge.label} />
          <Detail label="最近结果" value={runtimeState?.lastSyncRun?.status ?? '暂无'} />
          <Detail label="最近同步" value={runtimeState?.lastSyncRun?.completedAt === undefined ? '暂无记录' : formatDate(runtimeState.lastSyncRun.completedAt)} />
        </RailDetailGroup>

        <RailDetailGroup
          eyebrow="缓存"
          title="完整配置摘要"
          tone={cacheBadge.tone}
          badge={runtimeState?.cache.config ? '显示完整值' : cacheBadge.label}
        >
          {runtimeState?.cache.config ? (
            <RailConfigSummary config={runtimeState.cache.config} />
          ) : (
            <RailEmpty copy="从已连接的 Gist 拉取后，可在此预览完整运行时值。" />
          )}
        </RailDetailGroup>

        <RailDetailGroup
          eyebrow="基线"
          title="远端基线元数据"
          tone={conflictBadge.tone}
          badge={conflictBadge.label}
        >
          <Detail label="基线状态" value={runtimeState?.conflict.present ? '已保存远端基线元数据' : '尚未保存远端基线'} />
          <Detail label="Base revision" value={runtimeState?.conflict.baseRevision ?? '无'} />
          <Detail label="Base ETag" value={runtimeState?.conflict.baseETag ?? '无'} />
        </RailDetailGroup>
      </div>
    </details>
  );
}

function RailDetailGroup({
  badge,
  children,
  eyebrow,
  title,
  tone,
}: {
  readonly badge: string;
  readonly children: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
  readonly tone: 'ready' | 'pending' | 'warning';
}) {
  return (
    <section className="rail-detail-group">
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <span className={`status-badge status-badge--${tone}`}>{badge}</span>
      </header>
      <dl className="rail-list">{children}</dl>
    </section>
  );
}

function RailConfigSummary({ config }: { readonly config: AgentConfig }) {
  const provider = config.providers[config.defaults.provider];
  return (
    <>
      <Detail label="提供方" value={config.defaults.provider} />
      <Detail label="模型" value={config.defaults.model} />
      <Detail label="Base URL" value={provider?.baseURL ?? '未设置'} />
      <Detail label="API 密钥" value={maskApiKey(provider?.apiKey?.value)} />
    </>
  );
}

function RailEmpty({ copy }: { readonly copy: string }) {
  return <p className="rail-empty">{copy}</p>;
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RailAgentAvailability({ entries }: { readonly entries: readonly ConfigAvailabilityEntry[] }) {
  if (entries.length === 0) {
    return null;
  }
  return (
    <ul className="rail-agent-availability" aria-label="本地 Agent 可用性">
      {entries.map((entry) => (
        <li
          key={entry.agent}
          className={`rail-agent-availability__item rail-agent-availability__item--${entry.available ? 'available' : 'missing'}`}
          title={`${agentLabel(entry.agent as AgentName)}：${entry.available ? '已检测到' : '未检测到'}`}
        >
          <AgentConfigIcon agent={entry.agent as AgentName} />
        </li>
      ))}
    </ul>
  );
}
