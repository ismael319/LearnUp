import { createContext, useContext, useEffect, useState } from 'react';

const CartContext = createContext(null);
const CART_KEY = 'learnup.cart';

const readCart = () => {
  try {
    const value = JSON.parse(localStorage.getItem(CART_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export function CartProvider({ children }) {
  const [items, setItems] = useState(readCart);

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }, [items]);

  const add = (course) => {
    if (!course || course.priceCents === 0 || course.enrolled) return;
    setItems((current) => current.some((item) => item.id === course.id) ? current : [...current, course]);
  };
  const remove = (courseId) => setItems((current) => current.filter((item) => item.id !== courseId));
  const clear = () => setItems([]);

  return <CartContext.Provider value={{ items, add, remove, clear }}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart deve ser usado dentro de CartProvider.');
  return context;
}
