import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  wide?: boolean   // for Space, Shift, etc.
}

const KeyCap = ({ children, wide }: Props) => (
  <kbd style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: wide ? 'clamp(80px, 12vw, 140px)' : 'clamp(16px, 4vw, 48px)',
    height: 'clamp(16px, 4vw, 48px)',
    padding: '0 clamp(6px, 1vw, 12px)',
    background: 'linear-gradient(180deg, #3e3c1a 0%, #0f0f29 100%)',
    border: '2px solid var(--gamify-neon-cyan)',
    borderRadius: 'clamp(4px, 0.5vw, 8px)',
    color: 'var(--gamify-neon-cyan)',
    fontFamily: 'var(--gamify-font-heading)',
    fontWeight: 'bold',
    fontSize: 'clamp(12px, 1.4vw, 20px)',
    letterSpacing: '0.05em',
    boxShadow: '0 2px 0 rgba(0, 0, 0, 0.5), 0 0 12px rgba(0, 243, 255, 0.3)',
    userSelect: 'none',
  }}>
    {children}
  </kbd>
)

export default KeyCap