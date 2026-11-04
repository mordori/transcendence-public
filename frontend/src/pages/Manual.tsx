import { useNavigate } from 'react-router-dom'
// @ts-ignore
import { GamifyCard, GamifyButton } from '@sitharaj08/gamify'
import { Mouse } from 'lucide-react'
import KeyCap from '@/components/KeyCap'

const ControlRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
<div className="flex items-center justify-between gap-[clamp(16px,3vw,100px)] py-[clamp(8px,1.5vh,16px)]">
  <span className="text-white font-body text-[clamp(12px,1.2vw,40px)]">
    {label}
  </span>
  <div className="flex items-center gap-[clamp(4px,0.6vw,8px)]">
    {children}
  </div>
</div>
)

const Manual = () => {
  const navigate = useNavigate()

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a14] 
                    bg-[radial-gradient(ellipse_60%_50%_at_95%_90%,rgba(236,72,72,0.25),transparent_40%),radial-gradient(ellipse_60%_50%_at_15%_60%,rgba(6,44,212,0.25),transparent_40%),radial-gradient(circle_at_center,#292937_0%,#0a0a14_100%)]">
      <div className="header+guide flex flex-col items-center w-full max-w-[2500px] gap-[clamp(0px,1.5vh,50px)]">
        <h1 className="self-start mt-0 mr-0 mb-[clamp(12px,3vh,40px)] ml-[clamp(24px,8vw,120px)] 
                      text-[clamp(32px,4.8vw,84px)] tracking-[0.1em] text-neon-cyan
                      font-heading font-bold">
          How To Play
        </h1>

        <div className="rules+controls flex gap-[clamp(0px,1.5vw,80px)]">
          {/* Rules card */}
          <GamifyCard variant="common" style={{
            width: 'clamp(320px, 40vw, 1200px)',
            padding: 'clamp(10px, 3vw, 80px)',
            background: 'rgba(0, 0, 0, 0.4)',
            borderColor: 'var(--gamify-neon-cyan)',
            maxHeight: 'clamp(240px, 50vh, 1000px)',
            overflowY: 'auto',
          }}>
            <h1 className="text-center text-[clamp(20px,3vw,60px)] font-heading text-neon-cyan m-0 mb-[clamp(12px,3vh,40px)]">
              Rules
            </h1>
            <div className="rules flex flex-col gap-[clamp(12px,2vh,24px)] font-body text-white text-[clamp(12px,1.2vw,40px)] text-left">
              <div className="flex gap-3 items-start w-full">
                <span className="text-neon-cyanfont-bold">1.</span>
                <span>Match length is 5 minutes.</span>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-neon-cyanfont-bold">2.</span>
                <span>The team with more goals wins.</span>
              </div>
              <div className="flex gap-3 items-start">
                <span className="text-neon-cyanfont-bold">3.</span>
                <span>
                  If tied, the match continues to overtime for 3 minutes: <br/>
                  First team to score wins or match ends in a draw.
                </span>
              </div>
            </div>
          </GamifyCard>

          {/* Controls guide card */}
          <GamifyCard variant="common" style={{
            width: 'clamp(320px, 40vw, 1200px)',
            padding: 'clamp(10px, 3vw, 80px)',
            background: 'rgba(0, 0, 0, 0.4)',
            borderColor: 'var(--gamify-neon-cyan)',
            maxHeight: 'clamp(240px, 50vh, 1000px)',
            overflowY: 'auto',
          }}>
            <h1 className="text-center text-[clamp(20px,3vw,60px)] font-heading text-neon-cyan">
              Controls
            </h1>
            <ControlRow label="Move">
              <KeyCap>W</KeyCap>
              <KeyCap>A</KeyCap>
              <KeyCap>S</KeyCap>
              <KeyCap>D</KeyCap>
            </ControlRow>

            <ControlRow label="Jump">
              <KeyCap wide>Space</KeyCap>
            </ControlRow>

            <ControlRow label="Mouse release">
              <KeyCap>Esc</KeyCap>
            </ControlRow>

            <ControlRow label="Camera">
              <span className="inline-flex items-center justify-center w-[clamp(32px,4vw,48px)] h-[clamp(32px,4vw,48px)] text-neon-cyan">
                <Mouse size="100%" strokeWidth={2} />
              </span>
            </ControlRow>
          </GamifyCard>
        </div>
      </div>

      <div className="back-button flex flex-col gap-[clamp(8px,1.5vh,30px)] w-[clamp(200px,15vw,300px)] my-[clamp(8px,5vh,80px)] mx-auto">
        <GamifyButton variant="outline" size="lg" onClick={() => navigate('/main-menu')}>
          Back
        </GamifyButton>
      </div>
    </div>
  )
}

export default Manual