import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { paymentsApi } from '../api/client.js';
import { useApi, useSubmit } from '../hooks/useApi.js';
import { useCart } from '../context/CartContext.jsx';
import { Alert } from '../components/Alert.jsx';
import { Spinner, ErrorState, LoadingBlock } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';
import { formatPrice } from '../utils/format.js';

const METHOD_ICON = { pix: 'sparkle', card: 'card', paypal: 'wallet' };

export function CheckoutPage() {
  const navigate = useNavigate();
  const { items, clear } = useCart();
  const [method, setMethod] = useState('');
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const { data: methodsData, loading, error: methodsError, refetch } = useApi(() => paymentsApi.methods(), []);
  const methods = methodsData?.methods ?? [];
  const total = items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);

  useEffect(() => {
    if (!method && methods[0]) setMethod(methods[0].id);
    if (method && methods.length && !methods.some((item) => item.id === method)) setMethod(methods[0].id);
  }, [method, methods]);

  const { submit: createOrder, loading: creatingOrder } = useSubmit(async () => {
    const result = await paymentsApi.createOrder({ courseIds: items.map((item) => item.id), method });
    setOrder(result.order);
    return result.order;
  });

  const start = async (event) => {
    event.preventDefault();
    setError(null);
    try { await createOrder(); } catch (err) { setError(err); }
  };

  if (!items.length && !order) {
    return <div className="container page"><Alert variant="info">Seu carrinho está vazio. <Link to="/catalogo">Volte ao catálogo</Link> para selecionar treinamentos.</Alert></div>;
  }
  if (loading) return <LoadingBlock label="Carregando checkout..." />;
  if (methodsError) return <div className="container page"><ErrorState error={methodsError} onRetry={refetch} /></div>;

  return (
    <div className="container page" style={{ maxWidth: 1000 }}>
      <p className="eyebrow">Checkout</p><h1>Finalizar compra</h1>
      {error && <Alert variant="danger" onClose={() => setError(null)}>{error.message}</Alert>}
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <form className="card card-pad stack" onSubmit={start}>
          <div className="stack" style={{ gap: 10 }}>
            <span className="label">Forma de pagamento</span>
            {methods.map((item) => (
              <label key={item.id} className={`option-card card${method === item.id ? ' selected' : ''}`}>
                <input type="radio" name="method" value={item.id} checked={method === item.id} onChange={() => setMethod(item.id)} />
                <Icon name={METHOD_ICON[item.id] ?? 'card'} size={20} className="option-card-icon" />
                <div className="stack" style={{ gap: 0 }}><strong>{item.label ?? item.id}</strong>{item.description && <span className="tiny muted">{item.description}</span>}</div>
              </label>
            ))}
            {!methods.length && <p className="small muted">Nenhum método está disponível. Ajuste o provider de pagamentos no servidor.</p>}
          </div>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={creatingOrder || !method}>
            {creatingOrder && <Spinner />} Pagar {formatPrice(total)}
          </button>
          {methodsData?.provider === 'mock' && <p className="tiny muted center" style={{ margin: 0 }}>Ambiente de demonstração: nenhum valor real será cobrado.</p>}
        </form>
        <aside className="card card-pad stack" style={{ gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Resumo</h2>
          {items.map((item) => <div key={item.id} className="row-between small" style={{ gap: 12 }}><span className="clamp-2">{item.title}</span><strong>{formatPrice(item.priceCents)}</strong></div>)}
          <hr className="divider" style={{ margin: '4px 0' }} />
          <div className="row-between"><strong>Total</strong><strong style={{ fontSize: '1.25rem' }}>{formatPrice(total)}</strong></div>
          <Link className="small center" to="/carrinho">Voltar ao carrinho</Link>
        </aside>
      </div>
      {order && <PaymentResult order={order} clearCart={clear} />}
    </div>
  );
}

function PaymentResult({ order, clearCart }) {
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const firstCourseId = order.items?.[0]?.courseId ?? order.courseId;
  const isMock = order.provider === 'mock';

  const confirm = async () => {
    setBusy(true); setError(null);
    try {
      const response = await paymentsApi.confirmMock(order.id);
      setResult(response); clearCart();
      setTimeout(() => navigate(firstCourseId ? `/aprender/${firstCourseId}` : '/minha-conta', { replace: true }), 1000);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <section className="card card-pad stack" style={{ marginTop: 24, borderColor: 'var(--brand-300)' }}>
      <h2 className="row" style={{ margin: 0, gap: 8 }}><Icon name="check" size={20} /> Pedido criado</h2>
      <span className="small muted">Valor: <strong>{formatPrice(order.amountCents)}</strong> · status: <strong>{order.status}</strong></span>
      {order.method === 'pix' && order.pixCopyCode && <code className="small" style={{ wordBreak: 'break-all', background: 'var(--ink-100)', padding: 12, borderRadius: 'var(--radius)' }}>{order.pixCopyCode}</code>}
      {error && <Alert variant="danger" onClose={() => setError(null)}>{error.message}</Alert>}
      {result && <Alert variant="success">Pagamento confirmado. Seus treinamentos foram liberados.</Alert>}
      {isMock && <button type="button" className="btn btn-success" onClick={confirm} disabled={busy || Boolean(result)}>{busy && <Spinner />}{result ? 'Confirmado' : 'Já paguei · confirmar pagamento'}</button>}
      {!isMock && order.checkoutUrl && <a className="btn btn-primary" href={order.checkoutUrl} target="_blank" rel="noreferrer">Ir para o pagamento seguro</a>}
    </section>
  );
}
