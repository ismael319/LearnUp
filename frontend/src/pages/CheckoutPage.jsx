import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { coursesApi, learningApi, paymentsApi } from '../api/client.js';
import { useApi, useSubmit } from '../hooks/useApi.js';
import { Alert } from '../components/Alert.jsx';
import { Spinner, ErrorState, LoadingBlock } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';
import { formatPrice } from '../utils/format.js';

const METHOD_ICON = { pix: 'sparkle', card: 'card', paypal: 'wallet' };

export function CheckoutPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const [method, setMethod] = useState('pix');
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  const { data: coursePayload, loading, error: loadError, refetch } = useApi(() => coursesApi.detail(courseId), [courseId]);
  const course = coursePayload?.course ?? null;
  const { data: methodsData } = useApi(() => paymentsApi.methods(), []);

  const { submit: createOrder, loading: creatingOrder } = useSubmit(async () => {
    const result = await paymentsApi.createOrder({ courseId, method });
    setOrder(result.order);
    return result.order;
  });

  const { submit: enroll, loading: enrolling } = useSubmit(async () => {
    await learningApi.enrollFree(courseId);
    navigate(`/aprender/${courseId}`, { replace: true });
  });

  const start = async (event) => {
    event.preventDefault();
    setError(null);
    try {
      if (course.priceCents === 0) await enroll();
      else await createOrder();
    } catch (err) {
      setError(err);
    }
  };

  if (loading) return <LoadingBlock label="Carregando checkout..." />;
  if (loadError) {
    return (
      <div className="container page">
        <ErrorState error={loadError} onRetry={refetch} />
      </div>
    );
  }
  if (!course) return null;

  const free = course.priceCents === 0;
  const methods = methodsData?.methods ?? [];
  const provider = methodsData?.provider;

  return (
    <div className="container page" style={{ maxWidth: 880 }}>
      <h1>Finalizar compra</h1>
      <p className="muted">Você está comprando: <strong>{course.title}</strong></p>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="danger" onClose={() => setError(null)}>{error.message}</Alert>
        </div>
      )}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <form className="card card-pad stack" onSubmit={start}>
          {free ? (
            <Alert variant="success">Este curso é gratuito: a matrícula é liberada imediatamente.</Alert>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <span className="label">Forma de pagamento</span>
              {methods.map((m) => (
                <label
                  key={m.id}
                  className={`option-card card${method === m.id ? ' selected' : ''}`}
                >
                  <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
                  <Icon name={METHOD_ICON[m.id] ?? 'card'} size={20} className="option-card-icon" />
                  <div className="stack" style={{ gap: 0 }}>
                    <strong>{m.label ?? m.id}</strong>
                    {m.description && <span className="tiny muted">{m.description}</span>}
                  </div>
                </label>
              ))}
              {!methods.length && (
                <p className="small muted">
                  Nenhum método disponível para o provider <code>{provider ?? 'desconhecido'}</code>. Ajuste <code>PAYMENT_PROVIDER</code> no backend.
                </p>
              )}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={creatingOrder || enrolling || (!free && !methods.length)}>
            {(creatingOrder || enrolling) && <Spinner />}
            {free ? 'Confirmar matrícula grátis' : `Pagar ${formatPrice(course.priceCents)}`}
          </button>

          <p className="tiny muted center" style={{ margin: 0 }}>
            Ambiente de demonstração: nenhum valor real é cobrado.
          </p>
        </form>

        <aside className="card card-pad stack" style={{ gap: 12 }}>
          <h3 style={{ margin: 0 }}>Resumo</h3>
          {course.coverUrl && <img src={course.coverUrl} alt="" className="cover" style={{ borderRadius: 'var(--radius)' }} />}
          <strong>{course.title}</strong>
          <span className="small muted">por {course.instructorName}</span>
          <hr className="divider" style={{ margin: '8px 0' }} />
          <div className="row-between">
            <span>Subtotal</span>
            <strong>{formatPrice(course.priceCents)}</strong>
          </div>
          <div className="row-between small muted">
            <span>Taxas</span>
            <span>R$ 0,00</span>
          </div>
          <hr className="divider" style={{ margin: '8px 0' }} />
          <div className="row-between">
            <strong>Total</strong>
            <strong style={{ fontSize: '1.2rem' }}>{formatPrice(course.priceCents)}</strong>
          </div>
          <Link to={`/cursos/${course.slug}`} className="small center row" style={{ gap: 5, justifyContent: 'center' }}>
          <Icon name="caretLeft" size={13} /> Voltar ao curso
        </Link>
        </aside>
      </div>

      {order && <PaymentResult order={order} course={course} />}
    </div>
  );
}

/** Instruções do pedido criado, conforme o método escolhido. */
function PaymentResult({ order, course }) {
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isMock = order.provider === 'mock';
  const isPix = order.method === 'pix' && order.pixCopyCode;
  const isCard = order.method === 'card';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await paymentsApi.confirmMock(order.id);
      setResult(res);
      setTimeout(() => navigate(`/aprender/${course.id}`, { replace: true }), 1200);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad stack" style={{ marginTop: 24, borderColor: 'var(--brand-300)' }}>
          <h2 className="row" style={{ margin: 0, gap: 8 }}><Icon name="check" size={20} /> Pedido criado</h2>
      <span className="small muted">
        Valor: <strong>{formatPrice(order.amountCents ?? course.priceCents)}</strong> · status:{' '}
        <strong>{order.status}</strong>
      </span>

      {isPix && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="small" style={{ margin: 0 }}>Copie o código PIX copia-e-cola e pague no app do seu banco:</p>
          <code
            className="small"
            style={{ wordBreak: 'break-all', background: 'var(--ink-100)', padding: 12, borderRadius: 'var(--radius)' }}
          >
            {order.pixCopyCode}
          </code>
        </div>
      )}

      {isCard && <p className="small" style={{ margin: 0 }}>Cartão de teste do provider: <code>4242 4242 4242 4242</code>.</p>}

      {!isMock && order.checkoutUrl && (
        <a className="btn btn-primary" href={order.checkoutUrl} target="_blank" rel="noreferrer">
          Ir para o pagamento seguro
        </a>
      )}

      {error && <Alert variant="danger" onClose={() => setError(null)}>{error.message}</Alert>}
      {result && (
        <Alert variant="success">
          Pagamento confirmado! Sua matrícula foi liberada. Redirecionando para o curso...
        </Alert>
      )}

      {isMock && (
        <>
          <button type="button" className="btn btn-success" onClick={confirm} disabled={busy || Boolean(result)}>
            {busy && <Spinner />}
            {result ? 'Confirmado' : 'Já paguei · confirmar pagamento'}
          </button>
          <span className="tiny muted">Ambiente demo: o botão simula o webhook que o gateway real dispararia.</span>
        </>
      )}
    </div>
  );
}
