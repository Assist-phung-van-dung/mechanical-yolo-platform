export function Card({ children, className = '' }) {
  return <div className={`rounded-3xl border border-white/10 bg-white/[0.07] p-5 shadow-soft backdrop-blur-xl ${className}`}>{children}</div>
}

export function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        {eyebrow && <div className="mb-2 text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300">{eyebrow}</div>}
        <h1 className="text-3xl font-black tracking-tight text-white md:text-5xl">{title}</h1>
        {description && <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 md:text-base">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Button({ children, className = '', variant = 'primary', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50'
  const styles = {
    primary: 'bg-blue-500 text-white hover:bg-blue-400 shadow-glow',
    ghost: 'border border-white/10 bg-white/5 text-white hover:bg-white/10',
    white: 'bg-white text-slate-950 hover:bg-slate-100',
    danger: 'bg-rose-500 text-white hover:bg-rose-400',
  }
  return <button className={`${base} ${styles[variant]} ${className}`} {...props}>{children}</button>
}

export function Input({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>}
      <input
        className={`w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300 ${className}`}
        {...props}
      />
    </label>
  )
}

export function Select({ label, className = '', children, ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>}
      <select
        className={`w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300 ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  )
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="mb-2 block text-sm font-semibold text-slate-300">{label}</span>}
      <textarea
        className={`min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300 ${className}`}
        {...props}
      />
    </label>
  )
}

export function Badge({ children, tone = 'blue' }) {
  const tones = {
    blue: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
    green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    yellow: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    red: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
    slate: 'border-slate-400/20 bg-slate-400/10 text-slate-200',
  }
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>
}

export function EmptyState({ title, description }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
      <div className="text-lg font-bold text-white">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">{description}</p>
    </div>
  )
}
