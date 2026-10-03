/**
 * Ícones em SVG inline com `currentColor`.
 *
 * A referência usa @phosphor-icons; aqui os mesmos símbolos são
 * desenhados num viewBox 24x24 com traço, o que dispensa uma
 * dependência e mantém o mesmo peso visual sobre o fundo navy.
 */

const PATHS = {
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z',
  monitor: 'M3 5h18v11H3zM9 20h6M12 16v4',
  certificate: 'M12 3 4 6v5c0 4.5 3.2 8.6 8 10 4.8-1.4 8-5.5 8-10V6zM9 12l2 2 4-4',
  play: 'M8 5.5v13l11-6.5z',
  caretRight: 'M9 5l7 7-7 7',
  caretDown: 'M5 9l7 7 7-7',
  caretLeft: 'M15 5l-7 7 7 7',
  check: 'M4.5 12.5l5 5 10-11',
  list: 'M4 6h16M4 12h16M4 18h16',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  star: 'M12 3.5l2.7 5.6 6.1.8-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.8z',
  starFill: 'M12 3.5l2.7 5.6 6.1.8-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.8z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5M17 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.9c1.9.8 3 2.4 3 5.1',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M9 20h6M12 14v6',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5',
  award: 'M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM8.5 12.5L7 22l5-2.5L17 22l-1.5-9.5',
  message: 'M4 5h16v11H8l-4 4z',
  download: 'M12 3v12M7 11l5 5 5-5M4 20h16',
  arrowRight: 'M4 12h16M14 6l6 6-6 6',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  shield: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L20 8l-4-4L4 16z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  spark: 'M12 3.5l2.2 5.7 5.8.4-4.4 3.8 1.3 5.6-4.9-3-4.9 3 1.3-5.6L4 9.6l5.8-.4z',
  pin: 'M9 3.5h6l-.8 5.2 3.3 3v1.8H6.5v-1.8l3.3-3zM12 13.5V21',
  eye: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12zM12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',
  card: 'M3 6h18v12H3zM3 10h18',
  code: 'M9.2 8.2 4.8 12l4.4 3.8M14.8 8.2 19.2 12l-4.4 3.8M13.4 5.5l-2.8 13',
  palette: 'M12 3.6a8.4 8.4 0 1 0 0 16.8c1.2 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.8-1.7h1.5a4.2 4.2 0 0 0 4.2-4.2c0-3.8-3.7-6.8-8.3-6.8zM7.6 12.4h.01M10 8.6h.01M14.4 8.2h.01',
  briefcase: 'M3 8.5h18v11.5H3zM8.6 8.5V6.2A1.6 1.6 0 0 1 10.2 4.6h3.6a1.6 1.6 0 0 1 1.6 1.6v2.3M3 13.2h18',
  megaphone: 'M4 10.4v3.2a1.5 1.5 0 0 0 1.5 1.5H7l7 4.6V5.3L7 9.9H5.5A1.5 1.5 0 0 0 4 10.4zM17 8.9a4.2 4.2 0 0 1 0 6.2M7.4 15.1v4.4',
  wallet: 'M3 7h14a2 2 0 0 1 2 2v9H3zM3 7V5.5A1.5 1.5 0 0 1 4.5 4H16M19 13h.4',
  chart: 'M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3',
  cap: 'M12 4 2 9l10 5 10-5zM6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5',
  file: 'M6 3h7l5 5v13H6zM13 3v5h5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.6v.6',
  alert: 'M12 3l9.5 17H2.5zM12 10v4M12 17v.4',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM17 6.6v.4',
  facebook: 'M14 8h2.5V4.5H14A3.5 3.5 0 0 0 10.5 8v2.5H8V14h2.5v7H14v-7H16.5L17 10.5h-3z',
  youtube: 'M21 8.5A2.5 2.5 0 0 0 18.8 6C16.6 5.5 12 5.5 12 5.5S7.4 5.5 5.2 6A2.5 2.5 0 0 0 3 8.5 26 26 0 0 0 2.5 12 26 26 0 0 0 3 15.5 2.5 2.5 0 0 0 5.2 18c2.2.5 6.8.5 6.8.5s4.6 0 6.8-.5a2.5 2.5 0 0 0 2.2-2.5 26 26 0 0 0 .5-3.5 26 26 0 0 0-.5-3.5zM10 15V9l5 3z',
  whatsapp: 'M12 3a9 9 0 0 0-7.7 13.6L3 21.5l5-1.3A9 9 0 1 0 12 3zm4.6 12.3c-.2.5-1.1 1-1.5 1-.4.1-1 .1-1.7-.1a12 12 0 0 1-4.4-2.6 10 10 0 0 1-1.8-2.7c-.2-.6 0-1.1.2-1.4.1-.2.4-.3.5-.3h.4c.1 0 .3 0 .4.3l.6 1.4c.1.2 0 .3-.1.4l-.3.4c-.1.1-.2.3-.1.4.3.6.7 1 1.2 1.4.5.4.9.6 1.1.7.2.1.3 0 .4-.1l.5-.6c.1-.2.3-.2.5-.1l1.3.6c.2.1.3.2.3.3.1.2.1.6-.1 1.1z',
};

export const ICON_NAMES = Object.keys(PATHS);

/** Ícones que precisam de preenchimento, não só contorno (ex.: estrela cheia
 *  de uma avaliação). O `d` é o mesmo da versão contornada. */
const FILLED = new Set(['starFill']);

const SPLIT = /(?=M)/;

/**
 * @param {{ name: keyof typeof PATHS, size?: number|string, className?: string }} props
 */
export function Icon({ name, size = 20, className, ...rest }) {
  const d = PATHS[name];
  if (!d) return null;

  const filled = FILLED.has(name);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {d.split(SPLIT).filter(Boolean).map((segment, i) => (
        <path key={i} d={segment} stroke={filled ? 'none' : undefined} />
      ))}
    </svg>
  );
}
