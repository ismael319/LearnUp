import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon.jsx';

const AUTOPLAY_MS = 6000;

/**
 * Carrossel full-bleed no padrão da referência.
 *
 * Usa scroll-snap nativo em vez de Embla: sem dependência nova e com o
 * mesmo resultado (alinhamento no início, loop e autoplay). O autoplay é
 * desligado quando o usuário prefere menos movimento e pausa no hover.
 */
export function HeroCarousel({ items = [] }) {
  const trackRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = items.length;
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);

  /** Traduz a posição de scroll em índice de slide. */
  const syncIndex = useCallback(() => {
    const track = trackRef.current;
    if (!track || !count) return;
    const width = track.clientWidth;
    if (!width) return;
    const next = Math.round(track.scrollLeft / width);
    setIndex(Math.min(Math.max(next, 0), count - 1));
  }, [count]);

  const goTo = useCallback(
    (target) => {
      const track = trackRef.current;
      if (!track) return;
      const width = track.clientWidth;
      // O último item volta ao início para fechar o ciclo.
      const next = target >= count ? 0 : Math.max(target, 0);
      track.scrollTo({ left: next * width, behavior: reduced.current ? 'auto' : 'smooth' });
    },
    [count],
  );

  useEffect(() => {
    if (count < 2 || paused || reduced.current) return undefined;
    const id = setInterval(() => {
      const track = trackRef.current;
      if (!track) return;
      const width = track.clientWidth;
      const atEnd = track.scrollLeft >= width * (count - 1) - 8;
      goTo(atEnd ? 0 : index + 1);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [count, index, paused, goTo]);

  if (!count) return null;

  return (
    <section
      className="hero-carousel"
      aria-label="Destaques"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="hero-track" ref={trackRef} onScroll={syncIndex}>
        {items.map((item) => (
          <Link
            key={item.id}
            to={`/cursos/${item.slug}`}
            className="hero-slide"
            aria-label={item.title}
          >
            {item.coverUrl ? (
              <img src={item.coverUrl} alt="" loading={index === 0 ? 'eager' : 'lazy'} />
            ) : (
              <span className="hero-slide-fallback" aria-hidden="true" />
            )}
            <span className="hero-caption">
              <span className="hero-caption-title">{item.title}</span>
              {item.subtitle && <span className="hero-caption-sub">{item.subtitle}</span>}
            </span>
          </Link>
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="hero-arrow left"
            onClick={() => goTo(index - 1)}
            aria-label="Destaque anterior"
          >
            <Icon name="caretLeft" size={18} />
          </button>
          <button
            type="button"
            className="hero-arrow right"
            onClick={() => goTo(index + 1)}
            aria-label="Próximo destaque"
          >
            <Icon name="caretRight" size={18} />
          </button>

          <div className="hero-dots">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={`hero-dot${i === index ? ' active' : ''}`}
                onClick={() => goTo(i)}
                aria-label={`Ir para o destaque ${i + 1}`}
                aria-current={i === index}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
