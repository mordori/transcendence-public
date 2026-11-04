import { useNavigate } from 'react-router-dom'
// @ts-ignore
import { GamifyButton, GamifyCard } from '@sitharaj08/gamify';
import { useAuth } from "../auth/useAuth";
import PlayerAvatar from '@/components/PlayerAvatar'
import Footer from '@/components/Footer'

const MainMenu = () => {
  const navigate = useNavigate()
  const { account } = useAuth();

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center 
                  bg-[radial-gradient(circle_at_center,#1a1a2e_0%,#0a0a14_100%)] overflow-hidden">

      {/* 3 background layers */}
      <div className="bg" />
      <div className="bg bg2" />
      <div className="bg bg3" />
      
      {account && (
      <GamifyCard variant='neon' style={{
        pointerEvents: 'none',
        alignSelf: 'flex-start',
        marginLeft: 'clamp(10px, 65vw, 2400px)',
        marginBottom: 'clamp(6px, 5vh, 600px)',
        padding: '4px 1vw 4px 4px',
      }}>
        <div className="ACCOUNT flex items-center gap-2.5 max-w-[500px] font-body 
                        text-[clamp(8px,1.5vw,40px)] tracking-[0.1em] text-neon-cyan">
          <PlayerAvatar avatarId={account.avatarId}/>
            {'[ '} {account.username} {' ]'}
        </div>
      </GamifyCard>
      )}

      <h1 className="HEADER text-[clamp(10px,4.8vw,120px)] mt-[clamp(8px,2vh,16px)] mb-[clamp(4px,2vh,8px)]
                    tracking-[0.1em] text-neon-cyan font-heading font-bold">
        NOT Rocket League
      </h1>

      <div className="BUTTONS flex flex-col gap-[clamp(8px,1.5vh,30px)] w-[clamp(200px,15vw,300px)] 
                      my-[clamp(8px,5vh,80px)] mx-auto">
        <GamifyButton variant="legendary" size="lg" onClick={ () => navigate('/start-game') }>
          Start
        </GamifyButton>
        <GamifyButton variant="primary" size="lg" onClick={ () => navigate('/profile') }>
          Profile
        </GamifyButton>
        <GamifyButton variant="primary" size="lg" onClick={ () => navigate('/manual') } style={{ padding: "1rem 0.5rem" }}>
          How To Play
        </GamifyButton>
      </div>

    <Footer />
    </div>
  )
}

export default MainMenu