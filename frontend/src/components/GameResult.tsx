// @ts-ignore
import { GamifyCard, GamifySpinner } from '@sitharaj08/gamify';
import { CyberpunkCard } from "@/components/ui/cyberpunk-card";

type GameResultProps = {
  show: boolean;
  scoreRed: number;
  scoreBlue: number;
};

const GameResult = ({ show, scoreRed, scoreBlue }: GameResultProps) => {
  if (!show) return null;

  const winner = scoreRed > scoreBlue ? 'RED' : scoreBlue > scoreRed ? 'BLUE' : 'DRAW';
  return (
    <div className="RESULT fixed inset-0 z-20 flex items-center justify-center bg-black/60">
      <GamifyCard variant="cyber" style={{
        width: 'clamp(320px, 50vw, 2000px)',
        height: 'clamp(240px, 70vh, 1500px)',
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(16px, 3vw, 60px)',
        textAlign: 'center',
        gap: 'clamp(0px, 1.5vh, 30px)',
      }}>

        <h1 className="HEADER text-[clamp(20px,4vw,120px)]
                    tracking-[0.1em] text-neon-cyan font-heading font-bold">
          Match Result
        </h1>

        <div className="ANNOUNCEMENT h-1/2 flex flex-col justify-center pointer-events-none">
          {winner === 'RED' && (
            <>
              <CyberpunkCard
                theme="neon-red"
                borderStyle="corners"
                lightTrail={false}
              >
                <div className="w-[clamp(100px,15vw,500px)] h-[clamp(10px,3vh,200px)] flex items-center justify-center text-zinc-100 text-[clamp(20px,3vw,80px)]">
                  RED
                </div>
              </CyberpunkCard>
              <p className="pt-[clamp(8px,3vh,60px)] text-[var(--gamify-neon-yellow)] text-[clamp(10px,1.5vw,70px)]"> is the winner!!</p>
            </>
          )}

          {winner === 'BLUE' && (
            <>
              <CyberpunkCard
                theme="neon-blue"
                borderStyle="corners"
                lightTrail={false}
              >
                <div className="w-[clamp(100px,15vw,500px)] h-[clamp(10px,3vh,200px)] flex items-center justify-center text-zinc-100 text-[clamp(20px,3vw,80px)]">
                  BLUE
                </div>
              </CyberpunkCard>
              <p className="pt-[clamp(8px,3vh,60px)] text-[var(--gamify-neon-yellow)] text-[clamp(10px,1.5vw,70px)]"> is the winner!!</p>
            </>
          )}

          {winner === 'DRAW' && (
            <>
              <CyberpunkCard
                theme="neon-purple"
                borderStyle="corners"
                lightTrail={false}
              >
                <div className="w-[clamp(100px,15vw,500px)] h-[clamp(10px,3vh,200px)] flex items-center justify-center text-zinc-100 text-[clamp(20px,3vw,80px)]">
                  DRAW
                </div>
              </CyberpunkCard>
              <p className="pt-[clamp(8px,3vh,60px)] text-[clamp(10px,1.5vw,70px)]"> GGWP !</p>
            </>
          )}
        </div>

        <div className="REDIRECT">
          <GamifyCard variant="default" style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 clamp(8px, 1.5vw, 30px)',
            gap: 'clamp(0px, 1.5vh, 30px)',
          }}>
            <p className="text-[clamp(8px,1vw,40px)]">Returning to lobby...</p>
            <GamifySpinner size="sm"/>
          </GamifyCard>
        </div>

      </GamifyCard>
    </div>
  )
}

export default GameResult
