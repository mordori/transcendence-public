type GameCountdownProps = { secondsRemaining?: number | null };

const Countdown = ({ secondsRemaining = null }: GameCountdownProps) => {
  if (secondsRemaining === null || secondsRemaining <= 0) return null;

  return (
    <>
      <div className="countdown fixed inset-x-0 top-[30%] bg-[#0f171a]/30
                      pt-[clamp(16px,2vw,32px)] px-[clamp(24px,5vw,120px)] pb-[clamp(24px,4vh,60px)]">
          <h1 className="mt-[clamp(8px,2vh,16px)] mb-[clamp(4px,2vh,8px)] text-[var(--gamify-neon-yellow)] 
                        font-heading font-bold flex flex-col items-center">
            <span className="text-[clamp(16px,2vw,32px)]">Match starts in</span>
            <span className="text-[clamp(10px,4.8vw,120px)]">{secondsRemaining}</span>
        </h1>          
      </div>
    </>
  )
}

export default Countdown