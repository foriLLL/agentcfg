import type { NavigationIconName } from './navigation';

const NAVIGATION_ICON_PATHS = {
  overview: ['M4 5h6v6H4z', 'M14 5h6v6h-6z', 'M4 15h6v4H4z', 'M14 15h6v4h-6z'],
  connection: ['M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1', 'M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1'],
  remote: ['M6 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11.4-1.8A5 5 0 0 0 6 18z'],
  config: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M8 4v4', 'M16 10v4', 'M11 16v4'],
  rules: ['M7 3h7l4 4v14H7z', 'M14 3v5h5', 'M10 12h6', 'M10 16h6'],
  skills: ['M12 3l1.7 4.8L18 10l-4.3 2.2L12 17l-1.7-4.8L6 10l4.3-2.2z', 'M5 4v4', 'M3 6h4', 'M19 16v4', 'M17 18h4'],
  sync: ['M17 3v5h-5', 'M7 21v-5h5', 'M17 8a6.5 6.5 0 0 0-10.8 2', 'M7 16a6.5 6.5 0 0 0 10.8-2'],
  execute: ['M8 5v14l11-7z'],
} as const satisfies Record<NavigationIconName, readonly string[]>;

type NavigationIconProps = {
  readonly name: NavigationIconName;
};

export function NavigationIcon({ name }: NavigationIconProps) {
  return (
    <svg className="navigation-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {NAVIGATION_ICON_PATHS[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}
