import type { ConfigAvailabilityEntry, RuntimeStateSummary } from './api';
import type { CommandCenterStatusSnapshot } from './useCommandCenterStatus';
import { cacheReadinessBadge, gistConnectionBadge, syncServiceBadge } from './strings';
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
    </div>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
