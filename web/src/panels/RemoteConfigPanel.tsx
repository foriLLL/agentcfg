import type { ReactNode } from 'react';
import { AGENTCFG_SCHEMA_DOCS, type AgentConfigSchemaDoc } from '../../../src/core/schema-docs';
import { OH_MY_OPENAGENT_AGENT_NAMES, OH_MY_OPENAGENT_CATEGORY_NAMES, OH_MY_OPENAGENT_MODEL_VARIANTS } from '../../../src/core/schema';
import type { EditableAgentConfig, OhMyOpenAgentModelAssignment, RuntimeStateSummary } from '../api';
import { BUTTONS, gistConnectionBadge } from '../strings';
import { StatusBadge } from '../widgets';
import type { OhMyOpenAgentAssignmentKind } from './remote-draft';

export type { OhMyOpenAgentAssignmentKind };

export type RemoteConfigView = 'editor' | 'preview';

export type RemoteConfigPanelProps = {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly loadErrorNode: ReactNode;

  // Top-bar status + commands
  readonly remoteStatus: string;
  readonly onLoadRemoteConfig: () => void | Promise<void>;
  readonly onSaveRemoteConfig: () => void | Promise<void>;
  readonly onPull: () => void | Promise<void>;
  readonly isLoadingRemote: boolean;
  readonly isSavingRemote: boolean;
  readonly isPulling: boolean;
  readonly isBusy: boolean;

  // View switch
  readonly remoteConfigView: RemoteConfigView;
  readonly onRemoteConfigViewChange: (view: RemoteConfigView) => void;

  // Editor draft + derived selections
  readonly remoteDraft: EditableAgentConfig;
  readonly remoteProviderIds: string[];
  readonly selectedRemoteProviderId: string;
  readonly selectedRemoteProvider: EditableAgentConfig['providers'][string];
  readonly remoteModelIds: string[];
  readonly selectedRemoteModelId: string;
  readonly selectedRemoteModel: EditableAgentConfig['providers'][string]['models'][string];
  readonly defaultProvider: string;
  readonly defaultProviderModelIds: string[];
  readonly remoteModelReferenceOptions: string[];
  readonly remoteYamlPreview: string;

  // Provider/model mutators (handlers wired in App)
  readonly onSelectRemoteProvider: (providerId: string) => void;
  readonly onAddRemoteProvider: () => void;
  readonly onRemoveRemoteProvider: () => void;
  readonly onRemoteProviderIdChange: (providerId: string) => void;
  readonly onUpdateRemoteProvider: (
    update: (provider: EditableAgentConfig['providers'][string]) => EditableAgentConfig['providers'][string],
  ) => void;

  readonly onSelectRemoteModel: (modelId: string) => void;
  readonly onAddRemoteModel: () => void;
  readonly onRemoveRemoteModel: () => void;
  readonly onRemoteModelIdChange: (modelId: string) => void;
  readonly onUpdateRemoteModel: (
    update: (
      model: EditableAgentConfig['providers'][string]['models'][string],
    ) => EditableAgentConfig['providers'][string]['models'][string],
  ) => void;

  readonly onDefaultRemoteProviderChange: (providerId: string) => void;
  readonly onDefaultRemoteModelChange: (modelId: string) => void;

  readonly onOhMyOpenAgentModelChange: (
    kind: OhMyOpenAgentAssignmentKind,
    name: string,
    modelReference: string,
  ) => void;
  readonly onOhMyOpenAgentVariantChange: (
    kind: OhMyOpenAgentAssignmentKind,
    name: string,
    variant: string,
  ) => void;
  readonly onClearOhMyOpenAgentAssignment: (kind: OhMyOpenAgentAssignmentKind, name: string) => void;
};

/**
 * "远端配置" tab content extracted verbatim from App.tsx.
 *
 * Statelessly renders the existing #remote-panel grid, including the
 * OhMyOpenAgent mapping editor and Schema reference. The state-holding
 * App.tsx still owns the editable draft and computes every derived
 * selection; this panel only emits change events.
 */
export function RemoteConfigPanel(props: RemoteConfigPanelProps) {
  const gistBadge = gistConnectionBadge(props.runtimeState);

  return (
    <section className="dashboard-grid" id="remote-panel" role="tabpanel" aria-labelledby="remote-tab">
      {props.loadErrorNode}
      <article className="card remote-editor-card">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">远端配置</p>
            <h2>用表单生成并保存 agentcfg.yaml，不需要手写 Gist 内容。</h2>
          </div>
          <StatusBadge tone={gistBadge.tone}>{gistBadge.label}</StatusBadge>
        </div>
        <div className="remote-command-panel" aria-label="远端配置操作">
          <button
            className="remote-command-card"
            type="button"
            onClick={props.onLoadRemoteConfig}
            disabled={props.isLoadingRemote || props.isSavingRemote}
          >
            <span>Gist → 表单</span>
            <strong>{props.isLoadingRemote ? BUTTONS.loadRemoteRunning : BUTTONS.loadRemote}</strong>
            <small>只更新当前页面，不写本地 Agent。</small>
          </button>
          <button
            className="remote-command-card remote-command-card--primary"
            type={props.remoteConfigView === 'editor' ? 'submit' : 'button'}
            form={props.remoteConfigView === 'editor' ? 'remote-config-form' : undefined}
            onClick={
              props.remoteConfigView === 'editor'
                ? undefined
                : () => {
                    void props.onSaveRemoteConfig();
                  }
            }
            disabled={props.isSavingRemote}
          >
            <span>表单 → Gist</span>
            <strong>{props.isSavingRemote ? BUTTONS.saveRemoteRunning : BUTTONS.saveRemote}</strong>
            <small>把当前表单写入 agentcfg.yaml。</small>
          </button>
          <button className="remote-command-card" type="button" onClick={props.onPull} disabled={props.isBusy}>
            <span>Gist → 本地缓存</span>
            <strong>{props.isPulling ? BUTTONS.pullCacheRunning : BUTTONS.pullCache}</strong>
            <small>更新 dry-run 和应用使用的本地基线。</small>
          </button>
        </div>
        <div className="config-editor-meta" role="status" aria-live="polite">
          <span>{props.remoteStatus}</span>
          <strong>{props.runtimeState?.gist.id ?? '尚未绑定 Gist'}</strong>
        </div>
        <div className="remote-view-switch" role="group" aria-label="远端配置视图">
          <button
            id="remote-view-editor"
            className={`remote-view-switch__button ${props.remoteConfigView === 'editor' ? 'remote-view-switch__button--active' : ''}`}
            type="button"
            aria-pressed={props.remoteConfigView === 'editor'}
            onClick={() => props.onRemoteConfigViewChange('editor')}
          >
            编辑表单
          </button>
          <button
            id="remote-view-preview"
            className={`remote-view-switch__button ${props.remoteConfigView === 'preview' ? 'remote-view-switch__button--active' : ''}`}
            type="button"
            aria-pressed={props.remoteConfigView === 'preview'}
            onClick={() => props.onRemoteConfigViewChange('preview')}
          >
            预览内容
          </button>
        </div>
        <div className={`remote-config-layout remote-config-layout--${props.remoteConfigView}`}>
          {props.remoteConfigView === 'editor' ? (
            <form
              id="remote-config-form"
              className="remote-config-form"
              onSubmit={(event) => {
                event.preventDefault();
                void props.onSaveRemoteConfig();
              }}
            >
              <section className="remote-editor-section remote-editor-section--full" aria-label="提供商列表">
                <div className="remote-subheading">
                  <div>
                    <p className="eyebrow">提供商</p>
                    <h3>选择或新增提供商</h3>
                  </div>
                  <button className="secondary-action secondary-action--compact" type="button" onClick={props.onAddRemoteProvider} disabled={props.isSavingRemote}>
                    添加提供商
                  </button>
                </div>
                <div className="remote-entity-list" role="list" aria-label="已配置提供商">
                  {props.remoteProviderIds.map((providerId) => (
                    <button
                      className={`remote-entity-chip ${providerId === props.selectedRemoteProviderId ? 'remote-entity-chip--active' : ''}`}
                      type="button"
                      key={providerId}
                      onClick={() => props.onSelectRemoteProvider(providerId)}
                      disabled={props.isSavingRemote}
                    >
                      <strong>{providerId.trim() === '' ? '未命名提供商' : providerId}</strong>
                      <small>{Object.keys(props.remoteDraft.providers[providerId]?.models ?? {}).length} 个模型</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="remote-editor-section" aria-label="提供商字段">
                <div className="remote-subheading">
                  <div>
                    <p className="eyebrow">提供商配置</p>
                    <h3>端点与可见 API Key</h3>
                  </div>
                  <button
                    className="secondary-action secondary-action--compact"
                    type="button"
                    onClick={props.onRemoveRemoteProvider}
                    disabled={props.isSavingRemote || props.remoteProviderIds.length <= 1}
                  >
                    删除提供商
                  </button>
                </div>
                <label htmlFor="remote-provider">
                  提供商 ID
                  <input id="remote-provider" value={props.selectedRemoteProviderId} onChange={(event) => props.onRemoteProviderIdChange(event.target.value)} autoComplete="off" disabled={props.isSavingRemote} />
                </label>
                <label htmlFor="remote-base-url">
                  Base URL
                  <input
                    id="remote-base-url"
                    value={props.selectedRemoteProvider.baseURL}
                    onChange={(event) => props.onUpdateRemoteProvider((provider) => ({ ...provider, baseURL: event.target.value }))}
                    autoComplete="off"
                    disabled={props.isSavingRemote}
                  />
                </label>
                <label htmlFor="remote-api-key">
                  API Key
                  <input
                    id="remote-api-key"
                    type="text"
                    value={props.selectedRemoteProvider.apiKey.value}
                    onChange={(event) =>
                      props.onUpdateRemoteProvider((provider) => ({
                        ...provider,
                        apiKey: { type: 'plain', value: event.target.value },
                      }))
                    }
                    placeholder="最终写入 agentcfg.yaml 的 API Key"
                    autoComplete="off"
                    disabled={props.isSavingRemote}
                  />
                </label>
                <label htmlFor="remote-model-discovery-path">
                  模型发现路径
                  <input
                    id="remote-model-discovery-path"
                    value={props.selectedRemoteProvider.modelDiscovery?.path ?? ''}
                    onChange={(event) => props.onUpdateRemoteProvider((provider) => withModelDiscoveryPath(provider, event.target.value))}
                    placeholder="/models（可选）"
                    autoComplete="off"
                    disabled={props.isSavingRemote}
                  />
                </label>
              </section>

              <section className="remote-editor-section" aria-label="模型字段">
                <div className="remote-subheading">
                  <div>
                    <p className="eyebrow">模型</p>
                    <h3>当前提供商的模型目录</h3>
                  </div>
                  <div className="remote-inline-actions">
                    <button className="secondary-action secondary-action--compact" type="button" onClick={props.onAddRemoteModel} disabled={props.isSavingRemote}>
                      添加模型
                    </button>
                    <button
                      className="secondary-action secondary-action--compact"
                      type="button"
                      onClick={props.onRemoveRemoteModel}
                      disabled={props.isSavingRemote || props.remoteModelIds.length <= 1}
                    >
                      删除模型
                    </button>
                  </div>
                </div>
                <div className="remote-entity-list" role="list" aria-label="当前提供商的模型">
                  {props.remoteModelIds.map((modelId) => (
                    <button
                      className={`remote-entity-chip ${modelId === props.selectedRemoteModelId ? 'remote-entity-chip--active' : ''}`}
                      type="button"
                      key={modelId}
                      onClick={() => props.onSelectRemoteModel(modelId)}
                      disabled={props.isSavingRemote}
                    >
                      <strong>{modelId.trim() === '' ? '未命名模型' : modelId}</strong>
                      <small>{modelMetadataCount(props.selectedRemoteProvider.models[modelId] ?? {})} 项元数据</small>
                    </button>
                  ))}
                </div>
                <label htmlFor="remote-model">
                  模型 ID
                  <input id="remote-model" value={props.selectedRemoteModelId} onChange={(event) => props.onRemoteModelIdChange(event.target.value)} autoComplete="off" disabled={props.isSavingRemote} />
                </label>
                <label htmlFor="remote-model-variant">
                  variant 元数据
                  <input
                    id="remote-model-variant"
                    value={props.selectedRemoteModel.variant ?? ''}
                    onChange={(event) => props.onUpdateRemoteModel((model) => withOptionalString(model, 'variant', event.target.value))}
                    placeholder="chat（可选）"
                    autoComplete="off"
                    disabled={props.isSavingRemote}
                  />
                </label>
                <label htmlFor="remote-model-context-window">
                  Limit Context（上下文窗口）
                  <input
                    id="remote-model-context-window"
                    type="number"
                    min="1"
                    step="1"
                    value={formatOptionalNumber(props.selectedRemoteModel.contextWindow)}
                    onChange={(event) => props.onUpdateRemoteModel((model) => withOptionalNumber(model, 'contextWindow', event.target.value))}
                    placeholder="可选正整数"
                    autoComplete="off"
                    disabled={props.isSavingRemote}
                  />
                </label>
                <label htmlFor="remote-model-context-tokens">
                  Limit Input（输入预算）
                  <input
                    id="remote-model-context-tokens"
                    type="number"
                    min="1"
                    step="1"
                    value={formatOptionalNumber(props.selectedRemoteModel.contextTokens)}
                    onChange={(event) => props.onUpdateRemoteModel((model) => withOptionalNumber(model, 'contextTokens', event.target.value))}
                    placeholder="可选正整数"
                    autoComplete="off"
                    disabled={props.isSavingRemote}
                  />
                </label>
                <label htmlFor="remote-model-max-tokens">
                  Limit Output（输出上限）
                  <input
                    id="remote-model-max-tokens"
                    type="number"
                    min="1"
                    step="1"
                    value={formatOptionalNumber(props.selectedRemoteModel.maxTokens)}
                    onChange={(event) => props.onUpdateRemoteModel((model) => withOptionalNumber(model, 'maxTokens', event.target.value))}
                    placeholder="可选正整数"
                    autoComplete="off"
                    disabled={props.isSavingRemote}
                  />
                </label>
              </section>

              <section className="remote-editor-section remote-editor-section--full" aria-label="默认提供商和模型">
                <div className="remote-subheading">
                  <div>
                    <p className="eyebrow">默认项</p>
                    <h3>显式默认提供商 / 模型</h3>
                  </div>
                </div>
                <label htmlFor="remote-default-provider">
                  默认提供商
                  <select id="remote-default-provider" value={props.defaultProvider} onChange={(event) => props.onDefaultRemoteProviderChange(event.target.value)} disabled={props.isSavingRemote}>
                    {props.remoteProviderIds.map((providerId) => (
                      <option value={providerId} key={providerId}>{providerId.trim() === '' ? '未命名提供商' : providerId}</option>
                    ))}
                  </select>
                </label>
                <label htmlFor="remote-default-model">
                  默认模型
                  <select id="remote-default-model" value={props.remoteDraft.defaults.model} onChange={(event) => props.onDefaultRemoteModelChange(event.target.value)} disabled={props.isSavingRemote}>
                    {props.defaultProviderModelIds.map((modelId) => (
                      <option value={modelId} key={modelId}>{modelId.trim() === '' ? '未命名模型' : modelId}</option>
                    ))}
                  </select>
                </label>
              </section>

              <OhMyOpenAgentMappingEditor
                config={props.remoteDraft}
                modelReferences={props.remoteModelReferenceOptions}
                isSavingRemote={props.isSavingRemote}
                onModelChange={props.onOhMyOpenAgentModelChange}
                onVariantChange={props.onOhMyOpenAgentVariantChange}
                onClear={props.onClearOhMyOpenAgentAssignment}
              />

            </form>
          ) : (
            <aside className="remote-preview-stack" aria-label="agentcfg.yaml 预览">
              <section className="remote-preview-card">
                <div className="remote-preview-heading">
                  <p className="eyebrow">原始预览</p>
                  <h3>生成的 agentcfg.yaml</h3>
                </div>
                <pre id="remote-yaml-preview" className="remote-preview-block" aria-label="生成的 agentcfg.yaml"><code>{props.remoteYamlPreview}</code></pre>
              </section>
              <section className="remote-preview-card">
                <div className="remote-preview-heading">
                  <p className="eyebrow">Schema 参考</p>
                  <h3>当前字段说明</h3>
                </div>
                <SchemaReference />
              </section>
            </aside>
          )}
        </div>
      </article>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal subcomponents
// ---------------------------------------------------------------------------

function OhMyOpenAgentMappingEditor({
  config,
  isSavingRemote,
  modelReferences,
  onClear,
  onModelChange,
  onVariantChange,
}: {
  config: EditableAgentConfig;
  isSavingRemote: boolean;
  modelReferences: string[];
  onClear: (kind: OhMyOpenAgentAssignmentKind, name: string) => void;
  onModelChange: (kind: OhMyOpenAgentAssignmentKind, name: string, modelReference: string) => void;
  onVariantChange: (kind: OhMyOpenAgentAssignmentKind, name: string, variant: string) => void;
}) {
  return (
    <section className="remote-editor-section remote-editor-section--full ohmy-openagent-editor" aria-label="OhMyOpenAgent 模型路由">
      <div className="remote-subheading">
        <div>
          <p className="eyebrow">OhMyOpenAgent</p>
          <h3>为官方 agent 与 task category 指定模型</h3>
        </div>
      </div>
      <p className="helper-copy ohmy-openagent-editor__copy">
        选项来自上方 providers 模型目录，并保存到专用 <code>ohMyOpenAgent</code> 字段；留空表示继续使用 OhMyOpenAgent 默认路由。
      </p>
      <div className="ohmy-openagent-editor__groups">
        <OhMyOpenAgentMappingGroup
          kind="agents"
          title="Agents"
          names={OH_MY_OPENAGENT_AGENT_NAMES}
          assignments={config.ohMyOpenAgent?.agents ?? {}}
          modelReferences={modelReferences}
          isSavingRemote={isSavingRemote}
          onModelChange={onModelChange}
          onVariantChange={onVariantChange}
          onClear={onClear}
        />
        <OhMyOpenAgentMappingGroup
          kind="categories"
          title="Task categories"
          names={OH_MY_OPENAGENT_CATEGORY_NAMES}
          assignments={config.ohMyOpenAgent?.categories ?? {}}
          modelReferences={modelReferences}
          isSavingRemote={isSavingRemote}
          onModelChange={onModelChange}
          onVariantChange={onVariantChange}
          onClear={onClear}
        />
      </div>
    </section>
  );
}

function OhMyOpenAgentMappingGroup({
  assignments,
  isSavingRemote,
  kind,
  modelReferences,
  names,
  onClear,
  onModelChange,
  onVariantChange,
  title,
}: {
  assignments: Record<string, OhMyOpenAgentModelAssignment>;
  isSavingRemote: boolean;
  kind: OhMyOpenAgentAssignmentKind;
  modelReferences: string[];
  names: readonly string[];
  onClear: (kind: OhMyOpenAgentAssignmentKind, name: string) => void;
  onModelChange: (kind: OhMyOpenAgentAssignmentKind, name: string, modelReference: string) => void;
  onVariantChange: (kind: OhMyOpenAgentAssignmentKind, name: string, variant: string) => void;
  title: string;
}) {
  return (
    <section className="ohmy-openagent-group" aria-label={`OhMyOpenAgent ${title}`}>
      <h4>{title}</h4>
      <div className="ohmy-openagent-rows">
        {names.map((name) => {
          const assignment = assignments[name];
          const modelSelectId = `remote-ohmyopenagent-${kind}-${name}-model`;
          const variantSelectId = `remote-ohmyopenagent-${kind}-${name}-variant`;
          return (
            <div className="ohmy-openagent-row" key={name}>
              <div className="ohmy-openagent-row__name">
                <strong>{name}</strong>
                <small>{assignment?.model ?? '使用默认路由'}</small>
              </div>
              <label htmlFor={modelSelectId}>
                模型
                <select id={modelSelectId} value={assignment?.model ?? ''} onChange={(event) => onModelChange(kind, name, event.target.value)} disabled={isSavingRemote}>
                  <option value="">OhMyOpenAgent 默认</option>
                  {modelReferences.map((modelReference) => (
                    <option value={modelReference} key={modelReference}>{modelReference}</option>
                  ))}
                </select>
              </label>
              <label htmlFor={variantSelectId}>
                variant
                <select id={variantSelectId} value={assignment?.variant ?? ''} onChange={(event) => onVariantChange(kind, name, event.target.value)} disabled={isSavingRemote || assignment === undefined}>
                  <option value="">不指定</option>
                  {OH_MY_OPENAGENT_MODEL_VARIANTS.map((variant) => (
                    <option value={variant} key={variant}>{variant}</option>
                  ))}
                </select>
              </label>
              <button className="secondary-action secondary-action--compact" type="button" onClick={() => onClear(kind, name)} disabled={isSavingRemote || assignment === undefined}>
                清除
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SchemaReference() {
  const schemaTree = buildSchemaDocTree(AGENTCFG_SCHEMA_DOCS);

  return (
    <section id="remote-schema-preview" className="schema-docs" aria-label="agentcfg.yaml schema 参考">
      <p className="schema-docs__intro">agentcfg.yaml 规范字段。此参考只说明 schema，不镜像本页表单值。</p>
      <div className="schema-docs__tree" aria-label="Schema 字段树">
        {schemaTree.map((node) => renderSchemaDocNode(node, true))}
      </div>
    </section>
  );
}

type SchemaDocTreeNode = {
  field: AgentConfigSchemaDoc;
  children: SchemaDocTreeNode[];
};

function buildSchemaDocTree(fields: readonly AgentConfigSchemaDoc[]): SchemaDocTreeNode[] {
  const nodesByPath = new Map<string, SchemaDocTreeNode>();
  const roots: SchemaDocTreeNode[] = [];

  for (const field of fields) {
    nodesByPath.set(field.path, { field, children: [] });
  }

  for (const field of fields) {
    const node = nodesByPath.get(field.path);
    if (node === undefined) {
      continue;
    }

    const parent = nodesByPath.get(parentSchemaPath(field.path));
    if (parent === undefined) {
      roots.push(node);
      continue;
    }

    parent.children.push(node);
  }

  return roots;
}

function parentSchemaPath(path: string): string {
  const segments = path.split('.');
  segments.pop();
  return segments.join('.');
}

function renderSchemaDocNode(node: SchemaDocTreeNode, isRoot: boolean) {
  return (
    <details className="schema-docs__node" data-schema-path={node.field.path} key={node.field.path} open={isRoot}>
      <summary className="schema-docs__summary">
        <span className="schema-docs__summary-main">
          <code>{node.field.path}</code>
          <strong>{node.field.label}</strong>
        </span>
        <span className="schema-docs__badge">{node.field.required ? '必填' : '可选'}</span>
      </summary>
      <div className="schema-docs__body">
        <span>类型：{node.field.type}</span>
        <p>{node.field.description}</p>
      </div>
      {node.children.length > 0 && (
        <div className="schema-docs__children">
          {node.children.map((child) => renderSchemaDocNode(child, false))}
        </div>
      )}
    </details>
  );
}

// ---------------------------------------------------------------------------
// Inline render helpers (used only by RemoteConfigPanel)
// ---------------------------------------------------------------------------

function withModelDiscoveryPath(
  provider: EditableAgentConfig['providers'][string],
  path: string,
): EditableAgentConfig['providers'][string] {
  if (path.trim() === '') {
    const { modelDiscovery: _modelDiscovery, ...providerWithoutDiscovery } = provider;
    return providerWithoutDiscovery;
  }

  return { ...provider, modelDiscovery: { path } };
}

function withOptionalString<T extends Record<string, unknown>, K extends keyof T>(
  record: T,
  key: K,
  value: string,
): T {
  if (value.trim() === '') {
    const nextRecord = { ...record };
    delete nextRecord[key];
    return nextRecord;
  }

  return { ...record, [key]: value };
}

function withOptionalNumber<T extends Record<string, unknown>, K extends keyof T>(
  record: T,
  key: K,
  value: string,
): T {
  if (value.trim() === '') {
    const nextRecord = { ...record };
    delete nextRecord[key];
    return nextRecord;
  }

  return { ...record, [key]: Number(value) };
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function modelMetadataCount(model: EditableAgentConfig['providers'][string]['models'][string]): number {
  return [model.variant, model.contextWindow, model.contextTokens, model.maxTokens].filter((value) => value !== undefined).length;
}
