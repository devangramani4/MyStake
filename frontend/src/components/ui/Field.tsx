import { forwardRef, useId, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> { label: string; error?: string; hint?: string }

export const Field = forwardRef<HTMLInputElement, Props>(({ label, error, hint, className, ...rest }, ref) => {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={ref} className={`input ${error ? 'invalid' : ''} ${className ?? ''}`} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined} {...rest} />
      {error ? <span id={`${id}-msg`} className="field-error">{error}</span> : hint ? <span id={`${id}-msg`} className="field-hint">{hint}</span> : null}
    </div>
  );
});
Field.displayName = 'Field';
