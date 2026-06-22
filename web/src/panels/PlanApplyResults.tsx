import type {
  ApplyAgentResult,
  ApplyFilePreview,
  ApplyPlanSummary,
  ManagedDiffChange,
  ManagedDiffNotice,
} from '../api';
import { AgentConfigIcon } from '../AgentConfigIcon';
import { FileDiffViewer } from '../FileDiffViewer';
import { applyStatusTone } from '../strings';
import { applyResultNextAction } from '../view-model';
import {
  MANAGED_FIELDS,
  agentLabel,
  agentSupportsManagedFieldDiff,
  fieldLabel,
  formatFileMode,
  formatManagedValue,
  formatStatus,
} from '../view-model';
import { Detail, EmptyCopy, ResultHeading, StatusBadge } from '../widgets';

/**
 * Plan + apply result rendering, shared by LocalConfigPanel and
 * ExecutePanel.
 *
 * These components are pure: they render the API response shapes
 * defined by web/src/api.ts. Every helper that used to live inline in
 * App.tsx (NoticeList, FieldRows, PathList, FilePreviewList,
 * PlanAssociatedFiles) moves here verbatim, with the same DOM and
 * copy. The components are deliberately exported as a pair so other
 * panels can compose either or both without re-implementing the
 * empty/loaded/stale states.
 */

export function PlanResults({
  plans,
  results,
  stale,
}: {
  plans: ApplyPlanSummary[] | null;
  results: ApplyAgentResult[] | null;
  stale: boolean;
}) {
  if (plans === null || results === null) {
    return <EmptyCopy title="需要 dry-run" copy="应用按钮解锁前必须先获得成功计划。" />;
  }

  return (
    <section className="result-stack" aria-label="Dry-run 计划结果">
      <ResultHeading eyebrow="Dry-run 计划" title={stale ? '路径编辑后计划已过期' : '操作摘要'} />
      {plans.map((plan) => (
        <article className="agent-result-card" key={plan.agent}>
          <div className="agent-result-card__header">
            <h3>
              <AgentConfigIcon agent={plan.agent} />
              {agentLabel(plan.agent)}
            </h3>
            <StatusBadge tone={stale ? 'warning' : plan.operationCount > 0 ? 'warning' : 'ready'}>
              {`${plan.operationCount} 项操作`}
            </StatusBadge>
          </div>
          <dl className="detail-list compact-detail-list">
            <Detail label="原生配置" value={plan.configPath} />
            {plan.envPath !== undefined && <Detail label="Env 文件" value={plan.envPath} />}
            <Detail label="状态" value={formatStatus(results.find((result) => result.agent === plan.agent)?.status)} />
          </dl>
          <NoticeList notices={plan.notices} />
          <PlanAssociatedFiles plan={plan} />
          <PathList title="将写入路径" paths={plan.operationPaths} empty="关联文件均无需写入。" />
          {plan.operationPaths.length > 0 && <p className="backup-notice">写入前将自动创建备份。</p>}
          <FilePreviewList previews={plan.filePreviews} />
          {agentSupportsManagedFieldDiff(plan.agent) && <FieldRows changes={plan.changes} />}
        </article>
      ))}
    </section>
  );
}

export function ApplyResults({ results }: { results: ApplyAgentResult[] | null }) {
  if (results === null) {
    return <EmptyCopy title="暂无应用结果" copy="确认写入后，已应用、失败与备份路径会显示在这里。" />;
  }

  const failed = results.filter((r) => r.status === 'failed');
  const applied = results.filter((r) => r.status === 'applied' || r.status === 'would-change');
  const unchanged = results.filter((r) => r.status === 'unchanged' || r.status === 'cancelled');

  return (
    <section className="result-stack" aria-label="应用结果">
      <ResultHeading eyebrow="应用" title={applyResultsTitle(results)} />
      {failed.length > 0 && (
        <div className="apply-group apply-group--failed">
          <h3 className="apply-group__title">失败目标 ({failed.length})</h3>
          <EmptyCopy title="部分目标未完成" copy="逐个查看失败目标的失败原因和下一步；成功或无变化的目标会保留各自状态。" />
          {failed.map((result) => <AgentResultCard key={result.agent} result={result} />)}
        </div>
      )}

      {applied.length > 0 && (
        <div className="apply-group apply-group--applied">
          <h3 className="apply-group__title">已应用目标 ({applied.length})</h3>
          <p className="apply-group__description">未托管字段已保留。如需回滚，请还原备份路径下的文件。</p>
          {applied.map((result) => <AgentResultCard key={result.agent} result={result} />)}
        </div>
      )}

      {unchanged.length > 0 && (
        <div className="apply-group apply-group--unchanged">
          <h3 className="apply-group__title">无变化目标 ({unchanged.length})</h3>
          {unchanged.map((result) => <AgentResultCard key={result.agent} result={result} />)}
        </div>
      )}
    </section>
  );
}

function AgentResultCard({ result }: { result: ApplyAgentResult }) {
  return (
    <article className="agent-result-card">
      <div className="agent-result-card__header">
        <h3>
          <AgentConfigIcon agent={result.agent} />
          {agentLabel(result.agent)}
        </h3>
        <StatusBadge tone={applyStatusTone(result.status)}>{formatStatus(result.status)}</StatusBadge>
      </div>
      <dl className="detail-list compact-detail-list">
        {result.configPath !== undefined && <Detail label="原生配置" value={result.configPath} />}
        {result.envPath !== undefined && <Detail label="Env 文件" value={result.envPath} />}
        {result.error !== undefined && <Detail label="失败原因" value={result.error} />}
        {applyResultNextAction(result) !== undefined && <Detail label="下一步" value={applyResultNextAction(result) ?? ''} />}
      </dl>
      <NoticeList notices={result.notices} />
      <PathList title="备份路径" paths={result.backups} empty="未返回备份。" />
      {agentSupportsManagedFieldDiff(result.agent) && <FieldRows changes={result.changes} />}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type PlanAssociatedFile = {
  readonly label: string;
  readonly path: string;
  readonly willWrite: boolean;
};

function PlanAssociatedFiles({ plan }: { plan: ApplyPlanSummary }) {
  const files = buildPlanAssociatedFiles(plan);

  return (
    <div className="config-associated-files plan-associated-files" aria-label="dry-run 关联文件状态">
      <span>关联文件状态</span>
      <ul>
        {files.map((file) => (
          <li key={`${file.label}:${file.path}`}>
            <strong>{file.label}</strong>
            <code>{file.path}</code>
            <small className={file.willWrite ? 'plan-associated-files__status--write' : undefined}>{file.willWrite ? '将写入' : '本次无写入'}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildPlanAssociatedFiles(plan: ApplyPlanSummary): PlanAssociatedFile[] {
  const operationPaths = new Set(plan.operationPaths);
  const files: PlanAssociatedFile[] = [
    {
      label: '原生配置',
      path: plan.configPath,
      willWrite: operationPaths.has(plan.configPath),
    },
  ];

  if (plan.envPath !== undefined && plan.envPath !== plan.configPath) {
    files.push({
      label: 'Env 文件',
      path: plan.envPath,
      willWrite: operationPaths.has(plan.envPath),
    });
  }

  return files;
}

function NoticeList({ notices }: { notices: ManagedDiffNotice[] }) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="managed-notice-list" role="note" aria-label="托管字段提示">
      <strong>注意事项</strong>
      <ul>
        {notices.map((notice) => (
          <li key={`${notice.field}-${notice.code}`}>
            <span className="managed-notice-list__field">{fieldLabel(notice.field)}</span>
            <code>{notice.code}</code>
            <span>{notice.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function applyResultsTitle(results: ApplyAgentResult[]): string {
  if (results.length > 0 && results.every((result) => result.status === 'unchanged')) {
    return '全部无变化，无需写入';
  }
  if (results.some((result) => result.status === 'failed')) {
    return '写入结果（逐目标检查）';
  }
  return '写入结果';
}

function FieldRows({ changes }: { changes: ManagedDiffChange[] }) {
  return (
    <div className="field-grid">
      {MANAGED_FIELDS.map((field) => {
        const change = changes.find((candidate) => candidate.field === field);
        return (
          <div className={`field-row ${change === undefined ? 'field-row--same' : 'field-row--change'}`} key={field}>
            <span className="field-name">{fieldLabel(field)}</span>
            <span>{formatFieldValue(field, change, 'current')}</span>
            <span>{formatFieldValue(field, change, 'expected')}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatFieldValue(field: string, change: ManagedDiffChange | undefined, side: 'current' | 'expected'): string {
  if (field === 'apiKey' && change !== undefined) {
    return '***MASKED***';
  }
  return formatManagedValue(change, side);
}

function PathList({ title, paths, empty }: { title: string; paths: string[]; empty: string }) {
  return (
    <div className="path-list">
      <strong>{title}</strong>
      {paths.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {paths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilePreviewList({ previews }: { previews: ApplyFilePreview[] }) {
  if (previews.length === 0) {
    return <EmptyCopy title="文件预览无变化" copy="本次 dry-run 不会改写任何文件。" />;
  }

  return (
    <div className="file-preview-list" aria-label="当前与应用后文件内容预览">
      {previews.map((preview) => (
        <article className="file-preview-card" key={`${preview.kind}:${preview.path}`}>
          <div className="file-preview-card__header">
            <div>
              <p className="eyebrow">{preview.kind === 'env' ? 'Env 文件' : '原生配置'}</p>
              <h4>{preview.path}</h4>
            </div>
            {preview.mode !== undefined && <span>{formatFileMode(preview.mode)}</span>}
          </div>
          <FileDiffViewer path={preview.path} currentContent={preview.currentContent ?? ''} expectedContent={preview.expectedContent} />
        </article>
      ))}
    </div>
  );
}
