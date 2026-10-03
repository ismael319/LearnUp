import { initials } from '../utils/format.js';

export function Avatar({ name, src, size = 'md', className = '' }) {
  const cls = ['avatar', size !== 'md' ? `avatar-${size}` : '', className].filter(Boolean).join(' ');

  if (src) {
    return <img src={src} alt={name} className={cls} loading="lazy" />;
  }
  return (
    <span className={cls} aria-hidden="true" title={name}>
      {initials(name)}
    </span>
  );
}
