import type { ReactNode } from 'react';

export type SettingsPanelProps = {
  readonly connectionPanel: ReactNode;
  readonly automationPanel: ReactNode;
  readonly rawConfigPanel: ReactNode;
  readonly debugPanel: ReactNode;
};

export function SettingsPanel({ automationPanel, connectionPanel, debugPanel, rawConfigPanel }: SettingsPanelProps) {
  return (
    <section className="settings-panel" id="settings-panel" role="tabpanel" aria-labelledby="automation-tab">
      <header className="settings-hero">
        <div>
          <p className="eyebrow">设置</p>
          <h2>连接、自动化与高级诊断集中管理。</h2>
          <p>普通路径保持清爽；GitHub/Gist、本机自动同步、原生配置编辑器和调试元数据在这里统一收纳。</p>
        </div>
        <div className="settings-hero__index" aria-label="设置包含的能力">
          <span>连接</span>
          <span>自动化</span>
          <span>高级</span>
          <span>调试</span>
        </div>
      </header>

      <div className="settings-panel__stack">
        <section className="settings-panel__section" aria-label="连接管理">
          {connectionPanel}
        </section>

        <section className="settings-panel__section" aria-label="自动化控制">
          {automationPanel}
        </section>

        <details className="settings-panel__advanced" id="settings-raw-editor">
          <summary>
            <span>高级：原生配置文件编辑器</span>
            <small>按 Agent 加载、查看并保存本机原始配置；仅在需要直接修复文件时展开。</small>
          </summary>
          {rawConfigPanel}
        </details>

        <section className="settings-panel__debug" aria-label="调试元数据">
          <div className="section-heading">
            <p className="eyebrow">Debug</p>
            <h2>状态详情与运行时元数据</h2>
          </div>
          {debugPanel}
        </section>
      </div>
    </section>
  );
}
