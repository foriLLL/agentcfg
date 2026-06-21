import type { NavigationIconName } from './navigation';

const NAVIGATION_ICON_PATHS = {
  overview: ['M4 5h6v6H4z', 'M14 5h6v6h-6z', 'M4 15h6v4H4z', 'M14 15h6v4h-6z'],
  remote: ['M6 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11.4-1.8A5 5 0 0 0 6 18z'],
  sync: ['M17 3v5h-5', 'M7 21v-5h5', 'M17 8a6.5 6.5 0 0 0-10.8 2', 'M7 16a6.5 6.5 0 0 0 10.8-2'],
  rulesSkills: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
  automation: ['M12 8v8', 'M8 12h8', 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0z'],
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
