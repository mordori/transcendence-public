import { useNavigate } from 'react-router-dom'
// @ts-ignore
import { GamifyCard, GamifyButton } from '@sitharaj08/gamify';
import Footer from '@/components/Footer'

const GameTitle = () => {
  const navigate = useNavigate()

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a14] 
                    bg-[radial-gradient(ellipse_100%_60%_at_50%_-10%,rgba(139,92,246,0.35),transparent_50%),radial-gradient(ellipse_60%_50%_at_90%_90%,rgba(236,72,153,0.25),transparent_40%),radial-gradient(ellipse_60%_50%_at_10%_80%,rgba(6,182,212,0.25),transparent_40%)]">

      <GamifyCard variant="cyber" style={{
        width: 'clamp(320px, 70vw, 2000px)',
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

        <h1 className="text-[clamp(10px,4.8vw,120px)] tracking-[0.1em] font-heading font-bold
                      mt-[clamp(8px,2vh,16px)] mb-[clamp(4px,2vh,8px)] text-[var(--gamify-neon-cyan)]">
          NOT Rocket League
        </h1>

        <p className="text-center text-[clamp(10px,1.5vw,72px)] opacity-70 mt-0 mb-[clamp(16px,4vh,32px)] 
                      text-white font-body">
          ~~ Totally original idea ~~
        </p>

        <div className="flex flex-col gap-[clamp(8px,1.5vh,50px)] w-[clamp(100px,30%,280px)] mx-auto">
          <GamifyButton variant="primary" size="lg" onClick={ () => navigate('/login') }>
            LOGIN
          </GamifyButton>
          <GamifyButton variant="primary" size="lg" onClick={ () => navigate('/signup') }>
            SIGNUP
          </GamifyButton>
        </div>

      </GamifyCard>
    <Footer />
    </div>
  )
}

export default GameTitle