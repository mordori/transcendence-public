import { useState } from 'react'
// @ts-ignore
import { GamifyCard, GamifyButton, GamifyInput, GamifySpinner } from '@sitharaj08/gamify'
import { Checkbox } from '@bwo-ui/react'

type Props = {
  open: boolean
  onClose: () => void
  onCreate: (roomName: string, password: string | null) => Promise<void> | void
}

const CreateRoom = ({ open, onClose, onCreate }: Props) => {
  const [roomName, setRoomName] = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleCreate = async () => {
    setError(null)

    if (roomName.trim().length < 3) {
      setError('Room name must be at least 3 characters')
      return
    }

    if (roomName.trim().length > 30) {
      setError('Room name must be a maximum of 30 characters')
      return
    }

    if (usePassword && password.length < 3) {
      setError('Password must be at least 3 characters')
      return
    }

    setLoading(true)
    try {
      await onCreate(roomName.trim(), usePassword ? password : null)
      // StartGame.tsx handles the room creation + navigation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create room :(')
      setLoading(false)
    }
  }

  return (
    // Darken overlay
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70">
      {/* Popup window */}
      <GamifyCard variant="cyber" style={{
        position: 'relative',
        width: 'clamp(320px, 60vw, 1600px)',
        minHeight: 'clamp(240px, 60vh, 1000px)',
        textAlign: 'center',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(0px, 1.5vh, 30px)'
      }}>
        
        <h2 className="mt-[clamp(8px,2vh,24px)] text-[clamp(20px,2.5vw,60px)] font-heading">
          Create Room
        </h2>

        {error && (
          <div className="text-[#ff4d4d] bg-[#ff4d4d]/10 border border-[#ff4d4d]/30 rounded-md px-[clamp(8px,1.2vh,20px)] text-center text-[clamp(13px,1.2vw,15px)]">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); void handleCreate(); }}
          className="w-full flex flex-col items-center gap-[clamp(0px,1.5vh,30px)]"
          aria-busy={loading}
          noValidate
        >
          <div className="ROOM_OPTIONS w-4/5 flex gap-[clamp(16px,2vw,32px)] items-start text-left mt-[clamp(8px,0.5vh,20px)] mx-auto mb-[clamp(8px,1.5vh,80px)]">
            <div className="ROOM_INFO flex-1 flex flex-col gap-[clamp(8px,1.5vh,30px)]">
              <GamifyInput
                label="Room name"
                placeholder="e.g. Missile Championship"
                value={roomName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoomName(e.target.value)}
              />

              <div className="PW flex items-center gap-2">
                <Checkbox
                  id="use-password"
                  checked={usePassword}
                  onCheckedChange={(checked) => setUsePassword(checked === true)}
                />
                <label
                  htmlFor="use-password"
                  className="text-[var(--gamify-text-secondary)] font-body text-sm cursor-pointer"
                >
                  PASSWORD
                </label>
              </div>

              {usePassword && (
                <GamifyInput
                  type="password"
                  placeholder="Remember me"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="BUTTONS flex justify-center gap-[clamp(16px,3vw,48px)]">
            <GamifyButton type="button" variant="outline" size="lg" onClick={onClose}>
              Cancel
            </GamifyButton>
            <GamifyButton type="submit" variant="legendary" size="lg">
              Create
            </GamifyButton>
          </div>
        </form>

        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-black/60">
            <GamifySpinner size="lg" />
          </div>
        )}
      </GamifyCard>
    </div>
  )
}

export default CreateRoom