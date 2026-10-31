import { forwardRef, useId, type ComponentProps, type ReactNode } from 'react';

// ขนาดตัวอักษร input 16px (text-base) — iOS ซูมหน้าเองถ้าเล็กกว่านี้
const inputBase =
  'block w-full rounded-lg border bg-white px-3 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-600 disabled:bg-gray-100';

function borderFor(error?: string) {
  return error ? 'border-red-500' : 'border-gray-300';
}

/** ลิงก์ที่หน้าตาเหมือนปุ่มหลัก (ไม่ซ้อน <button> ใน <a>) */
export const linkButtonClass =
  'inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-green-700 px-4 text-base font-semibold text-white hover:bg-green-800';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  loading,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const styles = {
    primary: 'bg-green-700 text-white hover:bg-green-800 disabled:bg-green-300',
    secondary:
      'border border-green-700 text-green-800 bg-white hover:bg-green-50 disabled:opacity-50',
    ghost: 'text-green-800 hover:bg-green-50 disabled:opacity-50',
  }[variant];
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors ${styles} ${className}`}
      {...props}
    >
      {loading && (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
}

function FieldShell({ label, error, hint, required, htmlFor, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-gray-700">
        {label}
        {/* ดาวเป็นแค่สัญลักษณ์ภาพ — screen reader รู้จาก aria-required ของช่องกรอก */}
        {required && (
          <span aria-hidden="true" className="text-red-600">
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : (
        hint && <p className="text-sm text-gray-500">{hint}</p>
      )}
    </div>
  );
}

type FieldProps<T> = T & { label: string; error?: string; hint?: ReactNode };

export const TextField = forwardRef<HTMLInputElement, FieldProps<ComponentProps<'input'>>>(
  function TextField({ label, error, hint, required, id, className = '', ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={inputId}>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-required={required}
          className={`${inputBase} h-12 ${borderFor(error)} ${className}`}
          {...props}
        />
      </FieldShell>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, FieldProps<ComponentProps<'textarea'>>>(
  function TextArea({ label, error, hint, required, id, ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={inputId}>
        <textarea
          ref={ref}
          id={inputId}
          rows={3}
          aria-invalid={Boolean(error)}
          aria-required={required}
          className={`${inputBase} py-2 ${borderFor(error)}`}
          {...props}
        />
      </FieldShell>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, FieldProps<ComponentProps<'select'>>>(
  function Select({ label, error, hint, required, id, children, ...props }, ref) {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={inputId}>
        <select
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-required={required}
          className={`${inputBase} h-12 ${borderFor(error)}`}
          {...props}
        >
          {children}
        </select>
      </FieldShell>
    );
  },
);

export function Alert({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'info' | 'success' | 'warning';
  title?: string;
  children?: ReactNode;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    success: 'border-green-200 bg-green-50 text-green-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border p-3 text-sm ${styles}`}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-gray-500">
      <span className="size-5 animate-spin rounded-full border-2 border-green-700 border-t-transparent" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </section>
  );
}
