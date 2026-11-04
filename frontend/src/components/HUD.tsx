// @ts-ignore
import { GamifyCard, GamifyBadge, GamifyButton } from '@sitharaj08/gamify';
import { CyberpunkCard } from "@/components/ui/cyberpunk-card";

type HUDProps = {
  timerSeconds: number;
  scoreRed: number;
  scoreBlue: number;
};

const HUD = ({ timerSeconds, scoreRed, scoreBlue }: HUDProps) => {
  const isOvertime = timerSeconds >= 300 && scoreRed === scoreBlue;
  const remainingSeconds = Math.max(0, Math.ceil(300 - timerSeconds));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const displayTime = isOvertime
    ? "OVERTIME"
    : minutes + ":" + seconds.toString().padStart(2, "0");

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      <div className="flex justify-center mt-[clamp(1px,0.5vh,30px)]">
        {/* GOALS + TIMER CARD */}
        <GamifyCard variant="common" style={{ 
          background: 'rgba(0, 0, 0, 0.6)',
          padding: '1px',
          display: 'flex',
          gap: 'clamp(10px, 2vw, 30px)'
        }}>
          {/* Blue Team */}
          <div className="[container-type:inline-size] w-[clamp(70px,7vw,300px)]">
            <CyberpunkCard
              theme="neon-blue"
              rounded="lg"
              glow={false}
              colorShift={false}
              lightTrail={false}
              style={{
                width: '100%',
                height: '100%',
                padding: '0 1vw',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <div className="font-heading text-[clamp(10px,22cqw,40px)] font-bold text-center">
                  BLUE
                </div>
            </CyberpunkCard>
          </div>
          <div className="w-[clamp(30px,3vw,100px)] flex items-center justify-center 
                          text-[clamp(10px,2vw,40px)] text-white font-bold font-heading tracking-[2px]">
            {scoreBlue}
          </div>

          {/* Timer */}
          <GamifyButton variant="outline" style={{
            fontSize: isOvertime ? 'clamp(12px, 1.5vw, 36px)' : 'clamp(12px, 2vw, 36px)',
            width: 'clamp(150px, 10vw, 300px)',
            padding: '0px clamp(1px, 5.5vw, 150px)',
          }}>
            {displayTime}
          </GamifyButton>
          
          {/* Red Team */}
          <div className="w-[clamp(30px,3vw,100px)] flex items-center justify-center 
                          text-[clamp(10px,2vw,40px)] text-white font-bold font-heading tracking-[2px]">
            {scoreRed}
          </div>
          <div className="[container-type:inline-size] w-[clamp(70px,7vw,300px)]">
            <CyberpunkCard
              theme="neon-red"
              rounded="lg"
              glow={false}
              colorShift={false}
              lightTrail={false}
              style={{
                width: '100%',
                height: '100%',
                padding: '0 1vw',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <div className="font-heading text-[clamp(10px,22cqw,40px)] font-bold text-center">
                  RED
                </div>
            </CyberpunkCard>
          </div>
        </GamifyCard>
      </div>
    </div>
  );
};

export default HUD;