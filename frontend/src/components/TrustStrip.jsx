import { Icon } from './Icon.jsx';

/**
 * Faixa de métricas logo abaixo do carrossel: ícone em caixa, valor em
 * display e rótulo curto. Os valores vêm da API quandoexistirem, senão
 * caem nos textos padrão.
 */
export function TrustStrip({ totalCourses }) {
  const items = [
    { icon: 'book', value: Number.isFinite(totalCourses) ? String(totalCourses) : 'Catálogo', label: 'Cursos disponíveis na plataforma' },
    { icon: 'monitor', value: '100% online', label: 'Acesso liberado assim que a compra é aprovada' },
    { icon: 'certificate', value: 'QR Code', label: 'Certificado com validação pública, sem cadastro' },
    { icon: 'clock', value: 'No seu ritmo', label: 'Comece, pause e retome de onde parou' },
  ];

  return (
    <section className="trust-strip" aria-label="Destaques da plataforma">
      <div className="container">
        <ul className="trust-grid">
          {items.map((item) => (
            <li key={item.label} className="trust-item">
              <span className="trust-icon">
                <Icon name={item.icon} size={20} />
              </span>
              <span className="trust-text">
                <strong className="trust-value">{item.value}</strong>
                <span className="trust-label">{item.label}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
