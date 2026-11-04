import { useState } from 'react'
// @ts-ignore
import { GamifyCard, GamifyButton } from '@sitharaj08/gamify'
import { SquareMenu } from 'lucide-react'

const RageQuit = ({ onQuit }: { onQuit: () => void }) => {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleQuit = () => {
    setConfirmOpen(false)
    onQuit()
  }

  return (
    <>
      {/* Menu button — pinned top-right, doesn't block the page */}
      <div className="absolute top-0 right-0 z-20 mt-[clamp(1px,1.5vh,30px)] mx-[clamp(1px,2vw,60px)]">
        <button className="cursor-pointer" onClick={() => setConfirmOpen(true)}>
          <SquareMenu className="w-[2em] h-[2em] text-[var(--gamify-neon-cyan)] fill-zinc-600" />
        </button>
      </div>

      {/* Confirmation modal — only renders when open */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70"
          onClick={() => setConfirmOpen(false)}
        >
          <GamifyCard
            variant="neon"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            style={{
              width: 'clamp(300px, 40vw, 800px)',
              padding: 'clamp(16px, 3vw, 60px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'clamp(12px, 3vh, 40px)',
              textAlign: 'center',
            }}
          >
            
            <p className="text-[clamp(12px,1vw,30px)] font-body text-zinc-500">
              We understand the game sometimes gets too hard.
            </p>
            
            <GamifyButton
              type="button"
              variant="danger"
              size="lg"
              onClick={handleQuit}
            >
              <div className="text-black text-[clamp(12px,1.5vw,40px)] hover:text-red-500">
                RAGE QUIT
              </div>
            </GamifyButton>
          </GamifyCard>
        </div>
      )}
    </>
  )
}

export default RageQuit