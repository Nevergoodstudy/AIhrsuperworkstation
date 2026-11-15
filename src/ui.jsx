import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { X, LoaderCircle, Inbox } from 'lucide-react';
export function Button({ secondary, danger, children, ...props }) { return <button type="button" className={'button ' + (danger ? 'button-danger' : secondary ? 'button-secondary' : 'button-primary')} {...props}>{children}</button>; }
export function ErrorBox({ error }) { return error ? <div className="alert alert-error" role="alert">{error.message || error}</div> : null; }
export function Empty({ children, action }) { return <div className="empty-state"><Inbox size={32}/><p>{children}</p>{action}</div>; }
export function Loading() { return <div className="loading" role="status"><LoaderCircle size={22} className="spin"/>正在读取数据…</div>; }
export function Badge({ children, warn }) { return <span className={'badge ' + (warn ? 'badge-warn' : '')}>{children}</span>; }
export function Panel({ title, actions, children }) { return <section className="panel">{(title || actions) && <div className="panel-heading"><h2>{title}</h2><div className="inline-actions">{actions}</div></div>}{children}</section>; }
export function Heading({ title, description, children }) { return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>; }
export function Modal({ title, children, close }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current; dialog.showModal();
    const old = document.body.style.overflow; document.body.style.overflow='hidden';
    let printState;
    const beforePrint = () => {
      if (printState) return;
      printState = { scrollTop: dialog.scrollTop, details: [...dialog.querySelectorAll('details')].map(item => [item,item.open]), focus: document.activeElement };
      // Chromium clips scrolled top-layer dialogs when paginating. Print in normal flow.
      dialog.close(); dialog.show(); dialog.scrollTop=0;
      printState.details.forEach(([item]) => { item.open=true; });
    };
    const afterPrint = () => {
      if (!printState) return;
      const state=printState; printState=undefined;
      state.details.forEach(([item,open]) => { item.open=open; });
      dialog.close(); dialog.showModal(); state.focus?.focus({preventScroll:true}); dialog.scrollTop=state.scrollTop;
    };
    window.addEventListener('beforeprint',beforePrint); window.addEventListener('afterprint',afterPrint);
    return () => { window.removeEventListener('beforeprint',beforePrint); window.removeEventListener('afterprint',afterPrint); document.body.style.overflow=old; };
  }, []);
  return <dialog ref={ref} className="native-modal" aria-label={title} onCancel={event => { event.preventDefault(); close(); }}><div className="modal-title"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={close}><X size={22}/></button></div><div className="modal-content">{children}</div></dialog>;
}
export function Field({ label, hint, children }) {
  const id = useId();
  return <label className="field"><span id={id+'-label'}>{label}</span>{cloneElement(children, { 'aria-labelledby': id+'-label', 'aria-describedby': [children.props['aria-describedby'], hint ? id+'-hint' : ''].filter(Boolean).join(' ') || undefined })}{hint && <small id={id+'-hint'}>{hint}</small>}</label>;
}
export function Form({ initial = {}, fields = [], onSubmit, submit = '保存', disabled = false, children }) {
  const [values, setValues] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  function change(key, value) { setValues(previous => ({ ...previous, [key]: value })); }
  return <form className="business-form" onSubmit={async event => { event.preventDefault(); if (busy || disabled) return; setBusy(true); setError(''); try { await onSubmit(values); } catch (e) { setError(e); } finally { setBusy(false); } }}><ErrorBox error={error}/><fieldset disabled={busy || disabled}>{fields.map(field => {
    const { key, label, type = 'text', options, hint, ...attrs } = field; const value=values[key] ?? '';
    return <Field key={key} label={label} hint={hint}>{type === 'checkbox' ? <input type="checkbox" checked={Boolean(value)} onChange={e => change(key,e.target.checked)}/> : type === 'select' ? <select {...attrs} value={value} onChange={e => change(key,e.target.value)}>{options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}</select> : type === 'textarea' ? <textarea rows={4} {...attrs} value={value} onChange={e => change(key,e.target.value)}/> : <input type={type} {...attrs} value={value} onChange={e => change(key,type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}/>}</Field>;
  })}{typeof children === 'function' ? children(values,change) : children}<Button type="submit" disabled={busy || disabled}>{busy && <LoaderCircle size={17} className="spin"/>}{busy ? '正在处理…' : submit}</Button></fieldset></form>;
}
export function Confirm({ message, action, label = '确认', danger = false }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <div className="stack"><p>{message}</p><ErrorBox error={error}/><Button danger={danger} disabled={busy} onClick={async () => { setBusy(true); try { await action(); } catch(e) { setError(e); } finally { setBusy(false); } }}>{busy ? '正在处理…' : label}</Button></div>;
}
