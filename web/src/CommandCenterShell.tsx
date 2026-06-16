import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { RuntimeStateSummary } from './api';
import { COMMAND_CENTER_NAV_ITEMS, navigationGroupLabel, type AppTab, type NavigationItem } from './navigation';
import { statusLabel, statusTone } from './view-model';

type CommandCenterShellProps = {
  readonly activeTab: AppTab;
  readonly loadState: 'loading' | 'ready' | 'error';
  readonly runtimeState: RuntimeStateSummary | null;
  readonly statusRail: ReactNode;
  readonly children: ReactNode;
  readonly onTabChange: (tab: AppTab) => void;
};

export function CommandCenterShell({ activeTab, children, loadState, onTabChange, runtimeState, statusRail }: CommandCenterShellProps) {
  const [query, setQuery] = useState('');
  const navigationGroups = useMemo(() => groupNavigationItems(COMMAND_CENTER_NAV_ITEMS), []);
  const searchMatches = useMemo(() => searchNavigationItems(query), [query]);

  function navigateTo(tab: AppTab): void {
    setQuery('');
    onTabChange(tab);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') {
      return;
    }

    const firstMatch = searchMatches[0];
    if (firstMatch !== undefined) {
      navigateTo(firstMatch.id);
    }
  }

  return (
    <main className="command-shell" aria-labelledby="page-title">
      <aside className="command-sidebar" aria-label="主导航">
        <div className="command-brand">
          <span className="command-brand__mark" aria-hidden="true" />
          <div>
            <h1 id="page-title">agentcfg</h1>
            <p>本地控制台</p>
          </div>
        </div>
        <nav className="command-nav" aria-label="功能导航">
          {navigationGroups.map((group) => (
            <section className="command-nav__group" key={group.group}>
              <p>{navigationGroupLabel(group.group)}</p>
              {group.items.map((item) => (
                <button
                  id={`${item.id}-tab`}
                  className={`command-nav__item ${activeTab === item.id ? 'command-nav__item--active' : ''}`}
                  type="button"
                  aria-current={activeTab === item.id ? 'page' : undefined}
                  onClick={() => navigateTo(item.id)}
                  key={item.id}
                >
                  <span className="command-nav__icon" aria-hidden="true">{item.label.slice(0, 1)}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="command-sidebar__footer">
          <span className={`status-dot status-dot--${runtimeState?.gist.present ? 'ready' : 'warning'}`} aria-hidden="true" />
          <span>{runtimeState?.gist.present ? '本地模式' : '等待连接'}</span>
        </div>
      </aside>

      <section className="command-workspace">
        <header className="command-topbar">
          <div className="command-search-shell">
            <div className="command-search" role="search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={query}
                placeholder="输入页面名称快速跳转"
                aria-label="输入页面名称快速跳转"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              <kbd>Enter</kbd>
            </div>
            {query.trim() !== '' && (
              <div className="command-search__results" role="listbox" aria-label="导航匹配结果">
                {searchMatches.length === 0 ? (
                  <p>没有匹配的页面</p>
                ) : (
                  searchMatches.map((item) => (
                    <button type="button" role="option" aria-selected={activeTab === item.id} onClick={() => navigateTo(item.id)} key={item.id}>
                      <span>{item.label}</span>
                      <small>{navigationGroupLabel(item.group)}</small>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button className="secondary-action secondary-action--compact" type="button" onClick={() => navigateTo('execute')}>
            快速操作
          </button>
          <span className={`status-badge status-badge--${loadState === 'loading' ? 'pending' : statusTone(runtimeState)}`}>
            {loadState === 'loading' ? '正在加载会话' : statusLabel(runtimeState)}
          </span>
        </header>

        <div className="command-content">
          <section className="command-main" aria-label="主工作区">
            {children}
          </section>
          <aside className="command-rail" aria-label="状态面板">
            {statusRail}
          </aside>
        </div>
      </section>
    </main>
  );
}

function searchNavigationItems(query: string): readonly NavigationItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') {
    return [];
  }

  return COMMAND_CENTER_NAV_ITEMS.filter((item) => {
    const groupLabel = navigationGroupLabel(item.group);
    return `${item.label} ${groupLabel} ${item.id}`.toLowerCase().includes(normalizedQuery);
  });
}

type NavigationGroup = {
  readonly group: NavigationItem['group'];
  readonly items: readonly NavigationItem[];
};

function groupNavigationItems(items: readonly NavigationItem[]): NavigationGroup[] {
  const groups: NavigationGroup[] = [];
  for (const item of items) {
    const current = groups.find((group) => group.group === item.group);
    if (current === undefined) {
      groups.push({ group: item.group, items: [item] });
      continue;
    }
    groups.splice(groups.indexOf(current), 1, { ...current, items: [...current.items, item] });
  }
  return groups;
}
