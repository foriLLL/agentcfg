import type { ReactNode } from 'react';
import type { AgentConfig, ConfigAvailabilityEntry, RuntimeStateSummary } from './api';
import type { CommandCenterStatusSnapshot } from './useCommandCenterStatus';
import {
  cacheReadinessBadge,
  conflictBaselineBadge,
  gistConnectionBadge,
  remoteRevisionBadge,
  syncServiceBadge,
} from './strings';
import { formatDate } from './view-model';

type StatusRailProps = {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly commandStatus: CommandCenterStatusSnapshot;
  readonly configAvailability: readonly ConfigAvailabilityEntry[];
};

export function StatusRail({ commandStatus, configAvailability, runtimeState }: StatusRailProps) {
  const availableAgents = configAvailability.filter((entry) => entry.available).length;
  const gistBadge = gistConnectionBadge(runtimeState);
  const serviceBadge = syncServiceBadge(commandStatus.service?.installed);

  return (
    <div className="status-rail">
      <section className="rail-card">
        <div className="rail-card__heading">
          <h2>状态面板</h2>
          <span className={`status-badge status-badge--${gistBadge.tone}`}>{gistBadge.label}</span>
        </div>
        <dl className="rail-list">
          <Detail label="Gist" value={runtimeState?.gist.id ?? '未设置'} />
          <Detail label="缓存" value={runtimeState?.cache.updatedAt === undefined ? cacheReadinessBadge(runtimeState).label : formatDate(runtimeState.cache.updatedAt)} />
          <Detail label="远端版本" value={runtimeState?.remote?.revision ?? '未返回'} />
        </dl>
      </section>

      <section className="rail-card">
        <h2>同步对象</h2>
        <dl className="rail-list">
          <Detail label="规则文件" value={`${commandStatus.ruleFiles?.existingCount ?? 0}/${commandStatus.ruleFiles?.totalCount ?? 3} 本地存在`} />
          <Detail label="Agent Skills" value={`${commandStatus.skills?.fileCount ?? 0} 个文件`} />
          <Detail label="本地配置" value={`${availableAgents}/${configAvailability.length || 5} Agent 可用`} />
        </dl>
      </section>

      <section className="rail-card">
        <h2>自动同步</h2>
        <dl className="rail-list">
          <Detail label="设置" value={runtimeState?.autoSync?.enabled === true ? `每 ${runtimeState.autoSync.intervalMinutes} 分钟` : '未启用'} />
          <Detail label="系统服务" value={serviceBadge.label} />
          <Detail label="最近结果" value={runtimeState?.lastSyncRun?.status ?? '暂无'} />
        </dl>
      </section>

      <section className="rail-card">
        <h2>运行状态</h2>
        {commandStatus.error === undefined ? (
          <dl className="rail-list">
            <Detail label="状态读取" value={commandStatus.isLoading ? '刷新中' : '正常'} />
            <Detail label="最近同步" value={runtimeState?.lastSyncRun?.completedAt === undefined ? '暂无记录' : formatDate(runtimeState.lastSyncRun.completedAt)} />
          </dl>
        ) : (
          <p className="rail-error">{commandStatus.error}</p>
        )}
      </section>

      <RailDetails runtimeState={runtimeState} />
    </div>
  );
}

function RailDetails({ runtimeState }: { readonly runtimeState: RuntimeStateSummary | null }) {
  const gistBadge = gistConnectionBadge(runtimeState);
  const cacheBadge = cacheReadinessBadge(runtimeState);
  const remoteBadge = remoteRevisionBadge(runtimeState);
  const conflictBadge = conflictBaselineBadge(runtimeState);

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
          <Detail label="页面含义" value={runtimeState?.conflict.present ? '这是上次拉取或保存时记录的远端版本，用于以后与本地缓存比对。' : '拉取或保存远端配置后，会在这里记录版本基线供后续比较。'} />
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
      <Detail label="API 密钥" value={provider?.apiKey.value ?? '未设置'} />
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
