'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface ApiKeyInputProps {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder: string
  disabled?: boolean
}

export default function ApiKeyInput({ value, onChange, label, placeholder, disabled = false }: ApiKeyInputProps) {
  const [show, setShow] = useState(false)

  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </label>
      <div
        className="flex items-center"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          borderRadius: 2,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 px-3 py-2 text-xs outline-none bg-transparent"
          style={{ color: 'var(--text-primary)' }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => !disabled && setShow((s) => !s)}
          disabled={disabled}
          className="px-2.5 py-2 flex items-center transition-colors disabled:cursor-not-allowed"
          style={{ color: 'var(--text-muted)' }}
          tabIndex={-1}
        >
          {show
            ? <EyeOff className="w-3.5 h-3.5" />
            : <Eye    className="w-3.5 h-3.5" />
          }
        </button>
      </div>
    </div>
  )
}
