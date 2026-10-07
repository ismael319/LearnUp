import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext.jsx';
import { Icon } from '../components/Icon.jsx';
import { formatPrice } from '../utils/format.js';

export function CartPage() {
  const { items, remove, clear } = useCart();
  const total = items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);

  if (!items.length) {
    return (
      <div className="container page">
        <section className="card card-pad center stack" style={{ maxWidth: 620, margin: '0 auto', padding: 40 }}>
          <span className="trust-icon" aria-hidden="true"><Icon name="cart" size={28} /></span>
          <h1 style={{ margin: 0 }}>Seu carrinho está vazio</h1>
          <p className="muted">Explore o catálogo e selecione os treinamentos que deseja adquirir.</p>
          <Link className="btn btn-primary" to="/catalogo">Ver treinamentos</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 1040 }}>
      <div className="row-between wrap" style={{ marginBottom: 24 }}>
        <div><p className="eyebrow">Compra</p><h1 style={{ margin: 0 }}>Seu carrinho</h1></div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Limpar carrinho</button>
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 12 }}>
          {items.map((item) => (
            <article key={item.id} className="card card-pad row wrap" style={{ gap: 16 }}>
              {item.coverUrl && <img src={item.coverUrl} alt="" className="cart-cover" />}
              <div className="stack grow" style={{ gap: 3, minWidth: 200 }}>
                <span className="tiny muted">{item.categoryName ?? 'Treinamento online'}</span>
                <strong>{item.title}</strong>
                {item.instructorName && <span className="small muted">por {item.instructorName}</span>}
              </div>
              <strong>{formatPrice(item.priceCents)}</strong>
              <button type="button" className="icon-button" aria-label={`Remover ${item.title}`} onClick={() => remove(item.id)}><Icon name="trash" size={18} /></button>
            </article>
          ))}
        </div>
        <aside className="card card-pad stack" style={{ gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Resumo do pedido</h2>
          <div className="row-between small muted"><span>{items.length} treinamento{items.length === 1 ? '' : 's'}</span><span>{formatPrice(total)}</span></div>
          <div className="row-between"><strong>Total</strong><strong style={{ fontSize: '1.35rem' }}>{formatPrice(total)}</strong></div>
          <Link className="btn btn-primary btn-lg btn-block" to="/checkout">Continuar para pagamento</Link>
          <Link className="btn btn-secondary btn-block" to="/catalogo">Continuar comprando</Link>
        </aside>
      </div>
    </div>
  );
}
