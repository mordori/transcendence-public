// @ts-ignore
import { GamifyButton, GamifyCard } from '@sitharaj08/gamify'

type RoomErrorPageProps = {
  roomName?: string | null
  errorMessage: string | null
  onBack: () => void
}

const RoomErrorPage = ({ roomName, errorMessage, onBack }: RoomErrorPageProps) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,#1a1a2e_0%,#0a0a14_100%)]">
      <GamifyCard variant="common" style={{
        padding: 'clamp(20px, 4vw, 60px)',
        background: 'rgba(0, 0, 0, 0.4)',
        borderColor: 'var(--gamify-neon-cyan)',
        maxWidth: 'clamp(320px, 60vw, 800px)',
        textAlign: 'center',
      }}>
        <h1 className="text-[clamp(24px,3vw,48px)] text-neon-cyan font-heading font-bold mb-4">
          Cannot enter
        </h1>
        {roomName && (
          <p className="text-[clamp(14px,2vw,30px)] opacity-70 mb-4">
            Room: {roomName}
          </p>
        )}
        <p className="text-[clamp(14px,1.2vw,18px)] text-[#ff4d4d] mb-8">
          {errorMessage ?? 'Could not connect to the room.'}
        </p>
        <GamifyButton variant="outline" size="lg" onClick={onBack}>
          Room list
        </GamifyButton>
      </GamifyCard>
    </div>
  )
}

export default RoomErrorPage